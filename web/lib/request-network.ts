import type { NetworkName } from "./config";

const COOKIE_NAME = "sovibe-network";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Build a Set-Cookie header value for the network choice.
 */
export function buildNetworkCookie(network: NetworkName): string {
  return `${COOKIE_NAME}=${network}; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}

/**
 * Read the network choice from request cookies.
 * Falls back to server env → testnet.
 */
export function getRequestNetwork(request: Request): NetworkName {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=(testnet|mainnet)`));
  if (match) return match[1] as NetworkName;

  const env = process.env.DEX_NETWORK || process.env.NEXT_PUBLIC_NETWORK || "";
  if (env === "mainnet") return "mainnet";
  if (process.env.DEX_TESTNET === "false") return "mainnet";
  return "testnet";
}

/**
 * Apply the network from the request cookie to process.env.DEX_NETWORK.
 * Call this at the start of every API route that uses SoDEX.
 * Returns the resolved network name.
 */
export function applyRequestNetwork(request: Request): NetworkName {
  const network = getRequestNetwork(request);
  process.env.DEX_NETWORK = network;
  return network;
}
