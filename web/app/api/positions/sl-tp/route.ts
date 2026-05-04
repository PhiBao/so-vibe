import { NextResponse } from "next/server";
import { defaultAuditor } from "@/lib/security";
import { getAdapter, initDex } from "@/lib/dex";

export async function POST(request: Request) {
  const body = await request.json();
  const { symbol, side, stopLoss, takeProfit, wallet, size } = body;

  if (!symbol || !side || !wallet) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!stopLoss && !takeProfit) {
    return NextResponse.json({ error: "Must provide stopLoss or takeProfit" }, { status: 400 });
  }

  const clientIp = request.headers.get("x-forwarded-for") || "unknown";
  const rateCheck = defaultAuditor.checkRateLimit(clientIp);
  if (!rateCheck.passed) {
    return NextResponse.json({ error: rateCheck.message }, { status: 429 });
  }

  try {
    await initDex();
    const adapter = getAdapter();
    const actions = [];
    let slBuilt = false;
    let tpBuilt = false;

    if (stopLoss) {
      const slAction = await adapter.buildStopLoss(symbol, side, parseFloat(stopLoss), { wallet, size: size ? parseFloat(size) : undefined });
      actions.push(slAction);
      slBuilt = true;
    }

    if (takeProfit) {
      const tpAction = await adapter.buildTakeProfit(symbol, side, parseFloat(takeProfit), { wallet, size: size ? parseFloat(size) : undefined });
      actions.push(tpAction);
      tpBuilt = true;
    }

    if (actions.length === 0) {
      return NextResponse.json(
        { success: false, error: "No SL/TP actions could be built", slBuilt, tpBuilt },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      actions,
      symbol,
      side,
      stopLoss,
      takeProfit,
      slBuilt,
      tpBuilt,
      message: `Sign transaction to set ${slBuilt && tpBuilt ? "SL/TP" : slBuilt ? "SL" : "TP"} on ${symbol}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `SL/TP build failed: ${message}` }, { status: 500 });
  }
}
