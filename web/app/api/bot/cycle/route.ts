import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { readBotState, writeBotState } from "@/lib/data-store";
import { setSignals } from "@/lib/signal-store";
import { getCachedSentiment } from "@/lib/sentiment-engine";
import { getETFSignal } from "@/lib/sosovalue/etf";
import { getMacroSignal } from "@/lib/sosovalue/macro";
import { explainSignal } from "@/lib/engine/llm-agent";
import { getMarketSnapshot } from "@/lib/sosovalue/market";

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

  let portfolioValue = portfolioValueFromClient || 1000;
  const onChainPositions: Array<{ symbol: string; side: string }> = [];

  if (walletAddress) {
    try {
      await initDex();
      const adapter = getAdapter();
      const traderState = await adapter.getTraderState(walletAddress);
      portfolioValue = traderState.collateral || portfolioValue;
      for (const pos of traderState.positions) {
        if (pos.symbol && pos.side) onChainPositions.push({ symbol: pos.symbol, side: pos.side });
      }
      log(`  Wallet: $${portfolioValue.toFixed(2)} | ${onChainPositions.length} on-chain positions`);
    } catch (err: unknown) {
      log(`  ⚠ Balance fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    log(`  ⚠ No wallet address — cannot check on-chain positions`);
  }

  const { getCandles, getCurrentPrice, getFundingRate, getAllMarketLimits } = await import("@/lib/engine/market.js");
  const { TrendFollowing, MeanReversion, Momentum, SRBounce, VolumeBreakout, synthesizeSignals, synthesizeMultiTF } = await import("@/lib/engine/signals.js");
  const { analyzeFunding } = await import("@/lib/engine/funding.js");

  try { await initDex(); } catch (err: unknown) {
    log(`⚠ DEX init failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let marketLimits: Record<string, any> = {};
  try { marketLimits = await getAllMarketLimits(); } catch {}

  const baseSymbols = symbols.map(s => s.split("-")[0]);

  let sentimentMap: Record<string, any> = {};
  try { sentimentMap = await getCachedSentiment(baseSymbols); } catch {}

  let etfMap: Record<string, any> = {};
  try {
    const etfResults = await Promise.all(
      baseSymbols.map(async (sym) => { try { return { sym, data: await getETFSignal(sym) }; } catch { return { sym, data: null }; } })
    );
    for (const { sym, data } of etfResults) { if (data) etfMap[sym] = data; }
  } catch {}

  let macroAnalysis: any = null;
  try { macroAnalysis = await getMacroSignal(); } catch { macroAnalysis = { signal: 0, confidence: 0, hasHighImpactSoon: false }; }
  if (macroAnalysis?.hasHighImpactSoon) log(`  ⚠ High-impact macro event approaching: ${macroAnalysis.nextHighImpactEvent?.name || "unknown"}`);

  const signalsGenerated: Array<Record<string, unknown>> = [];

  for (const symbol of symbols) {
    try {
      const baseSym = symbol.split("-")[0];
      const price = (await getCurrentPrice(symbol)) || 0;
      if (!price) continue;

      const sw: Record<string, number> = {};
      for (const [key, cfg] of Object.entries(strategyConfig)) { if (cfg.enabled) sw[key] = cfg.weight; }

      let fundingSignal: { signal: number; confidence: number } = { signal: 0, confidence: 0 };
      try {
        const fd = await getFundingRate(symbol);
        if (fd) { const fa = analyzeFunding([fd], price) as any; fundingSignal = { signal: fa.signal || 0, confidence: fa.confidence || 0 }; }
      } catch {}

      const marketMaxLev = marketLimits[symbol]?.maxLeverage || 10;
      const etfFlow = strategyEnabled("etf_flow") ? (etfMap[baseSym] || null) : null;
      const sentiment = strategyEnabled("sosovalue_sentiment") ? (sentimentMap[baseSym] || null) : null;

      // ─── Multi-Timeframe Analysis ─────────────────────────
      const tfResults: Record<string, any> = {};
      for (const interval of ["15m", "1h", "4h", "1d"]) {
        let tfCandles;
        try { tfCandles = await getCandles(symbol, interval, 100); if (!tfCandles || tfCandles.length < 30) tfCandles = null; } catch { tfCandles = null; }
        if (!tfCandles) { tfResults[interval] = { action: "hold", signal: 0, confidence: 0, details: [], vibeScore: null }; continue; }

        const tfStrats = [];
        if (strategyEnabled("trend_following")) tfStrats.push(TrendFollowing(tfCandles));
        if (strategyEnabled("mean_reversion")) tfStrats.push(MeanReversion(tfCandles));
        if (strategyEnabled("momentum")) tfStrats.push(Momentum(tfCandles));
        if (strategyEnabled("sr_bounce")) tfStrats.push(SRBounce(tfCandles));
        if (strategyEnabled("volume_breakout")) tfStrats.push(VolumeBreakout(tfCandles));

        tfResults[interval] = synthesizeSignals(tfStrats, price, {
          maxLeverage: marketMaxLev,
          sentiment: interval === "1h" ? (sentiment || undefined) : undefined,
          funding: interval === "1h" && fundingSignal.signal !== 0 ? fundingSignal : undefined,
          etfFlow: interval === "1h" ? (etfFlow || undefined) : undefined,
          macroSignal: interval === "1h" ? macroAnalysis : undefined,
          strategyWeights: Object.keys(sw).length > 0 ? sw : undefined,
        });
      }

      const combined = synthesizeMultiTF(tfResults, price, { maxLeverage: marketMaxLev });

      // Position sizing
      const { computePositionSize } = await import("@/lib/engine/signals.js");
      const margin = portfolioValue * (maxMarginPct / 100);
      const notional = margin * marketMaxLev;
      const baseSize = notional / price;
      const sized = computePositionSize(baseSize, combined.vibeScore, combined.signal);

      // Logging
      if ((combined as any).tfs?.length) {
        log(`  ${symbol}: $${price.toFixed(2)} [${(combined as any).tfs.map((v: any) => `${v.tf}:${v.signal > 0 ? "▲" : v.signal < 0 ? "▼" : "◆"}${v.signal.toFixed(1)}`).join(" ")}] → sig:${combined.signal.toFixed(2)} conf:${(combined.confidence * 100).toFixed(1)}%${(combined as any).tfAgreement ? " ⚡TF" : ""}`);
      }
      if (sentiment?.confidence > 0) {
        log(`    📰 Sentiment: ${sentiment.score > 0 ? "bullish" : sentiment.score < 0 ? "bearish" : "neutral"} (${(sentiment.confidence * 100).toFixed(0)}% conf)`);
        if (sentiment.keyNarratives?.length) log(`    📝 ${sentiment.keyNarratives.join(" | ")}`);
      }
      if (etfFlow) log(`    🏦 ETF: $${(etfFlow.meta?.latestInflow / 1e6 || 0).toFixed(1)}M net | ${etfFlow.meta?.trend7d}`);
      if (combined.vibeScore) {
        const v = combined.vibeScore;
        log(`    🎵 Vibe: ${v.vibe > 0 ? "bullish" : v.vibe < 0 ? "bearish" : "neutral"} (${(v.confidence * 100).toFixed(0)}%)${v.fullConsensus ? " 🔒" : ""}${sized.isHedged ? ` | HEDGE ${(sized.multiplier * 100).toFixed(0)}%` : ""}`);
      }

      if (combined.action === "hold" || combined.confidence < minConfidence) {
        if (combined.confidence < minConfidence) log(`    ⏸ Below threshold (${(combined.confidence * 100).toFixed(1)}%)`);
        else if (combined.holdReason) log(`    ⏸ Hold: ${combined.holdReason}`);
        continue;
      }

      const hasPosition = onChainPositions.find((p) => p.symbol === symbol);
      if (hasPosition) { log(`    ⏸ Already have ${hasPosition.side} on ${symbol}`); continue; }

      // LLM reasoning
      let llmReasoning: string | null = null;
      let llmRiskFactors: string[] = [];
      try {
        const explanation = await explainSignal(baseSym, {
          action: combined.action, signal: combined.signal, confidence: combined.confidence,
          longVotes: combined.longVotes, shortVotes: combined.shortVotes,
          details: combined.details, vibeScore: combined.vibeScore, price,
        }, { llm: sentiment, etfFlow });
        llmReasoning = explanation.reasoning;
        llmRiskFactors = explanation.riskFactors;
        if (llmReasoning) log(`    🧠 ${llmReasoning}`);
      } catch {}

      const signal = {
        id: `sig_${Date.now()}_${symbol}`, symbol, side: combined.action,
        entryPrice: price, size: sized.size, leverage: marketMaxLev,
        stopLoss: combined.stopLoss, takeProfit: combined.takeProfit,
        confidence: combined.confidence, longVotes: combined.longVotes,
        shortVotes: combined.shortVotes, reasoning: llmReasoning,
        riskFactors: llmRiskFactors, vibeScore: combined.vibeScore,
        tfAgreement: (combined as any).tfAgreement, tfVotes: (combined as any).tfs || [],
        etfFlow: etfFlow ? { signal: etfFlow.signal, trend: etfFlow.meta?.trend7d, latestInflow: etfFlow.meta?.latestInflow } : null,
        macroAlert: macroAnalysis?.hasHighImpactSoon ? macroAnalysis.nextHighImpactEvent?.name : null,
        details: [
          ...(combined.details || []),
          ...(etfFlow?.confidence > 0.2 ? [{ name: "etf_flow", signal: etfFlow.signal > 0 ? "bullish" : "bearish", confidence: (etfFlow.confidence * 100).toFixed(0) + "%", meta: etfFlow.meta }] : []),
          ...(sentiment?.confidence > 0 ? [{ name: "sosovalue_sentiment", signal: sentiment.score > 0 ? "bullish" : sentiment.score < 0 ? "bearish" : "neutral", confidence: (sentiment.confidence * 100).toFixed(0) + "%", meta: { articles: sentiment.articleCount, narratives: sentiment.keyNarratives } }] : []),
        ],
        queuedAt: Date.now(),
      };
      signalsGenerated.push(signal);
      log(`    🔔 SIGNAL: ${combined.action.toUpperCase()} ${symbol} | $${price.toFixed(2)} | ${sized.size.toFixed(4)}u | SL:${combined.stopLoss?.toFixed(2)} | TP:${combined.takeProfit?.toFixed(2)}`);
    } catch (err: unknown) {
      log(`  ${symbol}: Error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(`📊 Portfolio: $${portfolioValue.toFixed(2)} | Signals: ${signalsGenerated.length} | Positions: ${onChainPositions.length}`);
  setSignals(signalsGenerated as any);

  return NextResponse.json({
    ran: true, logs, signals: signalsGenerated, portfolioValue, onChainPositions,
    macroAlert: macroAnalysis?.hasHighImpactSoon ? macroAnalysis.nextHighImpactEvent : null,
  });
}
