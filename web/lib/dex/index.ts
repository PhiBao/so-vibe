/**
 * DEX Factory — SoDEX Native
 */

import type { DexAdapter, DexConfig } from "./types";
import { sodexAdapter } from "./sodex-adapter";
import { getNetworkConfig, isTestnet } from "@/lib/config";

const registry: Record<string, DexAdapter> = {
  sodex: sodexAdapter,
};

let activeAdapter: DexAdapter | null = null;

export function getDexConfig(): DexConfig {
  const cfg = getNetworkConfig();
  return {
    provider: process.env.DEX_PROVIDER || "sodex",
    apiUrl: `${cfg.gwBase}/api/v1/perps`,
    testnet: cfg.testnet,
    chainId: cfg.chainId,
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
