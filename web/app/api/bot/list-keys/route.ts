import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getNetworkConfig } from "@/lib/config";
import { applyRequestNetwork } from "@/lib/request-network";
import { sanitizeError } from "@/lib/api-error";

export async function GET(request: Request) {
  applyRequestNetwork(request);
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const { gwBase } = getNetworkConfig();
    const res = await fetch(`${gwBase}/api/v1/perps/accounts/${address}/api-keys`, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    return NextResponse.json({ keys: data?.data || [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
