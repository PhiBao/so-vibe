import { NextResponse } from "next/server";
import { buildAddAPIKey } from "@/lib/dex/sodex-adapter";
import { defaultAuditor } from "@/lib/security";

export async function POST(request: Request) {
  const body = await request.json();
  const { wallet } = body;

  if (!wallet) {
    return NextResponse.json({ error: "Missing wallet address" }, { status: 400 });
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
    const action = await buildAddAPIKey(wallet);

    return NextResponse.json({
      success: true,
      action,
      message: "Sign transaction to enable trading on SoDEX",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Enable trading failed: ${message}` }, { status: 500 });
  }
}
