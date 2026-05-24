/**
 * ETF Flow Strategy — 8th swarm member
 * Uses SoSoValue ETF net inflow/outflow data as a directional signal.
 *
 * ETF flows are the single best institutional sentiment indicator:
 * - Consistent net inflows → institutional buying pressure → bullish
 * - Consistent net outflows → institutional selling/redemption → bearish
 * - Cumulative flow trend → long-term conviction level
 *
 * Signal range: [-1.0, 1.0] where positive = bullish (net inflows)
 */

export function ETFFlow(etfData) {
  const { signal: rawSignal = 0, confidence: rawConfidence = 0, meta = {} } = etfData || {};

  if (!etfData || rawConfidence < 0.2) {
    return {
      name: "etf_flow",
      signal: 0,
      confidence: 0,
      stopLoss: null,
      takeProfit: null,
      meta: { status: "insufficient_data" },
    };
  }

  // Amplify signal based on consecutive days (momentum in flows)
  const consecutiveDays = meta.consecutiveDays || 0;
  let signal = rawSignal;
  let confidence = rawConfidence;

  // Consecutive day bonus: 3+ days of inflow → amplify
  if (consecutiveDays >= 5) {
    confidence = Math.min(1, confidence * 1.3);
    signal = Math.max(-1, Math.min(1, signal * 1.2));
  } else if (consecutiveDays >= 3) {
    confidence = Math.min(1, confidence * 1.15);
    signal = Math.max(-1, Math.min(1, signal * 1.1));
  }

  return {
    name: "etf_flow",
    signal,
    confidence,
    stopLoss: null,  // ETF flow is macro, not technical — no SL/TP
    takeProfit: null,
    meta: {
      latestInflow: meta.latestInflow,
      latestDate: meta.latestDate,
      totalNetAssets: meta.totalNetAssets,
      cumNetInflow: meta.cumNetInflow,
      consecutiveDays,
      trend7d: meta.trend7d,
      avgDailyInflow7d: meta.avgDailyInflow7d,
    },
  };
}
