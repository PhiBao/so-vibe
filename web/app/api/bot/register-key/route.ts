import "@/lib/config-server";
import { NextResponse } from "next/server";
import { initDex, getAdapter } from "@/lib/dex";
import { sanitizeError } from "@/lib/api-error";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { wallet, publicKey, name } = body;

  if (!wallet || !publicKey || !name) {
    return NextResponse.json(
      { error: "Missing required fields: wallet, publicKey, name" },
      { status: 400 }
    );
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  if (!/^0x[a-fA-F0-9]{64}$/i.test(publicKey)) {
    return NextResponse.json(
      { error: "Invalid public key format. Expected 0x + 64 hex chars." },
      { status: 400 }
    );
  }

  try {
    await initDex();
    const adapter = getAdapter();
    const action = await adapter.buildAddAPIKey(publicKey, name, { wallet });
    return NextResponse.json({ success: true, action });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
