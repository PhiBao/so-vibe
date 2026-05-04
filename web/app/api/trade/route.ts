import { NextResponse } from "next/server";
import { defaultAuditor } from "@/lib/security";
import { getAdapter, initDex } from "@/lib/dex";

export async function POST(request: Request) {
  const body = await request.json();
  const { symbol, side, size, price, stopLoss, takeProfit, leverage, wallet } = body;

  if (!symbol || !side || !size || !price) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const clientIp = request.headers.get("x-forwarded-for") || "unknown";
  const rateCheck = defaultAuditor.checkRateLimit(clientIp);
  if (!rateCheck.passed) {
    return NextResponse.json({ error: rateCheck.message }, { status: 429 });
  }

  const orderId = `live_${Date.now()}`;
  const dupCheck = defaultAuditor.checkDuplicate(orderId);
  if (!dupCheck.passed) {
    return NextResponse.json({ error: dupCheck.message }, { status: 409 });
  }

  const auditChecks = defaultAuditor.auditOrder({ symbol, side, size: parseFloat(size), price: parseFloat(price), leverage, wallet });
  const failedChecks = auditChecks.filter((c) => !c.passed);
  if (failedChecks.length > 0) {
    const critical = failedChecks.find((c) => c.severity === "critical");
    return NextResponse.json({ error: critical?.message || failedChecks[0].message, checks: auditChecks }, { status: 400 });
  }

  const cbCheck = defaultAuditor.checkCircuitBreaker(parseFloat(size) * parseFloat(price));
  if (!cbCheck.passed) {
    return NextResponse.json({ error: cbCheck.message }, { status: 503 });
  }

  try {
    const adapter = getAdapter();

    const action = await adapter.buildMarketOrder(symbol, side, parseFloat(size), {
      wallet,
      leverage,
      price: parseFloat(price),
    });

    return NextResponse.json({
      success: true,
      order: {
        id: orderId,
        symbol,
        side,
        size: parseFloat(size),
        price: parseFloat(price),
        leverage: leverage || 1,
        stopLoss,
        takeProfit,
      },
      action,
      message: "Sign transaction in your wallet to submit",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Order build failed: ${message}` }, { status: 500 });
  }
}
