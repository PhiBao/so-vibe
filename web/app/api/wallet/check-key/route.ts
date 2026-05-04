import { NextResponse } from "next/server";
import { hasAPIKey } from "@/lib/dex/sodex-adapter";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid EVM address" }, { status: 400 });
  }

  try {
    const hasKey = await hasAPIKey(address);
    return NextResponse.json({ address, hasKey });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ address, hasKey: false, error: message }, { status: 500 });
  }
}
