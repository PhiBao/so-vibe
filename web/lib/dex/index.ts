/**
 * DEX Factory — SoDEX Native
 */

import type { DexAdapter, DexConfig } from "./types";
import { sodexAdapter } from "./sodex-adapter";

const registry: Record<string, DexAdapter> = {
  sodex: sodexAdapter,
};

let activeAdapter: DexAdapter | null = null;

export function getDexConfig(): DexConfig {
  return {
    provider: process.env.DEX_PROVIDER || "sodex",
    apiUrl: process.env.SODEX_API_URL || "https://testnet-gw.sodex.dev/api/v1/perps",
    testnet: true,
    chainId: 138565,
  };
}

export function getAdapter(): DexAdapter {
  if (activeAdapter) return activeAdapter;
  activeAdapter = sodexAdapter;
  return activeAdapter;
}

export function resetAdapter() {
  activeAdapter = null;
}

export async function initDex() {
  const adapter = getAdapter();
  await adapter.init();
  return adapter;
}
