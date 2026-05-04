import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { getAccountID } from "@/lib/dex/sodex-adapter";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid EVM address format" }, { status: 400 });
  }

  try {
    await initDex();
    const adapter = getAdapter();

    const [traderState, accountID] = await Promise.all([
      adapter.getTraderState(address),
      getAccountID(address),
    ]);

    const usdc = traderState.collateral;
    const positions = traderState.positions.map((p) => ({
      symbol: p.symbol,
      side: p.side,
      size: p.size,
      entryPrice: p.entryPrice,
      unrealizedPnl: p.unrealizedPnl || 0,
      leverage: p.leverage || 1,
    }));

    return NextResponse.json({
      address,
      usdc,
      positions,
      subaccounts: traderState.positions.length > 0 ? 1 : 0,
      accountID: accountID || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ address, usdc: 0, positions: [], accountID: null, error: message });
  }
}
