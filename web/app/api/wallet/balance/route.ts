import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { getAccountID } from "@/lib/dex/sodex-adapter";
import { getNetworkConfig } from "@/lib/config";
import { applyRequestNetwork } from "@/lib/request-network";

export async function GET(request: Request) {
  applyRequestNetwork(request);
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    await initDex();
    const adapter = getAdapter();

    const traderState = await adapter.getTraderState(address);
    const accountID = await getAccountID(address).catch(() => 0);
    const usdc = traderState.collateral || 0;

    const positions = (traderState.positions || []).map((p: any) => ({
      symbol: p.symbol,
      side: p.side,
      size: p.size,
      entryPrice: p.entryPrice || 0,
      unrealizedPnl: p.unrealizedPnl || 0,
      leverage: p.leverage || 1,
    }));

    // Fetch open stop orders separately (don't block the main response)
    let stopsBySymbol: Record<string, { sl?: number; tp?: number }> = {};
    try {
      const { gwBase } = getNetworkConfig();
      const ordersUrl = `${gwBase}/api/v1/perps/accounts/${address}/orders`;
      const ordersRes = await fetch(ordersUrl, { headers: { Accept: "application/json" } });
      const ordersJson = await ordersRes.json();
      const orders = ordersJson?.data?.orders || [];
      for (const o of orders) {
        if (!o.reduceOnly) continue;
        if (!stopsBySymbol[o.symbol]) stopsBySymbol[o.symbol] = {};
        const sp = parseFloat(o.stopPrice || "0") || parseFloat(o.price || "0") || 0;
        if (o.stopType === 1 || o.stopType === "STOP_LOSS") stopsBySymbol[o.symbol].sl = sp;
        if (o.stopType === 2 || o.stopType === "TAKE_PROFIT") stopsBySymbol[o.symbol].tp = sp;
      }
    } catch {
      // Stops fetch is best-effort
    }

    const positionsWithStops = positions.map((p: any) => ({
      ...p,
      stopLoss: stopsBySymbol[p.symbol]?.sl || null,
      takeProfit: stopsBySymbol[p.symbol]?.tp || null,
    }));

    return NextResponse.json({
      address,
      usdc,
      spot: (traderState as any).spot || usdc,
      perp: (traderState as any).perp || usdc,
      positions: positionsWithStops,
      subaccounts: positions.length > 0 ? 1 : 0,
      accountID: accountID || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ address, usdc: 0, positions: [], accountID: null, error: message });
  }
}
