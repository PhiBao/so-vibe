/**
 * Leaderboard cache — auto-discovers wallets as users analyze them.
 *
 * When a wallet is profiled via /api/wallet/profile, its metrics are cached in memory.
 * File persistence is best-effort (local dev only); on Vercel serverless, wallets are
 * rediscovered as users analyze them after each cold start.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface CachedProfile {
  address: string;
  equity: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalReturn: number;
  sharpe: number;
  maxDrawdown: number;
  avgHoldMinutes: number;
  lastActive: number | null;
  strategyType: string;
  strategyConfidence: number;
  currentPositions: number;
  firstSeen: number;
  lastSeen: number;
}

const CACHE_FILE = join(process.cwd(), ".leaderboard-cache.json");
const MAX_CACHED = 200;

let cache: CachedProfile[] = [];
let initialized = false;

function ensureInit() {
  if (initialized) return;
  try {
    if (existsSync(CACHE_FILE)) {
      cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    }
  } catch {}
  initialized = true;
}

function persist() {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(cache.slice(-MAX_CACHED), null, 2));
  } catch {}
}

export function addDiscoveredProfile(profile: {
  address: string;
  equity: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalReturn: number;
  sharpe: number;
  maxDrawdown: number;
  avgHoldMinutes: number;
  lastActive: number | null;
  strategyType: string;
  strategyConfidence: number;
  currentPositions: { length: number };
}) {
  ensureInit();

  const now = Date.now();
  const existing = cache.find((c) => c.address.toLowerCase() === profile.address.toLowerCase());

  if (existing) {
    existing.equity = profile.equity;
    existing.totalTrades = profile.totalTrades;
    existing.winRate = profile.winRate;
    existing.profitFactor = profile.profitFactor;
    existing.totalReturn = profile.totalReturn;
    existing.sharpe = profile.sharpe;
    existing.maxDrawdown = profile.maxDrawdown;
    existing.avgHoldMinutes = profile.avgHoldMinutes;
    existing.lastActive = profile.lastActive;
    existing.strategyType = profile.strategyType;
    existing.strategyConfidence = profile.strategyConfidence;
    existing.currentPositions = profile.currentPositions.length;
    existing.lastSeen = now;
  } else {
    cache.push({
      address: profile.address,
      equity: profile.equity,
      totalTrades: profile.totalTrades,
      winRate: profile.winRate,
      profitFactor: profile.profitFactor,
      totalReturn: profile.totalReturn,
      sharpe: profile.sharpe,
      maxDrawdown: profile.maxDrawdown,
      avgHoldMinutes: profile.avgHoldMinutes,
      lastActive: profile.lastActive,
      strategyType: profile.strategyType,
      strategyConfidence: profile.strategyConfidence,
      currentPositions: profile.currentPositions.length,
      firstSeen: now,
      lastSeen: now,
    });
  }

  if (cache.length > MAX_CACHED) {
    cache = cache.slice(-MAX_CACHED);
  }

  persist();
}

export function getDiscoveredWallets( minTrades = 5): CachedProfile[] {
  ensureInit();
  return cache
    .filter((c) => c.totalTrades >= minTrades)
    .sort((a, b) => b.sharpe - a.sharpe);
}
