import { NextResponse } from "next/server";
import { getSummary, getStrategyBreakdown, getRecentTrades, resetPnL } from "@/lib/engine/pnl-tracker";

export async function GET() {
  return NextResponse.json({
    summary: getSummary(),
    strategies: getStrategyBreakdown(),
    recentTrades: getRecentTrades(20),
  });
}

export async function DELETE() {
  resetPnL();
  return NextResponse.json({ success: true });
}
