// Risk Management Module — position sizing, drawdown protection, exposure limits

import { readRiskState, writeRiskState } from "@/lib/data-store";

export class RiskManager {
  constructor(config = {}) {
    this.maxPositionPct = config.maxPositionPct || 20;       // % of portfolio per position
    this.maxDailyLossPct = config.maxDailyLossPct || 10;    // max daily loss %
    this.maxLeverage = config.maxLeverage || 20;
    this.maxOpenPositions = config.maxOpenPositions || 3;
    this.maxDrawdownPct = config.maxDrawdownPct || 20;      // max total drawdown %
    this.cooldownMinutes = config.cooldownMinutes || 30;    // cooldown after loss

    // State
    this.portfolioValue = config.portfolioValue || 1000;
    this.peakValue = this.portfolioValue;
    this.dailyPnl = 0;
    this.dailyResetDate = new Date().toDateString();
    this.openPositions = [];
    this.lastLossTime = null;
    this.tradeHistory = [];

    this.loadState();
  }

  // ─── Position Sizing ─────────────────────────────────────
  // margin = portfolio × maxPositionPct%
  // notional = margin × leverage
  // units = notional / entryPrice
  calculatePositionSize(entryPrice, leverage = 1) {
    const margin = this.portfolioValue * (this.maxPositionPct / 100);
    const notional = margin * leverage;
    return notional / entryPrice;
  }

  // ─── Trade Validation ────────────────────────────────────

  canTrade(signal) {
    const reasons = [];

    // Daily loss check
    this.checkDailyReset();
    if (Math.abs(this.dailyPnl) >= this.portfolioValue * (this.maxDailyLossPct / 100)) {
      reasons.push(`Daily loss limit reached ($${this.dailyPnl.toFixed(2)})`);
    }

    // Drawdown check
    const drawdown = ((this.peakValue - this.portfolioValue) / this.peakValue) * 100;
    if (drawdown >= this.maxDrawdownPct) {
      reasons.push(`Max drawdown reached (${drawdown.toFixed(1)}%)`);
    }

    // Max positions check
    if (this.openPositions.length >= this.maxOpenPositions) {
      reasons.push(`Max open positions (${this.maxOpenPositions})`);
    }

    // Same direction check — don't double up
    const sameDir = this.openPositions.find(p =>
      (p.side === "long" && signal.action === "long") ||
      (p.side === "short" && signal.action === "short")
    );
    if (sameDir) {
      reasons.push(`Already have ${signal.action} position on ${sameDir.symbol}`);
    }

    // Cooldown after loss
    if (this.lastLossTime) {
      const elapsed = (Date.now() - this.lastLossTime) / 60000;
      if (elapsed < this.cooldownMinutes) {
        reasons.push(`Cooldown: ${Math.ceil(this.cooldownMinutes - elapsed)}min remaining`);
      }
    }

    // Leverage cap
    const leverage = Math.min(signal.leverage || 1, this.maxLeverage);

    return {
      allowed: reasons.length === 0,
      reasons,
      leverage,
      positionSize: reasons.length === 0 ? this.calculatePositionSize(
        signal.entryPrice, leverage
      ) : 0,
    };
  }

  // ─── Position Management ─────────────────────────────────

  openPosition(trade) {
    const pos = {
      id: `pos_${Date.now()}`,
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.entryPrice,
      size: trade.size,
      leverage: trade.leverage,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      openedAt: Date.now(),
      source: trade.source,
    };
    this.openPositions.push(pos);
    this.saveState();
    return pos;
  }

  closePosition(positionId, exitPrice, reason = "manual") {
    const idx = this.openPositions.findIndex(p => p.id === positionId);
    if (idx === -1) return null;

    const pos = this.openPositions[idx];
    const direction = pos.side === "long" ? 1 : -1;
    const pnl = (exitPrice - pos.entryPrice) * direction * pos.size;
    const pnlPct = ((exitPrice - pos.entryPrice) * direction / pos.entryPrice) * 100 * pos.leverage;

    this.openPositions.splice(idx, 1);
    this.dailyPnl += pnl;
    this.portfolioValue += pnl;
    this.peakValue = Math.max(this.peakValue, this.portfolioValue);

    if (pnl < 0) this.lastLossTime = Date.now();

    const record = {
      ...pos,
      exitPrice,
      pnl,
      pnlPct,
      reason,
      closedAt: Date.now(),
      duration: Date.now() - pos.openedAt,
    };
    this.tradeHistory.push(record);
    this.saveState();

    return record;
  }

  // ─── Check Stop Loss / Take Profit ───────────────────────

  checkExits(currentPrices) {
    const exits = [];
    for (const pos of this.openPositions) {
      const price = currentPrices[pos.symbol];
      if (!price) continue;

      if (pos.side === "long") {
        if (price <= pos.stopLoss) exits.push({ position: pos, reason: "stop_loss", price });
        if (price >= pos.takeProfit) exits.push({ position: pos, reason: "take_profit", price });
      } else {
        if (price >= pos.stopLoss) exits.push({ position: pos, reason: "stop_loss", price });
        if (price <= pos.takeProfit) exits.push({ position: pos, reason: "take_profit", price });
      }
    }
    return exits;
  }

  // ─── Daily Reset ─────────────────────────────────────────

  checkDailyReset() {
    const today = new Date().toDateString();
    if (today !== this.dailyResetDate) {
      this.dailyPnl = 0;
      this.dailyResetDate = today;
      this.saveState();
    }
  }

  // ─── Stats ───────────────────────────────────────────────

  getStats() {
    const wins = this.tradeHistory.filter(t => t.pnl > 0);
    const losses = this.tradeHistory.filter(t => t.pnl <= 0);
    const totalPnl = this.tradeHistory.reduce((s, t) => s + t.pnl, 0);
    const winRate = this.tradeHistory.length > 0 ? wins.length / this.tradeHistory.length : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;
    const drawdown = ((this.peakValue - this.portfolioValue) / this.peakValue) * 100;

    return {
      portfolioValue: this.portfolioValue,
      peakValue: this.peakValue,
      totalPnl,
      totalTrades: this.tradeHistory.length,
      wins: wins.length,
      losses: losses.length,
      winRate: (winRate * 100).toFixed(1) + "%",
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      profitFactor: profitFactor.toFixed(2),
      currentDrawdown: drawdown.toFixed(1) + "%",
      openPositions: this.openPositions.length,
      dailyPnl: this.dailyPnl.toFixed(2),
    };
  }

  // ─── Persistence ─────────────────────────────────────────

  saveState() {
    writeRiskState({
      portfolioValue: this.portfolioValue,
      peakValue: this.peakValue,
      dailyPnl: this.dailyPnl,
      dailyResetDate: this.dailyResetDate,
      openPositions: this.openPositions,
      lastLossTime: this.lastLossTime,
      tradeHistory: this.tradeHistory.slice(-100),
    });
  }

  loadState() {
    try {
      const data = readRiskState();
      if (data) Object.assign(this, data);
    } catch {
      // Risk state load failed — use defaults
    }
  }
}
