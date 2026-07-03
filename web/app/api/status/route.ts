import { NextResponse } from "next/server";
import { readRiskState } from "@/lib/data-store";
import { getSummary } from "@/lib/engine/pnl-tracker";

export async function GET() {
  const state = readRiskState() || {};
  const pnl = getSummary();

  return NextResponse.json({
    portfolio: {
      value: state.portfolioValue || 1000,
      peak: state.peakValue || 1000,
      drawdown: pnl.totalTrades > 0 ? pnl.maxDrawdown.toFixed(1) : "0",
      dailyPnl: state.dailyPnl || 0,
    },
    stats: {
      totalTrades: pnl.totalTrades,
      wins: pnl.wins,
      losses: pnl.losses,
      winRate: pnl.totalTrades > 0 ? (pnl.winRate * 100).toFixed(1) : "0",
      profitFactor: pnl.profitFactor.toFixed(2),
      avgWin: pnl.avgWin.toFixed(2),
      avgLoss: pnl.avgLoss.toFixed(2),
    },
    positions: state.openPositions || [],
    recentTrades: [],
  });
}
