import "@/lib/config-server";
import { NextResponse } from "next/server";
import { defaultAuditor } from "@/lib/security";
import { getAdapter, initDex } from "@/lib/dex";
import { sanitizeError } from "@/lib/api-error";

export async function POST(request: Request) {
  const body = await request.json();
  const { signalId, symbol, side, size, price, stopLoss, takeProfit, leverage, wallet } = body;

  if (!signalId || !symbol || !side || !size || !price) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const clientIp = request.headers.get("x-forwarded-for") || "unknown";
  const rateCheck = defaultAuditor.checkRateLimit(clientIp);
  if (!rateCheck.passed) {
    return NextResponse.json({ error: rateCheck.message }, { status: 429 });
  }

  const auditChecks = defaultAuditor.auditOrder({
    symbol,
    side,
    size: parseFloat(size),
    price: parseFloat(price),
    leverage,
    wallet,
  });
  const failedChecks = auditChecks.filter((c) => !c.passed);
  if (failedChecks.length > 0) {
    const critical = failedChecks.find((c) => c.severity === "critical");
    return NextResponse.json(
      { error: critical?.message || failedChecks[0].message, checks: auditChecks },
      { status: 400 }
    );
  }

  try {
    const adapter = getAdapter();

    const action = await adapter.buildMarketOrder(symbol, side, parseFloat(size), {
      wallet,
      leverage,
      price: parseFloat(price),
    });

    // Build SL/TP brackets so the client can sign and attach them after the main order.
    const bracketActions: any[] = [];
    const closeSide = side === "long" || side === "buy" ? "short" : "long";
    if (stopLoss) {
      bracketActions.push(
        await adapter.buildStopLoss(symbol, closeSide as any, parseFloat(stopLoss), { wallet, size: parseFloat(size) })
      );
    }
    if (takeProfit) {
      bracketActions.push(
        await adapter.buildTakeProfit(symbol, closeSide as any, parseFloat(takeProfit), { wallet, size: parseFloat(size) })
      );
    }

    return NextResponse.json({
      success: true,
      action,
      bracketActions,
      signalId,
      stopLoss,
      takeProfit,
      message: `Sign transaction to submit market order (${side} ${size} ${symbol})`,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
