import "@/lib/config-server";
import { NextResponse } from "next/server";
import { initDex, getAdapter } from "@/lib/dex";
import { getAccountID } from "@/lib/dex/sodex-adapter";
import { getNetworkConfig } from "@/lib/config";
import { sanitizeError } from "@/lib/api-error";
import { applyRequestNetwork } from "@/lib/request-network";

export async function POST(request: Request) {
  applyRequestNetwork(request);
  const body = await request.json().catch(() => ({}));
  const { address, symbol, side, size, price, leverage, stopLoss, takeProfit } = body;

  if (!address || !symbol || !side || !size) {
    return NextResponse.json({ error: "Missing required fields: address, symbol, side, size" }, { status: 400 });
  }

  try {
    await initDex();
    const adapter = getAdapter();
    const accountID = await getAccountID(address);
    if (!accountID) {
      return NextResponse.json({ error: "Could not resolve account ID. Fund your wallet first." }, { status: 400 });
    }

    // Build market order (unsigned)
    const action = await adapter.buildMarketOrder(symbol, side, size, {
      accountID,
      price,
      wallet: address,
    });

    // Build SL/TP brackets (unsigned)
    const brackets: any[] = [];
    const closeSide = side === "long" || side === "buy" ? "short" : "long";
    if (stopLoss) {
      brackets.push(await adapter.buildStopLoss(symbol, closeSide as any, stopLoss, { wallet: address, size }));
    }
    if (takeProfit) {
      brackets.push(await adapter.buildTakeProfit(symbol, closeSide as any, takeProfit, { wallet: address, size }));
    }

    return NextResponse.json({
      success: true,
      actions: [action, ...brackets],
      mode: "auto",
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}

export async function GET() {
  const cfg = getNetworkConfig();
  return NextResponse.json({
    network: cfg.name,
    chainId: cfg.chainId,
    available: true,
  });
}
