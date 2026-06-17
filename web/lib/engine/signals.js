// Signal Engine — Vibe-Trading pattern: generate(data_map) → signal_map
// Signal range: [-1.0, 1.0] where 1.0 = full long, -1.0 = full short, 0.0 = flat

import { RSI, MACD, BollingerBands, EMA, ATR, SupportResistance, SMA } from "./indicators.js";

// ─── Base Signal Engine Contract ────────────────────────────
// Every strategy must implement: generate(data) → { signal: -1..1, confidence: 0..1, meta: {} }

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

  if (closes[last] < bb.lower[last] && rsi[last] < 30) {
    signal = 0.8;
    confidence = 0.75;
    const vol = candles[last].volume;
    const avgVol = SMA(candles.map(c => c.volume), 20);
    if (vol > avgVol[last] * 1.5) { signal = 1.0; confidence = 0.85; }
  }
  else if (closes[last] > bb.upper[last] && rsi[last] > 70) {
    signal = -0.8;
    confidence = 0.75;
    const vol = candles[last].volume;
    const avgVol = SMA(candles.map(c => c.volume), 20);
    if (vol > avgVol[last] * 1.5) { signal = -1.0; confidence = 0.85; }
  }
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

  if (macdCrossUp && rsi[last] < 65) {
    signal = highVolume ? 0.9 : 0.6;
    confidence = highVolume ? 0.8 : 0.6;
  }
  else if (macdCrossDown && rsi[last] > 35) {
    signal = highVolume ? -0.9 : -0.6;
    confidence = highVolume ? 0.8 : 0.6;
  }
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

  const supports = sr.filter(l => l.type === "support" && l.price < currentPrice);
  const resistances = sr.filter(l => l.type === "resistance" && l.price > currentPrice);
  const nearSupport = supports[0];
  const nearResistance = resistances[0];

  if (nearSupport) {
    const distPct = (currentPrice - nearSupport.price) / currentPrice;
    if (distPct < 0.01 && rsi[last] < 40) {
      signal = 0.6 + nearSupport.strength * 0.1;
      confidence = 0.6 + nearSupport.strength * 0.05;
    }
  }

  if (nearResistance) {
    const distPct = (nearResistance.price - currentPrice) / currentPrice;
    if (distPct < 0.01 && rsi[last] > 60) {
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

  const volRatio = volumes[last] / (avgVol[last] || 1);
  const priceChange = (closes[last] - closes[last - 1]) / closes[last - 1];

  if (volRatio > 2.0 && Math.abs(priceChange) > 0.005) {
    if (priceChange > 0 && ema9[last] > ema21[last]) {
      signal = Math.min(1, volRatio * 0.3);
      confidence = Math.min(0.85, 0.5 + volRatio * 0.1);
    } else if (priceChange < 0 && ema9[last] < ema21[last]) {
      signal = Math.max(-1, -volRatio * 0.3);
      confidence = Math.min(0.85, 0.5 + volRatio * 0.1);
    }
  }
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

// ─── 6. SoSoValue Sentiment Strategy ───────────────────────
export function SoSoValueSentiment(sentimentData) {
  const { score = 0, confidence = 0, articleCount = 0 } = sentimentData || {};
  if (confidence < 0.2 || articleCount === 0) {
    return { name: "sosovalue_sentiment", signal: 0, confidence: 0, meta: { articleCount } };
  }
  const signal = score * Math.min(1, confidence * 1.5);
  return {
    name: "sosovalue_sentiment",
    signal: Math.max(-1, Math.min(1, signal)),
    confidence: Math.min(1, confidence),
    meta: { articleCount, rawScore: score },
  };
}

// ─── 7. ETF Flow Strategy ──────────────────────────────────
export function ETFFlow(etfData) {
  const { signal: rawSignal = 0, confidence: rawConfidence = 0, meta = {} } = etfData || {};
  if (!etfData || rawConfidence < 0.2) {
    return { name: "etf_flow", signal: 0, confidence: 0, stopLoss: null, takeProfit: null, meta: { status: "insufficient_data" } };
  }
  let signal = rawSignal;
  let confidence = rawConfidence;
  const consecutiveDays = meta.consecutiveDays || 0;
  if (consecutiveDays >= 5) { confidence = Math.min(1, confidence * 1.3); signal = Math.max(-1, Math.min(1, signal * 1.2)); }
  else if (consecutiveDays >= 3) { confidence = Math.min(1, confidence * 1.15); signal = Math.max(-1, Math.min(1, signal * 1.1)); }
  return {
    name: "etf_flow",
    signal, confidence,
    stopLoss: null, takeProfit: null,
    meta: { latestInflow: meta.latestInflow, latestDate: meta.latestDate, totalNetAssets: meta.totalNetAssets, consecutiveDays, trend7d: meta.trend7d },
  };
}

// ─── Normalize weights to sum to 1.0 ──────────────────────
function normalizeWeights(weights) {
  if (!weights || Object.keys(weights).length === 0) return null;
  const total = Object.values(weights).reduce((sum, w) => sum + (Number(w) || 0), 0);
  if (total <= 0) return null;
  const norm = {};
  for (const [k, v] of Object.entries(weights)) norm[k] = (Number(v) || 0) / total;
  return norm;
}

// ─── Vibe Score v2 ─────────────────────────────────────────
// Defaults: Tech 30% | LLM Sentiment 20% | ETF Flow 15% | Funding 15% | Macro 10% | Market 10%
// If strategyWeights provided, they are normalized and override the defaults.
export function computeVibeScore(strategies, sentiment, funding, etfFlow = null, macroSignal = null, strategyWeights = null) {
  const techSignal = strategies.filter(s => s.signal !== 0);
  const techAvg = techSignal.length > 0
    ? techSignal.reduce((sum, s) => sum + s.signal * s.confidence, 0) / techSignal.reduce((sum, s) => sum + s.confidence, 0)
    : 0;
  const techConf = techSignal.length > 0
    ? techSignal.reduce((sum, s) => sum + s.confidence, 0) / techSignal.length
    : 0;

  const sentSignal = sentiment?.signal || 0;
  const sentConf = sentiment?.confidence || 0;

  const fundSignal = funding?.signal || 0;
  const fundConf = funding?.confidence || 0;

  const etfSignal = etfFlow?.signal || 0;
  const etfConf = etfFlow?.confidence || 0;

  const macroSig = macroSignal?.signal || 0;
  const macroConf = macroSignal?.confidence || 0;

  // Build weights: either from user config (normalized) or defaults
  const norm = normalizeWeights(strategyWeights);
  const wTech = norm ? (
    (norm.trend_following || 0) +
    (norm.mean_reversion || 0) +
    (norm.momentum || 0) +
    (norm.sr_bounce || 0) +
    (norm.volume_breakout || 0)
  ) : 0.30;
  const wSent = norm ? (norm.sosovalue_sentiment || 0) : 0.20;
  const wEtf = norm ? (norm.etf_flow || 0) : 0.15;
  const wFund = norm ? 0.15 : 0.15; // funding not toggleable, always 15%
  const wMacro = norm ? 0.10 : 0.10; // macro not toggleable, always 10%
  const wMarket = norm ? 0.10 : 0.10; // market context, always 10%
  // Re-normalize in case some categories are disabled
  const totalW = wTech + wSent + wEtf + wFund + wMacro + wMarket;
  const nTech = totalW > 0 ? wTech / totalW : 0;
  const nSent = totalW > 0 ? wSent / totalW : 0;
  const nEtf = totalW > 0 ? wEtf / totalW : 0;
  const nFund = totalW > 0 ? wFund / totalW : 0;
  const nMacro = totalW > 0 ? wMacro / totalW : 0;
  const nMarket = totalW > 0 ? wMarket / totalW : 0;

  const vibe = techAvg * nTech + sentSignal * nSent + etfSignal * nEtf + fundSignal * nFund + macroSig * nMacro + techAvg * nMarket;
  const vibeConf = Math.min(1, techConf * nTech + sentConf * nSent + etfConf * nEtf + fundConf * nFund + macroConf * nMacro + 0.10);

  // Full consensus: tech, sentiment, ETF, funding all agree
  const allLong = techAvg > 0.15 && sentSignal > 0.05 && etfSignal > 0 && fundSignal > 0;
  const allShort = techAvg < -0.15 && sentSignal < -0.05 && etfSignal < 0 && fundSignal < 0;
  const fullConsensus = allLong || allShort;

  return {
    vibe: Math.max(-1, Math.min(1, vibe)),
    confidence: vibeConf,
    fullConsensus,
    weights: { tech: nTech, sentiment: nSent, etf: nEtf, funding: nFund, macro: nMacro, market: nMarket },
    breakdown: {
      technical: { signal: techAvg, confidence: techConf },
      sentiment: { signal: sentSignal, confidence: sentConf },
      etfFlow: { signal: etfSignal, confidence: etfConf },
      funding: { signal: fundSignal, confidence: fundConf },
      macro: { signal: macroSig, confidence: macroConf },
    },
  };
}

// ─── AutoHedge Position Sizer ──────────────────────────────
export function computePositionSize(baseSize, vibeScore, technicalSignal) {
  const { vibe, confidence, fullConsensus } = vibeScore;
  const alignment = vibe * technicalSignal;
  let sizeMultiplier = 1.0;
  if (fullConsensus) {
    sizeMultiplier = 1.5;
  } else if (alignment > 0.3) {
    sizeMultiplier = 1.25;
  } else if (alignment < -0.2) {
    sizeMultiplier = 0.5;
  } else if (alignment < 0) {
    sizeMultiplier = 0.75;
  }
  sizeMultiplier *= (0.5 + confidence * 0.5);
  return {
    size: baseSize * sizeMultiplier,
    multiplier: sizeMultiplier,
    isHedged: alignment < -0.2,
    reason: fullConsensus ? "full_consensus" : alignment < -0.2 ? "hedge_conflict" : alignment < 0 ? "mild_conflict" : alignment > 0.3 ? "strong_alignment" : "neutral",
  };
}

// ─── Swarm Synthesizer (all strategies) ────────────────────
export function synthesizeSignals(strategies, currentPrice, options = {}) {
  const maxLeverage = options.maxLeverage || 1;
  const sentiment = options.sentiment || null;
  const funding = options.funding || null;
  const etfFlow = options.etfFlow || null;
  const macroSignal = options.macroSignal || null;
  const strategyWeights = options.strategyWeights || null;

  let allStrategies = [...strategies];

  // Add sentiment as peer strategy
  if (sentiment) allStrategies.push(SoSoValueSentiment(sentiment));
  // Add ETF flow as peer strategy
  if (etfFlow && etfFlow.confidence > 0.2) allStrategies.push(ETFFlow(etfFlow));

  let weightedSignal = 0;
  let totalWeight = 0;
  const details = [];

  for (const s of allStrategies) {
    if (s.signal === 0) continue;
    const weight = s.confidence;
    weightedSignal += s.signal * weight;
    totalWeight += weight;
    details.push({ name: s.name, signal: s.signal.toFixed(2), confidence: s.confidence.toFixed(2) });
  }

  const activeCount = allStrategies.filter(s => s.signal !== 0).length;
  const finalSignal = totalWeight > 0 ? weightedSignal / totalWeight : 0;
  const avgConfidence = activeCount > 0 ? totalWeight / activeCount : 0;

  const longCount = allStrategies.filter(s => s.signal > 0.3).length;
  const shortCount = allStrategies.filter(s => s.signal < -0.3).length;
  const agreementBonus = Math.max(longCount, shortCount) >= 3 ? 0.15 : 0;
  const adjustedConfidence = Math.min(1, avgConfidence + agreementBonus);

  const supportingCount = allStrategies.filter(s =>
    finalSignal > 0 ? s.signal > 0 : s.signal < 0
  ).length;
  const strongDisagreement = (longCount >= 1 && shortCount >= 1) && Math.abs(finalSignal) < 0.4;
  const hasConsensus = supportingCount >= 2 || Math.abs(finalSignal) >= 0.6 || activeCount === 1;

  let action = "hold";
  if (finalSignal >= 0.25 && adjustedConfidence >= 0.5 && hasConsensus) action = "long";
  else if (finalSignal <= -0.25 && adjustedConfidence >= 0.5 && hasConsensus) action = "short";

  let holdReason = "";
  if (Math.abs(finalSignal) < 0.25) holdReason = "weak_signal";
  else if (adjustedConfidence < 0.5) holdReason = "low_confidence";
  else if (!hasConsensus) holdReason = strongDisagreement ? "strong_disagreement" : "no_consensus";

  const vibeScore = computeVibeScore(allStrategies, sentiment, funding, etfFlow, macroSignal, strategyWeights);

  const bestStrategy = allStrategies.filter(s => s.stopLoss).sort((a, b) => b.confidence - a.confidence)[0];
  const atr = allStrategies.find(s => s.meta?.atr)?.meta?.atr || currentPrice * 0.02;

  let stopLoss = bestStrategy?.stopLoss || null;
  let takeProfit = bestStrategy?.takeProfit || null;
  if (!stopLoss && action === "long") stopLoss = Math.round((currentPrice - atr * 1.5) * 100) / 100;
  if (!stopLoss && action === "short") stopLoss = Math.round((currentPrice + atr * 1.5) * 100) / 100;
  if (!takeProfit && action === "long") takeProfit = Math.round((currentPrice + atr * 3) * 100) / 100;
  if (!takeProfit && action === "short") takeProfit = Math.round((currentPrice - atr * 3) * 100) / 100;

  return {
    action, signal: Math.max(-1, Math.min(1, finalSignal)), confidence: adjustedConfidence,
    entryPrice: currentPrice,
    stopLoss: stopLoss ? Math.round(stopLoss * 100) / 100 : null,
    takeProfit: takeProfit ? Math.round(takeProfit * 100) / 100 : null,
    leverage: maxLeverage,
    details, longVotes: longCount, shortVotes: shortCount, hasConsensus, holdReason, vibeScore,
  };
}

// ─── Multi-Timeframe Synthesis ─────────────────────────────
// Runs strategies on 4 timeframes and weights higher TFs more heavily.
// 15m: 1x | 1h: 2x | 4h: 3x | 1d: 4x
// TF consensus bonus: +0.10 when 3+ TFs agree on direction

const TF_INTERVALS = ["15m", "1h", "4h", "1d"];
const TF_WEIGHTS = { "15m": 1, "1h": 2, "4h": 3, "1d": 4 };

export function synthesizeMultiTF(tfResults, currentPrice, options = {}) {
  // tfResults: { "15m": signalResult, "1h": signalResult, "4h": signalResult, "1d": signalResult }
  const maxLeverage = options.maxLeverage || 1;

  let weightedSignal = 0;
  let totalWeight = 0;
  const tfVotes = [];
  const allDetails = [];
  let bestAction = "hold";
  let bestSignal = 0;

  for (const tf of TF_INTERVALS) {
    const result = tfResults[tf];
    if (!result) continue;

    const w = TF_WEIGHTS[tf] || 1;
    weightedSignal += result.signal * w;
    totalWeight += w;
    tfVotes.push({ tf, signal: result.signal, action: result.action, confidence: result.confidence, weight: w });
    if (result.details) allDetails.push(...result.details.map((d) => ({ ...d, timeframe: tf })));

    if (result.action !== "hold") {
      bestAction = result.action;
      bestSignal = result.signal;
    }
  }

  if (totalWeight === 0) {
    return synthesizeSignals([], currentPrice, options); // fallback to empty
  }

  const finalSignal = weightedSignal / totalWeight;

  // TF consensus bonus
  const tfLongs = tfVotes.filter((v) => v.signal > 0.15).length;
  const tfShorts = tfVotes.filter((v) => v.signal < -0.15).length;
  const tfAgreement = tfLongs >= 3 || tfShorts >= 3;
  const tfBonus = tfAgreement ? 0.10 : 0;

  const avgConfidence = tfVotes.reduce((s, v) => s + v.confidence, 0) / tfVotes.length;
  const adjustedConfidence = Math.min(1, avgConfidence + tfBonus);

  let action = "hold";
  if (finalSignal >= 0.25 && adjustedConfidence >= 0.5) action = "long";
  else if (finalSignal <= -0.25 && adjustedConfidence >= 0.5) action = "short";

  // Aggregate SL/TP from best TF result
  const bestTF = tfVotes.find((v) => v.action !== "hold") || tfVotes[0];
  const bestTfResult = tfResults[bestTF?.tf || "1h"];
  const stopLoss = bestTfResult?.stopLoss || null;
  const takeProfit = bestTfResult?.takeProfit || null;

  // Vibe Score from the most weighted TF (1h as base)
  const baseResult = tfResults["1h"] || tfResults["4h"] || tfResults["1d"] || tfResults["15m"];
  const vibeScore = baseResult?.vibeScore || { vibe: finalSignal, confidence: avgConfidence, fullConsensus: tfAgreement, breakdown: {} };

  return {
    action,
    signal: Math.max(-1, Math.min(1, finalSignal)),
    confidence: adjustedConfidence,
    entryPrice: currentPrice,
    stopLoss,
    takeProfit,
    leverage: maxLeverage,
    details: allDetails.map((d) => ({
      name: d.timeframe ? `${d.name}@${d.timeframe}` : d.name,
      signal: d.signal,
      confidence: d.confidence,
    })),
    longVotes: tfLongs,
    shortVotes: tfShorts,
    hasConsensus: tfAgreement,
    holdReason: action === "hold" ? (Math.abs(finalSignal) < 0.25 ? "weak_signal" : "low_confidence") : "",
    tfs: tfVotes,
    tfAgreement,
    vibeScore,
  };
}
