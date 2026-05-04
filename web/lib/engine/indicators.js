// Technical Analysis module — computes indicators from candle data
// Uses pure math (no heavy deps) for speed

// ─── Simple Moving Average ─────────────────────────────────
export function SMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

// ─── Exponential Moving Average ────────────────────────────
export function EMA(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

// ─── RSI (Relative Strength Index) ─────────────────────────
export function RSI(closes, period = 14) {
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const result = new Array(period).fill(null);
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs));

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

// ─── MACD ──────────────────────────────────────────────────
export function MACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = EMA(closes, fast);
  const emaSlow = EMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = EMA(macdLine, signal);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macd: macdLine, signal: signalLine, histogram };
}

// ─── Bollinger Bands ───────────────────────────────────────
export function BollingerBands(closes, period = 20, stdDev = 2) {
  const sma = SMA(closes, period);
  const upper = [], lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (sma[i] === null) { upper.push(null); lower.push(null); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper.push(mean + stdDev * std);
    lower.push(mean - stdDev * std);
  }
  return { upper, middle: sma, lower };
}

// ─── ATR (Average True Range) ──────────────────────────────
export function ATR(candles, period = 14) {
  const trueRanges = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return SMA(trueRanges, period);
}

// ─── Volume Profile ────────────────────────────────────────
export function VolumeProfile(candles, bins = 20) {
  const prices = candles.flatMap(c => [c.high, c.low]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const step = (max - min) / bins;
  const profile = Array(bins).fill(0);
  
  for (const c of candles) {
    const bin = Math.min(Math.floor((c.close - min) / step), bins - 1);
    profile[bin] += c.volume;
  }
  
  return profile.map((vol, i) => ({
    priceLevel: min + step * (i + 0.5),
    volume: vol,
  }));
}

// ─── Support & Resistance ──────────────────────────────────
export function SupportResistance(candles, lookback = 50) {
  const recent = candles.slice(-lookback);
  const levels = [];
  
  for (let i = 2; i < recent.length - 2; i++) {
    // Local minima (support)
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
        recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) {
      levels.push({ type: "support", price: recent[i].low, strength: 0 });
    }
    // Local maxima (resistance)
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high &&
        recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
      levels.push({ type: "resistance", price: recent[i].high, strength: 0 });
    }
  }
  
  // Count touches for each level (within 0.5% tolerance)
  for (const level of levels) {
    const tolerance = level.price * 0.005;
    level.strength = recent.filter(c => 
      Math.abs(c.low - level.price) < tolerance || Math.abs(c.high - level.price) < tolerance
    ).length;
  }
  
  return levels.filter(l => l.strength >= 2).sort((a, b) => b.strength - a.strength);
}

// ─── Full Analysis Snapshot ────────────────────────────────
export function analyze(candles) {
  if (candles.length < 50) return null;
  
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const currentPrice = closes[closes.length - 1];
  
  const rsi = RSI(closes);
  const macd = MACD(closes);
  const bb = BollingerBands(closes);
  const atr = ATR(candles);
  const ema9 = EMA(closes, 9);
  const ema21 = EMA(closes, 21);
  const ema50 = EMA(closes, 50);
  const sr = SupportResistance(candles);
  
  const last = closes.length - 1;
  const prev = last - 1;
  
  // Trend determination
  const trendUp = ema9[last] > ema21[last] && ema21[last] > ema50[last];
  const trendDown = ema9[last] < ema21[last] && ema21[last] < ema50[last];
  const trend = trendUp ? "bullish" : trendDown ? "bearish" : "neutral";
  
  // RSI signals
  const rsiValue = rsi[last];
  const rsiSignal = rsiValue < 30 ? "oversold" : rsiValue > 70 ? "overbought" : "neutral";
  
  // MACD signals
  const macdCrossUp = macd.histogram[prev] < 0 && macd.histogram[last] > 0;
  const macdCrossDown = macd.histogram[prev] > 0 && macd.histogram[last] < 0;
  const macdSignal = macdCrossUp ? "bullish_cross" : macdCrossDown ? "bearish_cross" : 
    macd.histogram[last] > 0 ? "bullish" : "bearish";
  
  // Bollinger Band position
  const bbPosition = currentPrice > bb.upper[last] ? "above_upper" :
    currentPrice < bb.lower[last] ? "below_lower" :
    currentPrice > bb.middle[last] ? "upper_half" : "lower_half";
  
  // Volume trend
  const avgVolume = SMA(volumes, 20);
  const volumeRatio = volumes[last] / (avgVolume[last] || 1);
  
  // Nearest S/R levels
  const nearestSupport = sr.filter(l => l.type === "support" && l.price < currentPrice)[0];
  const nearestResistance = sr.filter(l => l.type === "resistance" && l.price > currentPrice)[0];
  
  return {
    price: currentPrice,
    trend,
    rsi: { value: rsiValue, signal: rsiSignal },
    macd: { 
      value: macd.macd[last], 
      signal: macd.signal[last], 
      histogram: macd.histogram[last], 
      cross: macdSignal 
    },
    bollinger: { 
      upper: bb.upper[last], 
      middle: bb.middle[last], 
      lower: bb.lower[last], 
      position: bbPosition 
    },
    ema: { ema9: ema9[last], ema21: ema21[last], ema50: ema50[last] },
    atr: atr[last],
    volume: { current: volumes[last], ratio: volumeRatio },
    support: nearestSupport?.price || null,
    resistance: nearestResistance?.price || null,
    candlesAnalyzed: candles.length,
  };
}
