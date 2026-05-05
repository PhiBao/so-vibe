import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { defaultAuditor } from "@/lib/security";

export async function POST(request: Request) {
  const body = await request.json();
  const { wallet, amount } = body;

  if (!wallet || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "Missing wallet or invalid amount" }, { status: 400 });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "Invalid EVM address" }, { status: 400 });
  }

  const clientIp = request.headers.get("x-forwarded-for") || "unknown";
  const rateCheck = defaultAuditor.checkRateLimit(clientIp);
  if (!rateCheck.passed) {
    return NextResponse.json({ error: rateCheck.message }, { status: 429 });
  }

  try {
    await initDex();
    const adapter = getAdapter();
    const action = await adapter.buildTransferToPerps(amount, { wallet });

    return NextResponse.json({
      success: true,
      action,
      message: `Sign transaction to deposit ${amount} USDC from spot to perps`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Deposit failed: ${message}` }, { status: 500 });
  }
}
