import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { generateSyntheticCandles } from "@/lib/dex/sodex-adapter";
import { readBotState, writeBotState } from "@/lib/data-store";
import { setSignals } from "@/lib/signal-store";
import { getCachedSentiment } from "@/lib/sentiment-engine";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const symbols: string[] = body.symbols || ["SOL-USD", "ETH-USD", "BTC-USD"];
  const minConfidence = body.minConfidence || 0.55;
  const maxMarginPct = body.maxMarginPct || 20;
  const walletAddress = body.walletAddress || "";
  const portfolioValueFromClient = body.portfolioValue || 0;

  // Increment cycle counter
  const state = readBotState();
  state.cycle = (state.cycle || 0) + 1;
  writeBotState(state);

  const logs: string[] = [];
  function log(line: string) {
    logs.push(line);
  }

  log(`🔄 Cycle #${state.cycle} start`);

  // Fetch real balance + positions if wallet connected
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

  // Import engine modules dynamically
  const { getCandles, getCurrentPrice, getFundingRate, getAllMarketLimits } = await import(
    "@/lib/engine/market.js"
  );
  const { TrendFollowing, MeanReversion, Momentum, SRBounce, VolumeBreakout, synthesizeSignals } =
    await import("@/lib/engine/signals.js");
  const { analyzeFunding } = await import("@/lib/engine/funding.js");

  try {
    await initDex();
  } catch (err: unknown) {
    log(`⚠ DEX init failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Fetch dynamic market limits
  let marketLimits: Record<string, any> = {};
  try {
    marketLimits = await getAllMarketLimits();
  } catch {}

  // Fetch SoSoValue sentiment once for all symbols
  let sentimentMap: Record<string, any> = {};
  try {
    sentimentMap = await getCachedSentiment(symbols);
  } catch {
    // sentiment unavailable — continue without it
  }

  const signalsGenerated: Array<Record<string, unknown>> = [];

  for (const symbol of symbols) {
    try {
      let candles = await getCandles(symbol, "1h", 100);
      if (!candles || candles.length < 50) {
        log(`  ${symbol}: real klines unavailable — using synthetic data`);
        candles = generateSyntheticCandles(symbol, 100);
      }

      const price = (await getCurrentPrice(symbol)) || candles[candles.length - 1].close;

      const strategies = [
        TrendFollowing(candles),
        MeanReversion(candles),
        Momentum(candles),
        SRBounce(candles),
        VolumeBreakout(candles),
      ];

      let fundingSignal: { signal: number; confidence: number } = { signal: 0, confidence: 0 };
      try {
        const fundingData = await getFundingRate(symbol);
        if (fundingData) {
          const fa = analyzeFunding([fundingData], price) as { signal: number; confidence: number };
          fundingSignal = { signal: fa.signal || 0, confidence: fa.confidence || 0 };
        }
      } catch {}

      // Use market-specific max leverage from DEX
      const marketMaxLev = marketLimits[symbol]?.maxLeverage || 10;
      const margin = portfolioValue * (maxMarginPct / 100);
      const notional = margin * marketMaxLev;
      const positionSize = notional / price;

      const combined = synthesizeSignals(strategies, price, { maxLeverage: marketMaxLev });
      if (fundingSignal.signal !== 0) {
        combined.signal = combined.signal * 0.8 + fundingSignal.signal * 0.2;
        combined.confidence = Math.min(1, combined.confidence + fundingSignal.confidence * 0.1);
      }

      // Blend SoSoValue news sentiment
      const sentiment = sentimentMap[symbol];
      if (sentiment && sentiment.confidence > 0) {
        const sScore = sentiment.score; // -1..1
        const sConf = sentiment.confidence;
        // Sentiment acts as a tie-breaker / amplifier
        combined.signal = combined.signal * (1 - sConf * 0.25) + sScore * sConf * 0.25;
        combined.confidence = Math.min(1, combined.confidence + sConf * 0.1);
        log(`    📰 SoSoValue sentiment: ${sScore > 0 ? "bullish" : sScore < 0 ? "bearish" : "neutral"} (${(sConf * 100).toFixed(0)}% conf, ${sentiment.articleCount} articles)`);
      }

      const stratLog = strategies
        .map(
          (s: { name: string; signal: number }) =>
            `${s.name.slice(0, 6)}:${s.signal > 0 ? "▲" : s.signal < 0 ? "▼" : "◆"}${s.signal.toFixed(1)}`
        )
        .join(" ");
      log(
        `  ${symbol}: $${price.toFixed(2)} ${combined.signal > 0 ? "▲" : combined.signal < 0 ? "▼" : "◆"} sig:${combined.signal.toFixed(
          2
        )} conf:${(combined.confidence * 100).toFixed(1)}% maxLev:${marketMaxLev}x | ${stratLog}`
      );

      if (combined.action === "hold" || combined.confidence < minConfidence) {
        if (combined.confidence < minConfidence) {
          log(`    ⏸ Below threshold (${(combined.confidence * 100).toFixed(1)}% < ${(minConfidence * 100).toFixed(1)}%)`);
        } else if (combined.holdReason) {
          log(
            `    ⏸ Hold: ${combined.holdReason} (sig:${combined.signal.toFixed(2)} conf:${(combined.confidence * 100).toFixed(
              1
            )}% votes:▲${combined.longVotes}▼${combined.shortVotes})`
          );
        } else {
          log(`    ⏸ Hold: weak signal (sig:${combined.signal.toFixed(2)})`);
        }
        continue;
      }

      // Check real on-chain positions — don't duplicate
      const hasPosition = onChainPositions.find((p) => p.symbol === symbol);
      if (hasPosition) {
        log(`    ⏸ Already have ${hasPosition.side} position on ${symbol} (on-chain)`);
        continue;
      }

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
        details: [
          ...(combined.details || []),
          ...(sentiment && sentiment.confidence > 0 ? [{
            name: "sosovalue_sentiment",
            signal: sentiment.score > 0 ? "bullish" : sentiment.score < 0 ? "bearish" : "neutral",
            confidence: (sentiment.confidence * 100).toFixed(0) + "%",
            meta: { articles: sentiment.articleCount, headline: sentiment.latestHeadline },
          }] : []),
        ],
        queuedAt: Date.now(),
      };
      signalsGenerated.push(signal);
      log(
        `    🔔 SIGNAL: ${combined.action.toUpperCase()} ${symbol} | $${price.toFixed(2)} | ${positionSize.toFixed(
          4
        )} units | SL:${combined.stopLoss?.toFixed(2)} | TP:${combined.takeProfit?.toFixed(2)}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`  ${symbol}: Error — ${msg}`);
    }
  }

  log(`📊 Portfolio: $${portfolioValue.toFixed(2)} | Signals: ${signalsGenerated.length} | Positions: ${onChainPositions.length}`);

  // Persist signals server-side so all pages can access them
  setSignals(signalsGenerated as any);

  return NextResponse.json({
    ran: true,
    logs,
    signals: signalsGenerated,
    portfolioValue,
    onChainPositions,
  });
}
