/**
 * Centralized network configuration — client-safe.
 *
 * Reads the active network from localStorage (client) or env vars (server).
 * For runtime server-side network switching, the API route sets
 * process.env.DEX_NETWORK; this module reads it on the next server render.
 */

export type NetworkName = "testnet" | "mainnet";

export interface NetworkConfig {
  name: NetworkName;
  chainId: number;
  chainHex: string;
  displayName: string;
  gwBase: string;
  rpcUrl: string;
  explorerUrl: string;
  faucetUrl?: string;
  testnet: boolean;
}

const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    chainId: 138565,
    chainHex: "0x21d45",
    displayName: "SoDEX Testnet",
    gwBase: "https://testnet-gw.sodex.dev",
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-v2.valuechain.xyz/",
    explorerUrl: "https://testnet.sodex.com/",
    faucetUrl: "https://testnet.sodex.com/faucet",
    testnet: true,
  },
  mainnet: {
    name: "mainnet",
    chainId: 286623,
    chainHex: "0x45f9f",
    displayName: "ValueChain",
    gwBase: "https://mainnet-gw.sodex.dev",
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.valuechain.xyz/",
    explorerUrl: "https://main-scan.valuechain.xyz/",
    testnet: false,
  },
};

function isNetworkName(n: string): n is NetworkName {
  return n === "testnet" || n === "mainnet";
}

function envNetwork(): NetworkName {
  const env =
    process.env.DEX_NETWORK ||
    process.env.NEXT_PUBLIC_NETWORK ||
    process.env.DEX_NETWORK ||
    "";
  if (env === "mainnet") return "mainnet";
  if (process.env.DEX_TESTNET === "false") return "mainnet";
  return "testnet";
}

/**
 * Get the currently active network.
 *
 * Client: localStorage -> build-time env -> testnet
 * Server: runtime env (set by /api/config) -> build-time env -> testnet
 */
export function getCurrentNetwork(): NetworkName {
  if (typeof window !== "undefined") {
    try {
      const ls = window.localStorage.getItem("sovibe-network");
      if (ls && isNetworkName(ls)) return ls;
    } catch {}
  }
  return envNetwork();
}

export function getNetworkConfig(network?: NetworkName): NetworkConfig {
  const n = network || getCurrentNetwork();
  return NETWORKS[n];
}

export function getCurrentChainId(): number {
  return getNetworkConfig().chainId;
}

export function getCurrentChainHex(): string {
  return getNetworkConfig().chainHex;
}

export function getCurrentGwBase(): string {
  return getNetworkConfig().gwBase;
}

export function getCurrentRpcUrl(): string {
  return getNetworkConfig().rpcUrl;
}

export function getCurrentExplorerUrl(): string {
  return getNetworkConfig().explorerUrl;
}

export function getCurrentFaucetUrl(): string | undefined {
  return getNetworkConfig().faucetUrl;
}

export function isTestnet(): boolean {
  return getNetworkConfig().testnet;
}

export function isMainnet(): boolean {
  return !isTestnet();
}

/**
 * Set the active network at runtime (client only).
 * Server-side switching is handled by /api/config.
 */
export function setNetwork(network: NetworkName): void {
  if (!isNetworkName(network)) throw new Error(`Invalid network: ${network}`);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem("sovibe-network", network);
    } catch {}
  }
}

/**
 * Build an EIP712 domain for the current network.
 */
export function getEip712Domain(name: "futures" | "spot") {
  return {
    name,
    version: "1",
    chainId: getCurrentChainId(),
    verifyingContract: "0x0000000000000000000000000000000000000000" as const,
  };
}

export const SODEX_NETWORKS = NETWORKS;
