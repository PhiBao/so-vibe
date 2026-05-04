// Funding Rate & Liquidation Analysis — from Vibe-Trading perp-funding-basis skill

import { SMA, EMA } from "./indicators.js";

// ─── Funding Rate Regime Detection ─────────────────────────
// High positive funding = longs pay shorts (crowded long → short opportunity)
// High negative funding = shorts pay longs (crowded short → long opportunity)

export function analyzeFunding(fundingHistory, currentPrice) {
  if (!fundingHistory || fundingHistory.length < 3) {
    return { regime: "unknown", signal: 0, details: {} };
  }

  const rates = fundingHistory.map(f => parseFloat(f.rate || f.fundingRate || 0));
  const recent = rates.slice(-8); // last 8 funding periods (64h)
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const current = rates[rates.length - 1];
  const annualized = current * 3 * 365; // 8h periods → annual

  // Regime classification
  let regime = "neutral";
  let signal = 0;
  let confidence = 0;

  if (annualized > 0.5) {
    // Very high positive funding → shorts earn, longs crowded
    regime = "extreme_long_crowding";
    signal = -0.6;
    confidence = Math.min(0.8, 0.5 + annualized * 0.1);
  } else if (annualized > 0.2) {
    regime = "long_crowding";
    signal = -0.3;
    confidence = 0.55;
  } else if (annualized < -0.5) {
    // Very high negative funding → longs earn, shorts crowded
    regime = "extreme_short_crowding";
    signal = 0.6;
    confidence = Math.min(0.8, 0.5 + Math.abs(annualized) * 0.1);
  } else if (annualized < -0.2) {
    regime = "short_crowding";
    signal = 0.3;
    confidence = 0.55;
  }

  // Funding trend (is it increasing or decreasing?)
  const sma3 = SMA(recent, 3);
  const fundingTrend = sma3[sma3.length - 1] > sma3[sma3.length - 2] ? "rising" : "falling";

  // Mean reversion signal: if funding is extreme AND reversing
  if (Math.abs(annualized) > 0.3) {
    if (annualized > 0 && fundingTrend === "falling") {
      signal *= 1.3; // Stronger short signal (crowding unwinding)
      confidence *= 1.1;
    } else if (annualized < 0 && fundingTrend === "rising") {
      signal *= 1.3; // Stronger long signal
      confidence *= 1.1;
    }
  }

  return {
    regime,
    signal: Math.max(-1, Math.min(1, signal)),
    confidence: Math.min(1, confidence),
    details: {
      currentRate: current,
      annualized: annualized.toFixed(2) + "%",
      avg8h: avg.toFixed(6),
      trend: fundingTrend,
    },
  };
}

// ─── Liquidation Cascade Detection ─────────────────────────
// From Vibe-Trading liquidation-heatmap skill

export function analyzeLiquidationRisk(candles, currentPrice, openInterest = null) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const last = closes.length - 1;
  const atr = candles.length > 14 ? 
    candles.slice(-14).reduce((sum, c, i, arr) => {
      if (i === 0) return sum + (c.high - c.low);
      return sum + Math.max(c.high - c.low, Math.abs(c.high - arr[i-1].close), Math.abs(c.low - arr[i-1].close));
    }, 0) / 14 : currentPrice * 0.02;

  // Detect stop-hunt zones (areas where many stops likely cluster)
  const recent = candles.slice(-20);
  const swingLows = [];
  const swingHighs = [];

  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
        recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) {
      swingLows.push(recent[i].low);
    }
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high &&
        recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
      swingHighs.push(recent[i].high);
    }
  }

  // Check if price is near a stop-hunt zone
  let stopHuntSignal = 0;
  let stopHuntZone = null;

  for (const low of swingLows) {
    const dist = (currentPrice - low) / currentPrice;
    if (dist < 0.005 && dist > 0) {
      // Price is just above a swing low — potential stop hunt
      stopHuntSignal = 0.4;
      stopHuntZone = low;
      break;
    }
  }
  for (const high of swingHighs) {
    const dist = (high - currentPrice) / currentPrice;
    if (dist < 0.005 && dist > 0) {
      stopHuntSignal = -0.4;
      stopHuntZone = high;
      break;
    }
  }

  // Volume spike near stop-hunt zone = higher probability
  const avgVol = SMA(volumes, 20);
  const volSpike = volumes[last] > avgVol[last] * 1.5;
  if (volSpike && stopHuntSignal !== 0) {
    stopHuntSignal *= 1.5;
  }

  return {
    signal: Math.max(-1, Math.min(1, stopHuntSignal)),
    confidence: stopHuntSignal !== 0 ? (volSpike ? 0.7 : 0.5) : 0,
    stopHuntZone,
    swingLows: swingLows.slice(-3),
    swingHighs: swingHighs.slice(-3),
    atr,
  };
}

// ─── Carry Trade (Funding Arbitrage) ───────────────────────
// Earn funding by being on the side that receives payments

export function analyzeCarryOpportunity(fundingHistory, currentPrice) {
  if (!fundingHistory || fundingHistory.length < 10) return null;

  const rates = fundingHistory.map(f => parseFloat(f.rate || f.fundingRate || 0));
  const avg30 = rates.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, rates.length);
  const avg7 = rates.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, rates.length);

  // Consistent positive funding → go short to earn
  if (avg7 > 0.0005 && avg30 > 0.0003) {
    return {
      direction: "short",
      expectedDailyYield: avg7 * 3, // 3 funding periods per day
      annualizedYield: avg7 * 3 * 365,
      confidence: 0.6,
      reason: `Funding consistently positive (${(avg7 * 100).toFixed(4)}% per 8h)`,
    };
  }

  // Consistent negative funding → go long to earn
  if (avg7 < -0.0005 && avg30 < -0.0003) {
    return {
      direction: "long",
      expectedDailyYield: Math.abs(avg7) * 3,
      annualizedYield: Math.abs(avg7) * 3 * 365,
      confidence: 0.6,
      reason: `Funding consistently negative (${(avg7 * 100).toFixed(4)}% per 8h)`,
    };
  }

  return null;
}
