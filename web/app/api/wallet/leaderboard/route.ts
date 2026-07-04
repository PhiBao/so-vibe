import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getDiscoveredWallets } from "@/lib/leaderboard-cache";
import { sanitizeError } from "@/lib/api-error";
import { applyRequestNetwork } from "@/lib/request-network";

export type LeaderboardSort = "sharpe" | "totalReturn" | "winRate" | "profitFactor" | "totalTrades";

export async function GET(request: Request) {
  applyRequestNetwork(request);
  const { searchParams } = new URL(request.url);
  const sort = (searchParams.get("sort") as LeaderboardSort) || "sharpe";
  const minTrades = parseInt(searchParams.get("minTrades") || "5", 10);

  try {
    const discovered = getDiscoveredWallets(minTrades);

    const ranked = discovered
      .map((c) => ({
        address: c.address,
        source: "discovered" as const,
        equity: c.equity,
        totalTrades: c.totalTrades,
        winRate: c.winRate,
        profitFactor: c.profitFactor,
        totalReturn: c.totalReturn,
        sharpe: c.sharpe,
        maxDrawdown: c.maxDrawdown,
        avgHoldMinutes: c.avgHoldMinutes,
        lastActive: c.lastActive,
        strategyType: c.strategyType,
        strategyConfidence: c.strategyConfidence,
        currentPositions: c.currentPositions,
      }))
      .sort((a, b) => {
        const aVal = (a as any)[sort] ?? 0;
        const bVal = (b as any)[sort] ?? 0;
        return bVal - aVal;
      });

    return NextResponse.json({
      sort,
      minTrades,
      count: ranked.length,
      wallets: ranked,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
