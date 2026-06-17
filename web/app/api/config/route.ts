import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getNetworkConfig, getCurrentNetwork } from "@/lib/config";
import { setRuntimeNetwork } from "@/lib/config-server";

export async function GET() {
  const cfg = getNetworkConfig();

  return NextResponse.json({
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
      setRuntimeNetwork(network);
    }
    return NextResponse.json({ success: true, network: getCurrentNetwork() });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
