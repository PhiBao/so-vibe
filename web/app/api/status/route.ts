import { NextResponse } from "next/server";
import { readRiskState } from "@/lib/data-store";

export async function GET() {
  const state = readRiskState() || {};

  const history = state.tradeHistory || [];
  const wins = history.filter((t: { pnl: number }) => t.pnl > 0);
  const losses = history.filter((t: { pnl: number }) => t.pnl <= 0);
  const totalPnl = history.reduce((s: number, t: { pnl: number }) => s + t.pnl, 0);
  const winRate = history.length > 0 ? wins.length / history.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s: number, t: { pnl: number }) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s: number, t: { pnl: number }) => s + Math.abs(t.pnl), 0) / losses.length : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;
  const drawdown = state.peakValue ? ((state.peakValue - (state.portfolioValue || 0)) / state.peakValue) * 100 : 0;

  return NextResponse.json({
    portfolio: {
      value: state.portfolioValue || 1000,
      peak: state.peakValue || 1000,
      totalPnl,
      drawdown: drawdown.toFixed(1),
      dailyPnl: state.dailyPnl || 0,
    },
    stats: {
      totalTrades: history.length,
      wins: wins.length,
      losses: losses.length,
      winRate: (winRate * 100).toFixed(1),
      profitFactor: profitFactor.toFixed(2),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
    },
    positions: state.openPositions || [],
    recentTrades: history.slice(-20).reverse(),
  });
}
