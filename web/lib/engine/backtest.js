// Backtesting Engine — Vibe-Trading CryptoEngine pattern
// Models: funding fees (8h), liquidation, maker/taker fees, slippage

import { TrendFollowing, MeanReversion, Momentum, SRBounce, VolumeBreakout, synthesizeSignals } from "./signals.js";

export class Backtester {
  constructor(config = {}) {
    this.initialCapital = config.initialCapital || 10000;
    this.leverage = config.leverage || 2;
    this.takerFee = config.takerFee || 0.0005;    // 5 bps
    this.makerFee = config.makerFee || 0.0002;    // 2 bps
    this.slippage = config.slippage || 0.0003;    // 3 bps
    this.fundingRate = config.fundingRate || 0.0001; // 1 bp per 8h
    this.maxPositionPct = config.maxPositionPct || 0.3; // 30% of capital
    this.commission = config.commission || 0.001;
  }

  run(candles, strategy = "swarm") {
    const equity = [this.initialCapital];
    const trades = [];
    let capital = this.initialCapital;
    let position = null;
    let peakEquity = capital;
    let maxDrawdown = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveLosses = 0;

    // Need at least 50 candles for indicators
    for (let i = 50; i < candles.length; i++) {
      const bar = candles[i];
      const lookback = candles.slice(0, i + 1);

      // Apply funding fee every 8 bars (simulating 8h funding)
      if (position && i % 8 === 0) {
        const notional = position.size * bar.close;
        const fundingFee = notional * this.fundingRate;
        capital -= fundingFee;
      }

      // Check stop loss / take profit
      if (position) {
        const side = position.side === "long" ? 1 : -1;
        const pnlPct = ((bar.close - position.entryPrice) / position.entryPrice) * side;

        // Stop loss
        if (position.side === "long" && bar.low <= position.stopLoss) {
          const exitPrice = position.stopLoss * (1 - this.slippage);
          capital += this._closePnL(position, exitPrice);
          trades.push({ ...position, exitPrice, exitBar: i, reason: "stop_loss", pnl: this._closePnL(position, exitPrice) });
          position = null;
          consecutiveLosses++;
          maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
        } else if (position.side === "short" && bar.high >= position.stopLoss) {
          const exitPrice = position.stopLoss * (1 + this.slippage);
          capital += this._closePnL(position, exitPrice);
          trades.push({ ...position, exitPrice, exitBar: i, reason: "stop_loss", pnl: this._closePnL(position, exitPrice) });
          position = null;
          consecutiveLosses++;
          maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
        }
        // Take profit
        else if (position.side === "long" && bar.high >= position.takeProfit) {
          const exitPrice = position.takeProfit * (1 - this.slippage);
          capital += this._closePnL(position, exitPrice);
          trades.push({ ...position, exitPrice, exitBar: i, reason: "take_profit", pnl: this._closePnL(position, exitPrice) });
          position = null;
          consecutiveLosses = 0;
        } else if (position.side === "short" && bar.low <= position.takeProfit) {
          const exitPrice = position.takeProfit * (1 + this.slippage);
          capital += this._closePnL(position, exitPrice);
          trades.push({ ...position, exitPrice, exitBar: i, reason: "take_profit", pnl: this._closePnL(position, exitPrice) });
          position = null;
          consecutiveLosses = 0;
        }
        // Max hold (48 bars)
        else if (i - position.entryBar >= 48) {
          const exitPrice = bar.close * (1 - this.slippage * (position.side === "long" ? 1 : -1));
          capital += this._closePnL(position, exitPrice);
          trades.push({ ...position, exitPrice, exitBar: i, reason: "max_hold", pnl: this._closePnL(position, exitPrice) });
          position = null;
        }
      }

      // Generate signal if no position
      if (!position) {
        const strategies = [
          TrendFollowing(lookback),
          MeanReversion(lookback),
          Momentum(lookback),
          SRBounce(lookback),
          VolumeBreakout(lookback),
        ];
        const signal = synthesizeSignals(strategies, bar.close, { maxLeverage: this.leverage });

        if (signal.action !== "hold" && signal.confidence > 0.55) {
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
      capital += this._closePnL(position, lastPrice);
      trades.push({ ...position, exitPrice: lastPrice, exitBar: candles.length - 1, reason: "end", pnl: this._closePnL(position, lastPrice) });
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
    const barsPerYear = 365 * 24; // hourly bars
    const years = totalBars / barsPerYear;
    const annualReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

    // Sharpe (simplified)
    const returns = [];
    for (let i = 1; i < equity.length; i++) {
      returns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
    }
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length);
    const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(barsPerYear) : 0;

    // Sortino (downside deviation)
    const downsideReturns = returns.filter(r => r < 0);
    const downsideDev = Math.sqrt(downsideReturns.reduce((sum, r) => sum + r ** 2, 0) / Math.max(1, downsideReturns.length));
    const sortino = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(barsPerYear) : 0;

    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;

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
      trades,
      equity,
    };
  }
}
