import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getWalletPosHistory } from "@/lib/dex/sodex-adapter";
import { recordTrade, getRecentTrades } from "@/lib/engine/pnl-tracker";

const TAKER_FEE = 0.0005;

function tradeKey(p: { symbol: string; entryTime: number; exitTime: number }) {
  return `${p.symbol}|${p.entryTime}|${p.exitTime}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { address } = body;

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const positions = await getWalletPosHistory(address, undefined, 200);
    const closed = positions.filter((p) => p.closeTime && p.closeTime > 0);

    const recent = getRecentTrades(1000);
    const seen = new Set(recent.map((t) => tradeKey({ symbol: t.symbol, entryTime: t.entryTime, exitTime: t.exitTime })));

    let recorded = 0;
    for (const p of closed) {
      const key = tradeKey({ symbol: p.symbol, entryTime: p.openTime, exitTime: p.closeTime });
      if (seen.has(key)) continue;

      const notional = p.size * p.entryPrice;
      const fees = notional * TAKER_FEE * 2; // entry + exit estimate

      recordTrade({
        symbol: p.symbol,
        side: p.side,
        strategy: "onchain",
        entryPrice: p.entryPrice,
        exitPrice: p.exitPrice,
        expectedPrice: p.entryPrice,
        size: p.size,
        realizedPnl: p.realizedPnl,
        fees,
        entryTime: p.openTime,
        exitTime: p.closeTime,
      });
      recorded++;
    }

    return NextResponse.json({ success: true, recorded, totalClosed: closed.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
