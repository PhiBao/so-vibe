/**
 * Server-side runtime config loader.
 *
 * Reads/writes a local JSON file for settings that must survive server restarts.
 * This module must never be imported by client components.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { NetworkName } from "./config";

const RUNTIME_CONFIG_PATH = join(process.cwd(), ".runtime-config.json");

export interface RuntimeConfig {
  network?: NetworkName;
  updatedAt?: number;
}

function readConfig(): RuntimeConfig {
  try {
    if (existsSync(RUNTIME_CONFIG_PATH)) {
      return JSON.parse(readFileSync(RUNTIME_CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function writeConfig(config: RuntimeConfig) {
  try {
    writeFileSync(RUNTIME_CONFIG_PATH, JSON.stringify({ ...config, updatedAt: Date.now() }, null, 2));
  } catch {
    // Ignore write errors — Vercel and other serverless platforms have read-only filesystems.
    // Network persistence relies on cookies in those environments.
  }
}

export function getRuntimeNetwork(): NetworkName | null {
  const cfg = readConfig();
  return cfg.network === "mainnet" || cfg.network === "testnet" ? cfg.network : null;
}

export function setRuntimeNetwork(network: NetworkName) {
  const current = readConfig();
  writeConfig({ ...current, network });
  process.env.DEX_NETWORK = network;
}

export function loadRuntimeNetworkIntoEnv() {
  const network = getRuntimeNetwork();
  if (network) {
    process.env.DEX_NETWORK = network;
  }
}

// Load runtime network on first import so API routes start with the saved preference.
loadRuntimeNetworkIntoEnv();
