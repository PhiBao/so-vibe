import { NextResponse } from "next/server";
import { defaultAuditor } from "@/lib/security";
import { getAdapter, initDex } from "@/lib/dex";

export async function POST(request: Request) {
  const body = await request.json();
  const { symbol, side, size, wallet } = body;

  if (!symbol || !side || !size || !wallet) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const clientIp = request.headers.get("x-forwarded-for") || "unknown";
  const rateCheck = defaultAuditor.checkRateLimit(clientIp);
  if (!rateCheck.passed) {
    return NextResponse.json({ error: rateCheck.message }, { status: 429 });
  }

  try {
    await initDex();
    const adapter = getAdapter();

    const action = await adapter.buildClosePosition(symbol, side, parseFloat(size), {
      wallet,
    });

    return NextResponse.json({
      success: true,
      action,
      message: `Sign transaction to close ${side} ${size} ${symbol}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Close position failed: ${message}` }, { status: 500 });
  }
}
