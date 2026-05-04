// Signal Engine — Vibe-Trading pattern: generate(data_map) → signal_map
// Signal range: [-1.0, 1.0] where 1.0 = full long, -1.0 = full short, 0.0 = flat

import { RSI, MACD, BollingerBands, EMA, ATR, SupportResistance, SMA } from "./indicators.js";

// ─── Base Signal Engine Contract ────────────────────────────
// Every strategy must implement: generate(candles) → { signal: -1..1, confidence: 0..1, meta: {} }

// ─── 1. Trend Following (EMA Cross + ADX) ──────────────────
export function TrendFollowing(candles) {
  const closes = candles.map(c => c.close);
  const ema9 = EMA(closes, 9);
  const ema21 = EMA(closes, 21);
  const ema50 = EMA(closes, 50);
  const rsi = RSI(closes, 14);
  const atr = ATR(candles, 14);
  const last = closes.length - 1;

  const trendUp = ema9[last] > ema21[last] && ema21[last] > ema50[last];
  const trendDown = ema9[last] < ema21[last] && ema21[last] < ema50[last];
  const emaCrossUp = ema9[last - 1] <= ema21[last - 1] && ema9[last] > ema21[last];
  const emaCrossDown = ema9[last - 1] >= ema21[last - 1] && ema9[last] < ema21[last];

  let signal = 0;
  let confidence = 0;

  if (trendUp && rsi[last] < 65) {
    signal = 0.7;
    confidence = 0.7;
    if (emaCrossUp) { signal = 1.0; confidence = 0.85; }
  } else if (trendDown && rsi[last] > 35) {
    signal = -0.7;
    confidence = 0.7;
    if (emaCrossDown) { signal = -1.0; confidence = 0.85; }
  }

  return {
    name: "trend_following",
    signal, confidence,
    stopLoss: signal > 0 ? closes[last] - (atr[last] || closes[last] * 0.02) * 1.5
      : signal < 0 ? closes[last] + (atr[last] || closes[last] * 0.02) * 1.5 : null,
    meta: { trendUp, trendDown, emaCrossUp, emaCrossDown, rsi: rsi[last] },
  };
}

// ─── 2. Mean Reversion (Bollinger + RSI) ────────────────────
export function MeanReversion(candles) {
  const closes = candles.map(c => c.close);
  const rsi = RSI(closes, 14);
  const bb = BollingerBands(closes, 20, 2);
  const atr = ATR(candles, 14);
  const last = closes.length - 1;

  let signal = 0;
  let confidence = 0;

  // Oversold + below lower band → long
  if (closes[last] < bb.lower[last] && rsi[last] < 30) {
    signal = 0.8;
    confidence = 0.75;
    // Stronger if volume confirms
    const vol = candles[last].volume;
    const avgVol = SMA(candles.map(c => c.volume), 20);
    if (vol > avgVol[last] * 1.5) { signal = 1.0; confidence = 0.85; }
  }
  // Overbought + above upper band → short
  else if (closes[last] > bb.upper[last] && rsi[last] > 70) {
    signal = -0.8;
    confidence = 0.75;
    const vol = candles[last].volume;
    const avgVol = SMA(candles.map(c => c.volume), 20);
    if (vol > avgVol[last] * 1.5) { signal = -1.0; confidence = 0.85; }
  }
  // Middle band bounce
  else if (Math.abs(closes[last] - bb.middle[last]) / bb.middle[last] < 0.005) {
    if (rsi[last] < 45) { signal = 0.4; confidence = 0.5; }
    else if (rsi[last] > 55) { signal = -0.4; confidence = 0.5; }
  }

  return {
    name: "mean_reversion",
    signal, confidence,
    stopLoss: signal > 0 ? bb.lower[last] - (atr[last] || closes[last] * 0.01)
      : signal < 0 ? bb.upper[last] + (atr[last] || closes[last] * 0.01) : null,
    meta: { bbPosition: closes[last] < bb.lower[last] ? "below" : closes[last] > bb.upper[last] ? "above" : "middle", rsi: rsi[last] },
  };
}

// ─── 3. Momentum (MACD + Volume) ────────────────────────────
export function Momentum(candles) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const macd = MACD(closes, 12, 26, 9);
  const rsi = RSI(closes, 14);
  const atr = ATR(candles, 14);
  const avgVol = SMA(volumes, 20);
  const last = closes.length - 1;
  const prev = last - 1;

  let signal = 0;
  let confidence = 0;

  const macdCrossUp = macd.histogram[prev] < 0 && macd.histogram[last] > 0;
  const macdCrossDown = macd.histogram[prev] > 0 && macd.histogram[last] < 0;
  const highVolume = volumes[last] > avgVol[last] * 1.3;

  // Bullish momentum: MACD cross up + volume + RSI not overbought
  if (macdCrossUp && rsi[last] < 65) {
    signal = highVolume ? 0.9 : 0.6;
    confidence = highVolume ? 0.8 : 0.6;
  }
  // Bearish momentum: MACD cross down + volume + RSI not oversold
  else if (macdCrossDown && rsi[last] > 35) {
    signal = highVolume ? -0.9 : -0.6;
    confidence = highVolume ? 0.8 : 0.6;
  }
  // Continuation: strong histogram + trend
  else if (macd.histogram[last] > 0 && macd.histogram[last] > macd.histogram[prev] && rsi[last] > 50 && rsi[last] < 70) {
    signal = 0.5;
    confidence = 0.55;
  } else if (macd.histogram[last] < 0 && macd.histogram[last] < macd.histogram[prev] && rsi[last] < 50 && rsi[last] > 30) {
    signal = -0.5;
    confidence = 0.55;
  }

  return {
    name: "momentum",
    signal, confidence,
    stopLoss: signal > 0 ? closes[last] - (atr[last] || closes[last] * 0.02) * 2
      : signal < 0 ? closes[last] + (atr[last] || closes[last] * 0.02) * 2 : null,
    meta: { macdCrossUp, macdCrossDown, highVolume, histogram: macd.histogram[last] },
  };
}

// ─── 4. Support/Resistance Bounce ──────────────────────────
export function SRBounce(candles) {
  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  const sr = SupportResistance(candles);
  const atr = ATR(candles, 14);
  const rsi = RSI(closes, 14);
  const last = closes.length - 1;

  let signal = 0;
  let confidence = 0;

  // Find nearest levels
  const supports = sr.filter(l => l.type === "support" && l.price < currentPrice);
  const resistances = sr.filter(l => l.type === "resistance" && l.price > currentPrice);
  const nearSupport = supports[0];
  const nearResistance = resistances[0];

  if (nearSupport) {
    const distPct = (currentPrice - nearSupport.price) / currentPrice;
    if (distPct < 0.01 && rsi[last] < 40) {
      // Bounce off support
      signal = 0.6 + nearSupport.strength * 0.1;
      confidence = 0.6 + nearSupport.strength * 0.05;
    }
  }

  if (nearResistance) {
    const distPct = (nearResistance.price - currentPrice) / currentPrice;
    if (distPct < 0.01 && rsi[last] > 60) {
      // Rejection at resistance
      signal = -(0.6 + nearResistance.strength * 0.1);
      confidence = 0.6 + nearResistance.strength * 0.05;
    }
  }

  signal = Math.max(-1, Math.min(1, signal));
  confidence = Math.min(1, confidence);

  return {
    name: "sr_bounce",
    signal, confidence,
    stopLoss: signal > 0 ? (nearSupport?.price || currentPrice * 0.97)
      : signal < 0 ? (nearResistance?.price || currentPrice * 1.03) : null,
    takeProfit: signal > 0 ? (nearResistance?.price || currentPrice * 1.04)
      : signal < 0 ? (nearSupport?.price || currentPrice * 0.96) : null,
    meta: { nearSupport: nearSupport?.price, nearResistance: nearResistance?.price },
  };
}

// ─── 5. Volume Profile Strategy ────────────────────────────
export function VolumeBreakout(candles) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const last = closes.length - 1;
  const atr = ATR(candles, 14);
  const avgVol = SMA(volumes, 20);
  const ema9 = EMA(closes, 9);
  const ema21 = EMA(closes, 21);

  let signal = 0;
  let confidence = 0;

  // Volume spike detection
  const volRatio = volumes[last] / (avgVol[last] || 1);
  const priceChange = (closes[last] - closes[last - 1]) / closes[last - 1];

  if (volRatio > 2.0 && Math.abs(priceChange) > 0.005) {
    // High volume breakout
    if (priceChange > 0 && ema9[last] > ema21[last]) {
      signal = Math.min(1, volRatio * 0.3);
      confidence = Math.min(0.85, 0.5 + volRatio * 0.1);
    } else if (priceChange < 0 && ema9[last] < ema21[last]) {
      signal = Math.max(-1, -volRatio * 0.3);
      confidence = Math.min(0.85, 0.5 + volRatio * 0.1);
    }
  }
  // Volume divergence (price up, volume down → weak move)
  else if (priceChange > 0.01 && volRatio < 0.7) {
    signal = -0.3;
    confidence = 0.5;
  } else if (priceChange < -0.01 && volRatio < 0.7) {
    signal = 0.3;
    confidence = 0.5;
  }

  return {
    name: "volume_breakout",
    signal, confidence,
    stopLoss: signal > 0 ? closes[last] - (atr[last] || closes[last] * 0.02) * 1.5
      : signal < 0 ? closes[last] + (atr[last] || closes[last] * 0.02) * 1.5 : null,
    meta: { volRatio, priceChange },
  };
}

// ─── Swarm Synthesizer (combines all strategies) ───────────
// options: { maxLeverage: number }
export function synthesizeSignals(strategies, currentPrice, options = {}) {
  const maxLeverage = options.maxLeverage || 1;

  // Weight by confidence
  let weightedSignal = 0;
  let totalWeight = 0;
  const details = [];

  for (const s of strategies) {
    if (s.signal === 0) continue;
    const weight = s.confidence;
    weightedSignal += s.signal * weight;
    totalWeight += weight;
    details.push({ name: s.name, signal: s.signal.toFixed(2), confidence: s.confidence.toFixed(2) });
  }

  const activeStrategies = strategies.filter(s => s.signal !== 0);
  const activeCount = activeStrategies.length;

  const finalSignal = totalWeight > 0 ? weightedSignal / totalWeight : 0;
  const avgConfidence = activeCount > 0 ? totalWeight / activeCount : 0;

  // Agreement bonus: if 3+ strategies agree direction
  const longCount = strategies.filter(s => s.signal > 0.3).length;
  const shortCount = strategies.filter(s => s.signal < -0.3).length;
  const agreementBonus = Math.max(longCount, shortCount) >= 3 ? 0.15 : 0;

  const adjustedConfidence = Math.min(1, avgConfidence + agreementBonus);

  // Consensus filter: require at least 2 strategies to agree on the FINAL direction,
  // OR a very strong weighted signal, OR only 1 strategy is active (no one to disagree with)
  const supportingCount = strategies.filter(s =>
    finalSignal > 0 ? s.signal > 0 : s.signal < 0
  ).length;
  const strongDisagreement = (longCount >= 1 && shortCount >= 1) && Math.abs(finalSignal) < 0.4;
  const hasConsensus = supportingCount >= 2 || Math.abs(finalSignal) >= 0.6 || activeCount === 1;

  // Determine action — use inclusive threshold so edge cases like -0.30 trigger
  let action = "hold";
  if (finalSignal >= 0.25 && adjustedConfidence >= 0.5 && hasConsensus) action = "long";
  else if (finalSignal <= -0.25 && adjustedConfidence >= 0.5 && hasConsensus) action = "short";

  // Hold reason for logging
  let holdReason = "";
  if (Math.abs(finalSignal) < 0.25) holdReason = "weak_signal";
  else if (adjustedConfidence < 0.5) holdReason = "low_confidence";
  else if (!hasConsensus) holdReason = strongDisagreement ? "strong_disagreement" : "no_consensus";

  // Best stop loss from highest confidence strategy
  const bestStrategy = strategies.filter(s => s.stopLoss).sort((a, b) => b.confidence - a.confidence)[0];
  const atr = strategies.find(s => s.meta?.atr)?.meta?.atr || currentPrice * 0.02;

  let stopLoss = bestStrategy?.stopLoss || null;
  let takeProfit = bestStrategy?.takeProfit || null;

  if (!stopLoss && action === "long") stopLoss = currentPrice - atr * 1.5;
  if (!stopLoss && action === "short") stopLoss = currentPrice + atr * 1.5;
  if (!takeProfit && action === "long") takeProfit = currentPrice + atr * 3;
  if (!takeProfit && action === "short") takeProfit = currentPrice - atr * 3;

  return {
    action,
    signal: Math.max(-1, Math.min(1, finalSignal)),
    confidence: adjustedConfidence,
    entryPrice: currentPrice,
    stopLoss,
    takeProfit,
    leverage: maxLeverage, // use config leverage directly
    details,
    longVotes: longCount,
    shortVotes: shortCount,
    hasConsensus,
    holdReason,
  };
}
