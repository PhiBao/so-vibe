import { getAdapter, initDex } from "@/lib/dex";
import { getWalletTrades, getWalletPosHistory, getWalletFundings } from "@/lib/dex/sodex-adapter";
import type { WalletProfile } from "@/lib/dex/types";

export interface WalletProfileInput {
  address: string;
  label?: string;
}

export async function buildWalletProfile(address: string, label?: string): Promise<WalletProfile & { label?: string; error?: string }> {
  try {
    await initDex();
    const adapter = getAdapter();

    const [traderState, trades, posHistory, fundings] = await Promise.all([
      adapter.getTraderState(address),
      getWalletTrades(address, undefined, 200),
      getWalletPosHistory(address, undefined, 200),
      getWalletFundings(address, undefined, 200),
    ]);

    const positions = traderState.positions;
    const equity = traderState.collateral || 0;

    const pnlByTrade: number[] = [];
    const symbolBuys: Record<string, Array<{ qty: number; notional: number }>> = {};
    const symbolSells: Record<string, Array<{ qty: number; notional: number }>> = {};

    for (const t of trades) {
      const key = t.symbol;
      if (!symbolBuys[key]) symbolBuys[key] = [];
      if (!symbolSells[key]) symbolSells[key] = [];
      if (t.side === "BUY") {
        symbolBuys[key].push({ qty: t.quantity, notional: t.notional });
      } else {
        symbolSells[key].push({ qty: t.quantity, notional: t.notional });
      }
    }

    for (const sym of Object.keys(symbolSells)) {
      const buys = symbolBuys[sym] || [];
      const sells = symbolSells[sym] || [];
      let buyIdx = 0;
      for (const sell of sells) {
        let remainingQty = sell.qty;
        while (remainingQty > 0 && buyIdx < buys.length) {
          const buy = buys[buyIdx];
          const matchedQty = Math.min(remainingQty, buy.qty);
          const buyNotional = buy.notional * (matchedQty / buy.qty);
          const sellNotional = sell.notional * (matchedQty / sell.qty);
          pnlByTrade.push(sellNotional - buyNotional);
          buy.qty -= matchedQty;
          remainingQty -= matchedQty;
          if (buy.qty <= 0) buyIdx++;
        }
      }
    }

    const posPnls = posHistory.map((p: any) => p.realizedPnl || 0).filter((p: number) => p !== 0);
    const allPnls = posPnls.length > 0 ? posPnls : pnlByTrade;

    const wins = allPnls.filter((p) => p > 0);
    const losses = allPnls.filter((p) => p < 0);
    const totalTrades = allPnls.length;
    const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
    const profitFactor = losses.length > 0
      ? wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0))
      : wins.length > 0 ? 999 : 0;
    const bestTrade = allPnls.length > 0 ? Math.max(...allPnls) : 0;
    const worstTrade = allPnls.length > 0 ? Math.min(...allPnls) : 0;
    const totalReturn = allPnls.length > 0 ? allPnls.reduce((a, b) => a + b, 0) : 0;

    const avgPnl = totalTrades > 0 ? allPnls.reduce((a, b) => a + b, 0) / totalTrades : 0;
    const stdPnl = totalTrades > 1
      ? Math.sqrt(allPnls.reduce((s, p) => s + (p - avgPnl) ** 2, 0) / (totalTrades - 1))
      : 0;
    const sharpe = stdPnl > 0 ? (avgPnl / stdPnl) * Math.sqrt(Math.max(1, totalTrades)) : 0;

    let peak = totalReturn > 0 ? totalReturn : 0;
    let maxDrawdown = 0;
    let runningPnl = 0;
    for (const p of allPnls) {
      runningPnl += p;
      peak = Math.max(peak, runningPnl);
      const dd = peak > 0 ? (peak - runningPnl) / peak : 0;
      maxDrawdown = Math.max(maxDrawdown, dd);
    }

    const holdTimes = posHistory
      .map((p: any) => (p.closeTime && p.openTime) ? (p.closeTime - p.openTime) / 60000 : 0)
      .filter((t: number) => t > 0);
    const avgHoldMinutes = holdTimes.length > 0 ? holdTimes.reduce((a: number, b: number) => a + b, 0) / holdTimes.length : 0;

    const totalEarned = fundings.filter((f: any) => f.amount > 0).reduce((s: number, f: any) => s + f.amount, 0);
    const totalPaid = fundings.filter((f: any) => f.amount < 0).reduce((s: number, f: any) => s + Math.abs(f.amount), 0);

    let strategyType = "undefined";
    let strategyConfidence = 0;
    if (totalTrades >= 5) {
      if (avgHoldMinutes < 60 && totalTrades > 50) {
        strategyType = "scalper";
        strategyConfidence = Math.min(0.9, totalTrades / 100);
      } else if (avgHoldMinutes < 480 && winRate > 0.5) {
        strategyType = "day_trader";
        strategyConfidence = Math.min(0.85, winRate * 1.2);
      } else if (avgHoldMinutes >= 480 && profitFactor > 1.5) {
        strategyType = "swing_trader";
        strategyConfidence = Math.min(0.85, profitFactor / 3);
      } else if (winRate > 0.6 && profitFactor > 2) {
        strategyType = "momentum";
        strategyConfidence = Math.min(0.9, profitFactor / 4);
      } else if (totalEarned > totalPaid * 2) {
        strategyType = "carry_trader";
        strategyConfidence = 0.7;
      } else {
        strategyType = "mixed";
        strategyConfidence = 0.4;
      }
    }

    const lastActive = trades.length > 0 ? Math.max(...trades.map((t: any) => t.time)) : null;

    const recentTrades = allPnls.slice(-10).map((pnl: number, i: number) => ({
      time: posHistory[allPnls.length - 10 + i]?.closeTime || Date.now(),
      symbol: posHistory[allPnls.length - 10 + i]?.symbol || "-",
      side: pnl > 0 ? "win" : "loss",
      pnl,
    }));

    return {
      address,
      label,
      accountID: 0,
      equity,
      totalTrades,
      winRate: Math.round(winRate * 1000) / 10,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      bestTrade: Math.round(bestTrade * 100) / 100,
      worstTrade: Math.round(worstTrade * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 1000) / 10,
      sharpe: Math.round(sharpe * 100) / 100,
      avgHoldMinutes: Math.round(avgHoldMinutes),
      lastActive,
      currentPositions: positions.map((p) => ({
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        entryPrice: p.entryPrice || 0,
      })),
      strategyType,
      strategyConfidence: Math.round(strategyConfidence * 100) / 100,
      fundings: { totalEarned: Math.round(totalEarned * 100) / 100, totalPaid: Math.round(totalPaid * 100) / 100 },
      recentTrades,
    };
  } catch (err: unknown) {
    return {
      address,
      label,
      accountID: 0,
      equity: 0,
      totalTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      totalReturn: 0,
      bestTrade: 0,
      worstTrade: 0,
      maxDrawdown: 0,
      sharpe: 0,
      avgHoldMinutes: 0,
      lastActive: null,
      currentPositions: [],
      strategyType: "undefined",
      strategyConfidence: 0,
      fundings: { totalEarned: 0, totalPaid: 0 },
      recentTrades: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
