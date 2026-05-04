// Trailing Stop & Partial Profit Manager
// Pattern from AutoHedge market_making (inventory management + rebalance thresholds)

export class PositionManager {
  constructor(config = {}) {
    this.trailingStopPct = config.trailingStopPct || 1.5;      // trailing stop distance %
    this.partialProfitPct = config.partialProfitPct || 2.0;    // take partial at X% profit
    this.partialExitRatio = config.partialExitRatio || 0.5;    // exit 50% at partial target
    this.breakEvenTrigger = config.breakEvenTrigger || 1.0;    // move SL to break-even at X% profit
    this.maxHoldBars = config.maxHoldBars || 48;                // max hold time (48 bars = 48h on 1h)
  }

  // ─── Update Position State ─────────────────────────────
  
  updatePosition(position, currentPrice, barIndex) {
    const side = position.side === "long" ? 1 : -1;
    const unrealizedPnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * side * 100;
    const updates = { unrealizedPnlPct };

    // 1. Break-even stop: move SL to entry after X% profit
    if (!position.breakEvenHit && unrealizedPnlPct >= this.breakEvenTrigger) {
      if (position.side === "long") {
        updates.stopLoss = Math.max(position.stopLoss, position.entryPrice * 1.001); // slightly above entry
      } else {
        updates.stopLoss = Math.min(position.stopLoss, position.entryPrice * 0.999);
      }
      updates.breakEvenHit = true;
      updates.reason = "break_even";
    }

    // 2. Trailing stop: tighten SL as price moves in our favor
    if (unrealizedPnlPct > this.breakEvenTrigger) {
      const trailDistance = currentPrice * (this.trailingStopPct / 100);
      if (position.side === "long") {
        const newStop = currentPrice - trailDistance;
        if (newStop > (position.stopLoss || 0)) {
          updates.stopLoss = newStop;
          updates.reason = "trailing_stop";
        }
      } else {
        const newStop = currentPrice + trailDistance;
        if (newStop < (position.stopLoss || Infinity)) {
          updates.stopLoss = newStop;
          updates.reason = "trailing_stop";
        }
      }
    }

    // 3. Partial profit: exit portion at target
    if (!position.partialTaken && unrealizedPnlPct >= this.partialProfitPct) {
      updates.partialExit = true;
      updates.partialExitRatio = this.partialExitRatio;
      updates.partialTaken = true;
      updates.reason = "partial_profit";
    }

    // 4. Max hold time
    const barsHeld = barIndex - (position.openedAtBar || 0);
    if (barsHeld >= this.maxHoldBars) {
      updates.forceClose = true;
      updates.reason = "max_hold_time";
    }

    return updates;
  }

  // ─── Calculate Partial Exit Size ───────────────────────
  
  getPartialExitSize(position) {
    if (!position.partialExit) return 0;
    return position.size * (position.partialExitRatio || this.partialExitRatio);
  }

  // ─── Check All Positions ───────────────────────────────
  
  checkPositions(positions, currentPrices, barIndex) {
    const actions = [];

    for (const pos of positions) {
      const price = currentPrices[pos.symbol];
      if (!price) continue;

      const updates = this.updatePosition(pos, price, barIndex);

      // Stop loss hit
      if (pos.side === "long" && price <= (pos.stopLoss || 0)) {
        actions.push({ type: "close_full", position: pos, reason: "stop_loss", price });
        continue;
      }
      if (pos.side === "short" && price >= (pos.stopLoss || Infinity)) {
        actions.push({ type: "close_full", position: pos, reason: "stop_loss", price });
        continue;
      }

      // Take profit hit
      if (pos.side === "long" && pos.takeProfit && price >= pos.takeProfit) {
        actions.push({ type: "close_full", position: pos, reason: "take_profit", price });
        continue;
      }
      if (pos.side === "short" && pos.takeProfit && price <= pos.takeProfit) {
        actions.push({ type: "close_full", position: pos, reason: "take_profit", price });
        continue;
      }

      // Partial profit
      if (updates.partialExit) {
        const exitSize = pos.size * (updates.partialExitRatio || this.partialExitRatio);
        actions.push({ type: "close_partial", position: pos, reason: "partial_profit", price, exitSize });
      }

      // Force close
      if (updates.forceClose) {
        actions.push({ type: "close_full", position: pos, reason: "max_hold_time", price });
      }

      // Apply updates to position
      Object.assign(pos, updates);
    }

    return actions;
  }
}
