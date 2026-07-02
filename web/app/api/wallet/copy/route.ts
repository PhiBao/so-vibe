import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { getWalletTrades, getWalletPosHistory } from "@/lib/dex/sodex-adapter";
import { applyRequestNetwork } from "@/lib/request-network";

export async function POST(request: Request) {
  applyRequestNetwork(request);
  const body = await request.json().catch(() => ({}));
  const { targetAddress, wallet, allocation, minTrades = 5 } = body;

  if (!targetAddress || !wallet || !allocation) {
    return NextResponse.json({ error: "Missing targetAddress, wallet, or allocation" }, { status: 400 });
  }

  try {
    await initDex();
    const adapter = getAdapter();

    // Fetch target wallet's current positions
    const targetState = await adapter.getTraderState(targetAddress);
    if (!targetState.positions || targetState.positions.length === 0) {
      return NextResponse.json({ error: "Target wallet has no open positions" }, { status: 400 });
    }

    // Fetch target wallet's trade history to validate it has enough trades
    const targetTrades = await getWalletTrades(targetAddress, undefined, 200);
    if (targetTrades.length < minTrades) {
      return NextResponse.json({
        error: `Target wallet has only ${targetTrades.length} trades (minimum ${minTrades})`,
      }, { status: 400 });
    }

    // Get copier's state for proportional sizing
    const copierState = await adapter.getTraderState(wallet);
    const copierEquity = copierState.collateral || 0;
    if (copierEquity <= 0) {
      return NextResponse.json({ error: "Your wallet has no collateral" }, { status: 400 });
    }

    const targetEquity = targetState.collateral || 1;
    const copyAllocation = Math.min(allocation, copierEquity * 0.9); // max 90% of equity
    const sizeRatio = copyAllocation / targetEquity;

    // Build orders for each target position with proportional sizing
    const orders = [];
    const targetPosInfo: Array<{ symbol: string; side: string; targetSize: number; copySize: number }> = [];

    for (const pos of targetState.positions) {
      const copySize = pos.size * sizeRatio;
      if (copySize <= 0) continue;

      try {
        const order = await adapter.buildMarketOrder(pos.symbol, pos.side, copySize, { wallet });
        orders.push(order);
        targetPosInfo.push({
          symbol: pos.symbol,
          side: pos.side,
          targetSize: pos.size,
          copySize,
        });
      } catch (err: unknown) {
        // Skip this position if order build fails (e.g., market not found)
        console.warn(`[Copy] Failed to build order for ${pos.symbol}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (orders.length === 0) {
      return NextResponse.json({ error: "No valid orders could be built" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      targetAddress,
      targetEquity,
      copierEquity,
      allocation: copyAllocation,
      sizeRatio,
      ordersCount: orders.length,
      actions: orders, // Array of UnsignedAction for client-side signing
      positions: targetPosInfo,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
