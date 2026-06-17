import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getWalletPosHistory } from "@/lib/dex/sodex-adapter";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const positions = await getWalletPosHistory(address, undefined, 200);
    return NextResponse.json({
      address,
      count: positions.length,
      positions: positions.filter((p) => p.closeTime && p.closeTime > 0),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
