import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { generateSyntheticCandles } from "@/lib/dex/sodex-adapter";
import { readBotState, writeBotState } from "@/lib/data-store";
import { setSignals } from "@/lib/signal-store";
import { getCachedSentiment } from "@/lib/sentiment-engine";
import { getETFSignal } from "@/lib/sosovalue/etf";
import { getMacroSignal } from "@/lib/sosovalue/macro";
import { explainSignal, classifyMarketRegime } from "@/lib/engine/llm-agent";
import { computeCyclePosition, getMarketSnapshot } from "@/lib/sosovalue/market";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const symbols: string[] = body.symbols || ["SOL-USD", "ETH-USD", "BTC-USD"];
  const minConfidence = body.minConfidence || 0.55;
  const maxMarginPct = body.maxMarginPct || 20;
  const walletAddress = body.walletAddress || "";
  const portfolioValueFromClient = body.portfolioValue || 0;
  const strategyConfig: Record<string, { enabled: boolean; weight: number }> = body.strategyConfig || {};
  const strategyEnabled = (key: string) => !strategyConfig[key] || strategyConfig[key].enabled !== false;

  const state = readBotState();
  state.cycle = (state.cycle || 0) + 1;
  writeBotState(state);

  const logs: string[] = [];
  function log(line: string) { logs.push(line); }

  log(`🔄 Cycle #${state.cycle} start`);

  // Fetch real balance + positions
  let portfolioValue = portfolioValueFromClient || 1000;
  const onChainPositions: Array<{ symbol: string; side: string }> = [];

  if (walletAddress) {
    try {
      await initDex();
      const adapter = getAdapter();
      const traderState = await adapter.getTraderState(walletAddress);
      portfolioValue = traderState.collateral || portfolioValue;
      for (const pos of traderState.positions) {
        if (pos.symbol && pos.side) {
          onChainPositions.push({ symbol: pos.symbol, side: pos.side });
        }
      }
      log(`  Wallet: $${portfolioValue.toFixed(2)} | ${onChainPositions.length} on-chain positions`);
    } catch (err: unknown) {
      log(`  ⚠ Balance fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    log(`  ⚠ No wallet address provided — cannot check on-chain positions`);
  }

  // Import engine modules
  const { getCandles, getCurrentPrice, getFundingRate, getAllMarketLimits } = await import("@/lib/engine/market.js");
  const { TrendFollowing, MeanReversion, Momentum, SRBounce, VolumeBreakout, synthesizeSignals } = await import("@/lib/engine/signals.js");
  const { analyzeFunding } = await import("@/lib/engine/funding.js");

  try { await initDex(); } catch (err: unknown) {
    log(`⚠ DEX init failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Fetch dynamic market limits
  let marketLimits: Record<string, any> = {};
  try { marketLimits = await getAllMarketLimits(); } catch {}

  // ─── Fetch SoSoValue data (parallel) ──────────────────────
  const baseSymbols = symbols.map(s => s.split("-")[0]);

  // SoSoValue LLM sentiment
  let sentimentMap: Record<string, any> = {};
  try { sentimentMap = await getCachedSentiment(baseSymbols); } catch {}

  // ETF flow signals (parallel for all base symbols)
  let etfMap: Record<string, any> = {};
  try {
    const etfResults = await Promise.all(
      baseSymbols.map(async (sym) => {
        try { return { sym, data: await getETFSignal(sym) }; } catch { return { sym, data: null }; }
      })
    );
    for (const { sym, data } of etfResults) {
      if (data) etfMap[sym] = data;
    }
  } catch {}

  // Macro events (single call)
  let macroAnalysis: any = null;
  try { macroAnalysis = await getMacroSignal(); }
  catch { macroAnalysis = { signal: 0, confidence: 0, hasHighImpactSoon: false }; }

  if (macroAnalysis?.hasHighImpactSoon) {
    log(`  ⚠ High-impact macro event approaching: ${macroAnalysis.nextHighImpactEvent?.name || "unknown"}`);
  }

  const signalsGenerated: Array<Record<string, unknown>> = [];

  for (const symbol of symbols) {
    try {
      const baseSym = symbol.split("-")[0];

      let candles = await getCandles(symbol, "1h", 100);
      if (!candles || candles.length < 50) {
        log(`  ${symbol}: real klines unavailable — using synthetic data`);
        candles = generateSyntheticCandles(symbol, 100);
      }

      const price = (await getCurrentPrice(symbol)) || candles[candles.length - 1].close;

      const strategies = [];
      if (strategyEnabled("trend_following")) strategies.push(TrendFollowing(candles));
      if (strategyEnabled("mean_reversion")) strategies.push(MeanReversion(candles));
      if (strategyEnabled("momentum")) strategies.push(Momentum(candles));
      if (strategyEnabled("sr_bounce")) strategies.push(SRBounce(candles));
      if (strategyEnabled("volume_breakout")) strategies.push(VolumeBreakout(candles));

      // Funding rate
      let fundingSignal: { signal: number; confidence: number } = { signal: 0, confidence: 0 };
      try {
        const fundingData = await getFundingRate(symbol);
        if (fundingData) {
          const fa = analyzeFunding([fundingData], price) as { signal: number; confidence: number };
          fundingSignal = { signal: fa.signal || 0, confidence: fa.confidence || 0 };
        }
      } catch {}

      const marketMaxLev = marketLimits[symbol]?.maxLeverage || 10;

      // ETF flow for this symbol (respect toggle)
      const etfFlow = strategyEnabled("etf_flow") ? (etfMap[baseSym] || null) : null;

      const sentiment = strategyEnabled("sosovalue_sentiment") ? (sentimentMap[baseSym] || null) : null;

      // Build strategy weights map from config (only for enabled strategies)
      const sw: Record<string, number> = {};
      for (const [key, cfg] of Object.entries(strategyConfig)) {
        if (cfg.enabled) sw[key] = cfg.weight;
      }

      // Synthesize with all signals
      const combined = synthesizeSignals(strategies, price, {
        maxLeverage: marketMaxLev,
        sentiment: sentiment || undefined,
        funding: fundingSignal.signal !== 0 ? fundingSignal : undefined,
        etfFlow: etfFlow || undefined,
        macroSignal: macroAnalysis || undefined,
        strategyWeights: Object.keys(sw).length > 0 ? sw : undefined,
      });

      // Position sizing
      const { computePositionSize } = await import("@/lib/engine/signals.js");
      const margin = portfolioValue * (maxMarginPct / 100);
      const notional = margin * marketMaxLev;
      const baseSize = notional / price;
      const sized = computePositionSize(baseSize, combined.vibeScore, combined.signal);
      const positionSize = sized.size;

      // Market regime & cycle position
      let cyclePos = null;
      try { cyclePos = await getMarketSnapshot(baseSym); } catch {}

      // Logging
      if (sentiment && sentiment.confidence > 0) {
        const reasoning = sentiment.reasoning ? ` — ${sentiment.reasoning}` : "";
        log(`    📰 Sentiment: ${sentiment.score > 0 ? "bullish" : sentiment.score < 0 ? "bearish" : "neutral"} (${(sentiment.confidence * 100).toFixed(0)}% conf, ${sentiment.articleCount} articles)${reasoning}`);
        if (sentiment.keyNarratives?.length) {
          log(`    📝 Narratives: ${sentiment.keyNarratives.join(" | ")}`);
        }
      }
      if (etfFlow) {
        log(`    🏦 ETF Flow: $${(etfFlow.meta?.latestInflow / 1e6 || 0).toFixed(1)}M net | trend: ${etfFlow.meta?.trend7d} | ${etfFlow.meta?.consecutiveDays}d consecutive`);
      }
      if (combined.vibeScore) {
        const v = combined.vibeScore;
        log(`    🎵 Vibe: ${v.vibe > 0 ? "bullish" : v.vibe < 0 ? "bearish" : "neutral"} (${(v.confidence * 100).toFixed(0)}% conf, consensus: ${v.fullConsensus ? "YES" : "NO"})${sized.isHedged ? ` | HEDGE: size ${(sized.multiplier * 100).toFixed(0)}%` : ""}`);
      }

      const stratLog = strategies
        .map((s: { name: string; signal: number }) =>
          `${s.name.slice(0, 6)}:${s.signal > 0 ? "▲" : s.signal < 0 ? "▼" : "◆"}${s.signal.toFixed(1)}`
        ).join(" ");
      log(`  ${symbol}: $${price.toFixed(2)} ${combined.signal > 0 ? "▲" : combined.signal < 0 ? "▼" : "◆"} sig:${combined.signal.toFixed(2)} conf:${(combined.confidence * 100).toFixed(1)}% | ${stratLog}`);

      if (combined.action === "hold" || combined.confidence < minConfidence) {
        if (combined.confidence < minConfidence) {
          log(`    ⏸ Below threshold (${(combined.confidence * 100).toFixed(1)}% < ${(minConfidence * 100).toFixed(1)}%)`);
        } else if (combined.holdReason) {
          log(`    ⏸ Hold: ${combined.holdReason}`);
        }
        continue;
      }

      // Check on-chain duplicates
      const hasPosition = onChainPositions.find((p) => p.symbol === symbol);
      if (hasPosition) {
        log(`    ⏸ Already have ${hasPosition.side} position on ${symbol} (on-chain)`);
        continue;
      }

      // ─── LLM Signal Reasoning (async, fire-and-forget-ish) ──
      let llmReasoning: string | null = null;
      let llmRiskFactors: string[] = [];
      try {
        const explanation = await explainSignal(
          baseSym,
          {
            action: combined.action,
            signal: combined.signal,
            confidence: combined.confidence,
            longVotes: combined.longVotes,
            shortVotes: combined.shortVotes,
            details: combined.details,
            vibeScore: combined.vibeScore,
            price,
          },
          { llm: sentiment, etfFlow }
        );
        llmReasoning = explanation.reasoning;
        llmRiskFactors = explanation.riskFactors;
        log(`    🧠 Reasoning: ${llmReasoning}`);
        if (llmRiskFactors.length) log(`    ⚠ Risks: ${llmRiskFactors.join(" | ")}`);
      } catch {}

      const signal = {
        id: `sig_${Date.now()}_${symbol}`,
        symbol,
        side: combined.action,
        entryPrice: price,
        size: positionSize,
        leverage: marketMaxLev,
        stopLoss: combined.stopLoss,
        takeProfit: combined.takeProfit,
        confidence: combined.confidence,
        longVotes: combined.longVotes,
        shortVotes: combined.shortVotes,
        reasoning: llmReasoning,
        riskFactors: llmRiskFactors,
        vibeScore: combined.vibeScore,
        etfFlow: etfFlow ? {
          signal: etfFlow.signal,
          trend: etfFlow.meta?.trend7d,
          latestInflow: etfFlow.meta?.latestInflow,
        } : null,
        macroAlert: macroAnalysis?.hasHighImpactSoon ? macroAnalysis.nextHighImpactEvent?.name : null,
        details: [
          ...(combined.details || []),
          ...(etfFlow && etfFlow.confidence > 0.2 ? [{
            name: "etf_flow",
            signal: etfFlow.signal > 0 ? "bullish" : "bearish",
            confidence: (etfFlow.confidence * 100).toFixed(0) + "%",
            meta: etfFlow.meta,
          }] : []),
          ...(sentiment && sentiment.confidence > 0 ? [{
            name: "sosovalue_sentiment",
            signal: sentiment.score > 0 ? "bullish" : sentiment.score < 0 ? "bearish" : "neutral",
            confidence: (sentiment.confidence * 100).toFixed(0) + "%",
            meta: { articles: sentiment.articleCount, narratives: sentiment.keyNarratives },
          }] : []),
        ],
        queuedAt: Date.now(),
      };
      signalsGenerated.push(signal);
      log(`    🔔 SIGNAL: ${combined.action.toUpperCase()} ${symbol} | $${price.toFixed(2)} | ${positionSize.toFixed(4)} units | SL:${combined.stopLoss?.toFixed(2)} | TP:${combined.takeProfit?.toFixed(2)}`);
    } catch (err: unknown) {
      log(`  ${symbol}: Error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(`📊 Portfolio: $${portfolioValue.toFixed(2)} | Signals: ${signalsGenerated.length} | Positions: ${onChainPositions.length}`);

  setSignals(signalsGenerated as any);

  return NextResponse.json({
    ran: true,
    logs,
    signals: signalsGenerated,
    portfolioValue,
    onChainPositions,
    macroAlert: macroAnalysis?.hasHighImpactSoon ? macroAnalysis.nextHighImpactEvent : null,
  });
}
