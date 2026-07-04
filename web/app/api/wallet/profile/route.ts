import "@/lib/config-server";
import { NextResponse } from "next/server";
import { buildWalletProfile } from "@/lib/wallet-profile";
import { sanitizeError } from "@/lib/api-error";
import { applyRequestNetwork } from "@/lib/request-network";
import { addDiscoveredProfile } from "@/lib/leaderboard-cache";

export async function GET(request: Request) {
  applyRequestNetwork(request);
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid EVM address format" }, { status: 400 });
  }

  try {
    const profile = await buildWalletProfile(address);
    if (profile.error) {
      return NextResponse.json({ error: sanitizeError(new Error(profile.error), true) }, { status: 500 });
    }
    // Auto-add to leaderboard discovery cache
    if (!profile.error && profile.totalTrades > 0) {
      try { addDiscoveredProfile(profile as any); } catch {}
    }
    return NextResponse.json(profile);
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
