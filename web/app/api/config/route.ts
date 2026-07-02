import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getNetworkConfig, getCurrentNetwork, type NetworkName } from "@/lib/config";
import { setRuntimeNetwork } from "@/lib/config-server";
import { buildNetworkCookie } from "@/lib/request-network";

export async function GET() {
  const cfg = getNetworkConfig();

  return NextResponse.json({
    name: getCurrentNetwork(),
    network: getCurrentNetwork(),
    chainId: cfg.chainId,
    chainHex: cfg.chainHex,
    displayName: cfg.displayName,
    gwBase: cfg.gwBase,
    rpcUrl: cfg.rpcUrl,
    explorerUrl: cfg.explorerUrl,
    faucetUrl: cfg.faucetUrl,
  });
}

export async function POST(request: Request) {
  try {
    const { network } = await request.json();
    if (network === "testnet" || network === "mainnet") {
      const net = network as NetworkName;

      // Set env var immediately so this request uses the correct network
      process.env.DEX_NETWORK = net;

      // Persist to file (best-effort — fails silently on Vercel)
      try { setRuntimeNetwork(net); } catch {}

      // Always set cookie — this is the primary persistence on serverless
      const res = NextResponse.json({ success: true, network: net });
      res.headers.set("Set-Cookie", buildNetworkCookie(net));
      return res;
    }
    return NextResponse.json({ error: "Invalid network" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
