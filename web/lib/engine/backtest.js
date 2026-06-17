// Backtesting Engine — Vibe-Trading CryptoEngine pattern
// Models: funding fees, maker/taker fees, slippage, false-positive analysis, parameter sweep

import { TrendFollowing, MeanReversion, Momentum, SRBounce, VolumeBreakout, synthesizeSignals } from "./signals.js";

export class Backtester {
  constructor(config = {}) {
    this.initialCapital = config.initialCapital || 10000;
    this.leverage = config.leverage || 2;
    this.takerFee = config.takerFee || 0.0005;      // 5 bps
    this.makerFee = config.makerFee || 0.0002;      // 2 bps
    this.slippage = (config.slippageBps ?? 3) / 10000;
    this.fundingRate = config.fundingRate || 0.0001; // 1 bp per 8h
    this.maxPositionPct = config.maxPositionPct || 0.3; // 30% of capital
    this.commission = config.commission ?? 0.001;
    this.confidenceThreshold = config.confidenceThreshold ?? 0.55;
    this.strategyConfig = config.strategyConfig || {};
    this.sentiment = config.sentiment || null;
    this.etfFlow = config.etfFlow || null;
    this.funding = config.funding || null;
    this.macroSignal = config.macroSignal || null;
    this.barIntervalHours = config.barIntervalHours || 1;
    this.maxHoldBars = config.maxHoldBars || 48;
    this.fundingIntervalBars = config.fundingIntervalBars || 8;
  }

  run(candles) {
    const equity = [this.initialCapital];
    const trades = [];
    let capital = this.initialCapital;
    let position = null;
    let peakEquity = capital;
    let maxDrawdown = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveLosses = 0;

    const enabledStrategies = (key) => {
      const cfg = this.strategyConfig[key];
      return !cfg || cfg.enabled !== false;
    };

    // Build normalized strategy weights if provided
    const strategyWeights = {};
    let weightTotal = 0;
    for (const [key, cfg] of Object.entries(this.strategyConfig)) {
      if (cfg && cfg.enabled) {
        strategyWeights[key] = cfg.weight || 0;
        weightTotal += cfg.weight || 0;
      }
    }
    const normalizedWeights = weightTotal > 0 ? {} : null;
    if (normalizedWeights) {
      for (const [key, w] of Object.entries(strategyWeights)) {
        normalizedWeights[key] = w / weightTotal;
      }
    }

    // Need at least 50 candles for indicators
    for (let i = 50; i < candles.length; i++) {
      const bar = candles[i];
      const lookback = candles.slice(0, i + 1);

      // Apply funding fee every N bars
      if (position && i % this.fundingIntervalBars === 0) {
        const notional = position.size * bar.close;
        const fundingFee = notional * this.fundingRate;
        capital -= fundingFee;
      }

      // Check stop loss / take profit / max hold
      if (position) {
        const side = position.side === "long" ? 1 : -1;

        let exitPrice = null;
        let reason = null;

        if (position.side === "long" && bar.low <= position.stopLoss) {
          exitPrice = position.stopLoss * (1 - this.slippage);
          reason = "stop_loss";
        } else if (position.side === "short" && bar.high >= position.stopLoss) {
          exitPrice = position.stopLoss * (1 + this.slippage);
          reason = "stop_loss";
        } else if (position.side === "long" && bar.high >= position.takeProfit) {
          exitPrice = position.takeProfit * (1 - this.slippage);
          reason = "take_profit";
        } else if (position.side === "short" && bar.low <= position.takeProfit) {
          exitPrice = position.takeProfit * (1 + this.slippage);
          reason = "take_profit";
        } else if (i - position.entryBar >= this.maxHoldBars) {
          exitPrice = bar.close * (1 - this.slippage * side);
          reason = "max_hold";
        }

        if (exitPrice !== null) {
          const pnl = this._closePnL(position, exitPrice);
          capital += pnl;
          trades.push({
            ...position,
            exitPrice,
            exitBar: i,
            barsHeld: i - position.entryBar,
            reason,
            pnl,
          });
          position = null;
          if (pnl <= 0) {
            consecutiveLosses++;
            maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
          } else {
            consecutiveLosses = 0;
          }
        }
      }

      // Generate signal if no position
      if (!position) {
        const strategies = [];
        if (enabledStrategies("trend_following")) strategies.push(TrendFollowing(lookback));
        if (enabledStrategies("mean_reversion")) strategies.push(MeanReversion(lookback));
        if (enabledStrategies("momentum")) strategies.push(Momentum(lookback));
        if (enabledStrategies("sr_bounce")) strategies.push(SRBounce(lookback));
        if (enabledStrategies("volume_breakout")) strategies.push(VolumeBreakout(lookback));

        if (strategies.length === 0) continue;

        const signal = synthesizeSignals(strategies, bar.close, {
          maxLeverage: this.leverage,
          sentiment: this.sentiment,
          funding: this.funding,
          etfFlow: this.etfFlow,
          macroSignal: this.macroSignal,
          strategyWeights: normalizedWeights,
        });

        if (signal.action !== "hold" && signal.confidence >= this.confidenceThreshold) {
          const riskAmount = capital * this.maxPositionPct;
          const entryPrice = bar.close * (1 + this.slippage * (signal.action === "long" ? 1 : -1));
          const size = (riskAmount * this.leverage) / entryPrice;
          const commission = size * entryPrice * this.commission;

          position = {
            side: signal.action,
            entryPrice,
            size,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            entryBar: i,
            leverage: this.leverage,
            signalConfidence: signal.confidence,
            vibeScore: signal.vibeScore,
          };
          capital -= commission;
        }
      }

      // Track equity
      let unrealized = 0;
      if (position) {
        const side = position.side === "long" ? 1 : -1;
        unrealized = (bar.close - position.entryPrice) * side * position.size;
      }
      const totalEquity = capital + unrealized;
      equity.push(totalEquity);
      peakEquity = Math.max(peakEquity, totalEquity);
      const dd = (peakEquity - totalEquity) / peakEquity;
      maxDrawdown = Math.max(maxDrawdown, dd);
    }

    // Force close remaining position
    if (position) {
      const lastPrice = candles[candles.length - 1].close;
      const pnl = this._closePnL(position, lastPrice);
      capital += pnl;
      trades.push({
        ...position,
        exitPrice: lastPrice,
        exitBar: candles.length - 1,
        barsHeld: candles.length - 1 - position.entryBar,
        reason: "end",
        pnl,
      });
    }

    return this._calcMetrics(equity, trades, maxDrawdown, maxConsecutiveLosses, candles.length);
  }

  _closePnL(position, exitPrice) {
    const side = position.side === "long" ? 1 : -1;
    const gross = (exitPrice - position.entryPrice) * side * position.size;
    const fee = position.size * exitPrice * this.takerFee;
    return gross - fee;
  }

  _calcMetrics(equity, trades, maxDrawdown, maxConsecutiveLosses, totalBars) {
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalReturn = (equity[equity.length - 1] - this.initialCapital) / this.initialCapital;
    const barsPerYear = 365 * 24 / this.barIntervalHours;
    const years = totalBars / barsPerYear;
    const annualReturn = years > 0 ? Math.pow(Math.max(0, 1 + totalReturn), 1 / years) - 1 : 0;

    const returns = [];
    for (let i = 1; i < equity.length; i++) {
      returns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
    }
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdReturn = returns.length > 0
      ? Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length)
      : 0;
    const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(barsPerYear) : 0;

    const downsideReturns = returns.filter(r => r < 0);
    const downsideDev = downsideReturns.length > 0
      ? Math.sqrt(downsideReturns.reduce((sum, r) => sum + r ** 2, 0) / downsideReturns.length)
      : 0;
    const sortino = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(barsPerYear) : 0;

    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;

    // Exit reason analysis
    const byReason = {};
    for (const t of trades) {
      byReason[t.reason] = (byReason[t.reason] || 0) + 1;
    }
    const slLosses = trades.filter(t => t.reason === "stop_loss" && t.pnl <= 0).length;
    const falsePositiveRate = losses.length > 0 ? slLosses / losses.length : 0;

    const tpWins = trades.filter(t => t.reason === "take_profit" && t.pnl > 0);
    const avgBarsToTP = tpWins.length > 0
      ? tpWins.reduce((s, t) => s + t.barsHeld, 0) / tpWins.length
      : 0;
    const slTrades = trades.filter(t => t.reason === "stop_loss");
    const avgBarsToSL = slTrades.length > 0
      ? slTrades.reduce((s, t) => s + t.barsHeld, 0) / slTrades.length
      : 0;

    const expectancy = trades.length > 0
      ? (wins.length / trades.length) * avgWin - (losses.length / trades.length) * avgLoss
      : 0;

    return {
      totalReturn: (totalReturn * 100).toFixed(2) + "%",
      annualReturn: (annualReturn * 100).toFixed(2) + "%",
      sharpe: sharpe.toFixed(2),
      sortino: sortino.toFixed(2),
      maxDrawdown: (maxDrawdown * 100).toFixed(2) + "%",
      totalTrades: trades.length,
      winRate: trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) + "%" : "0%",
      profitFactor: profitFactor.toFixed(2),
      avgWin: "$" + avgWin.toFixed(2),
      avgLoss: "$" + avgLoss.toFixed(2),
      maxConsecutiveLosses,
      finalCapital: "$" + equity[equity.length - 1].toFixed(2),
      expectancy: "$" + expectancy.toFixed(2),
      falsePositiveRate: (falsePositiveRate * 100).toFixed(1) + "%",
      avgBarsToTP: avgBarsToTP.toFixed(1),
      avgBarsToSL: avgBarsToSL.toFixed(1),
      exitReasons: byReason,
      trades,
      equity,
    };
  }
}

export function runParameterSweep(candles, baseConfig) {
  const leverages = [5, 10, 20];
  const thresholds = [0.50, 0.55, 0.60, 0.65, 0.70];
  const results = [];

  for (const leverage of leverages) {
    for (const confidenceThreshold of thresholds) {
      const bt = new Backtester({ ...baseConfig, leverage, confidenceThreshold });
      const result = bt.run(candles);
      results.push({
        leverage,
        confidenceThreshold,
        totalReturn: result.totalReturn,
        sharpe: result.sharpe,
        maxDrawdown: result.maxDrawdown,
        winRate: result.winRate,
        profitFactor: result.profitFactor,
        totalTrades: result.totalTrades,
        expectancy: result.expectancy,
      });
    }
  }

  return results.sort((a, b) => parseFloat(b.sharpe) - parseFloat(a.sharpe));
}
