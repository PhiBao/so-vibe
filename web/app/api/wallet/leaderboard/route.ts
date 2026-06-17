import "@/lib/config-server";
import { NextResponse } from "next/server";
import { buildWalletProfile } from "@/lib/wallet-profile";
import { getLeaderboardWallets } from "@/lib/leaderboard-wallets";
import { sanitizeError } from "@/lib/api-error";

export type LeaderboardSort = "sharpe" | "totalReturn" | "winRate" | "profitFactor" | "totalTrades";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sort = (searchParams.get("sort") as LeaderboardSort) || "sharpe";
  const minTrades = parseInt(searchParams.get("minTrades") || "5", 10);

  try {
    const wallets = getLeaderboardWallets();
    const profiles = await Promise.all(
      wallets.map((w) => buildWalletProfile(w.address, w.label))
    );

    const ranked = profiles
      .filter((p) => !p.error && p.totalTrades >= minTrades)
      .sort((a, b) => {
        const aVal = (a as any)[sort] ?? 0;
        const bVal = (b as any)[sort] ?? 0;
        return bVal - aVal;
      });

    return NextResponse.json({
      sort,
      minTrades,
      count: ranked.length,
      wallets: ranked.map((p) => ({
        address: p.address,
        label: p.label,
        equity: p.equity,
        totalTrades: p.totalTrades,
        winRate: p.winRate,
        profitFactor: p.profitFactor,
        totalReturn: p.totalReturn,
        sharpe: p.sharpe,
        maxDrawdown: p.maxDrawdown,
        avgHoldMinutes: p.avgHoldMinutes,
        lastActive: p.lastActive,
        strategyType: p.strategyType,
        strategyConfidence: p.strategyConfidence,
        currentPositions: p.currentPositions,
      })),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
