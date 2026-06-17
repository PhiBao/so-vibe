/**
 * Live PnL Tracker — tracks realized and unrealized PnL from executed trades
 *
 * Persists closed trades to a local JSON file so metrics survive server restarts.
 * In production, replace the JSON file with a database.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface ClosedTrade {
  id: string;
  symbol: string;
  side: string;
  strategy: string;
  entryPrice: number;
  exitPrice: number;
  expectedPrice?: number;
  size: number;
  realizedPnl: number;
  fees: number;
  netPnl: number;
  slippageBps?: number;
  entryTime: number;
  exitTime: number;
  holdMinutes: number;
}

interface PnLSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnl: number;
  totalFees: number;
  netPnl: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  profitFactor: number;
  sharpe: number;
  maxDrawdown: number;
  avgHoldMinutes: number;
}

interface StrategyBreakdown {
  [strategy: string]: {
    trades: number;
    wins: number;
    realizedPnl: number;
    winRate: number;
    avgPnl: number;
  };
}

const PNL_FILE = join(process.cwd(), ".pnl-trades.json");
const MAX_TRADES = 2000;

// ─── State ──────────────────────────────────────────────────

let trades: ClosedTrade[] = [];
let equityCurve: number[] = [0];
let peakEquity = 0;
let initialized = false;

function readTrades(): ClosedTrade[] {
  try {
    if (existsSync(PNL_FILE)) {
      const raw = readFileSync(PNL_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {}
  return [];
}

function persistTrades() {
  try {
    writeFileSync(PNL_FILE, JSON.stringify(trades.slice(-MAX_TRADES), null, 2));
  } catch {}
}

function ensureInitialized() {
  if (initialized) return;
  trades = readTrades();
  equityCurve = trades.reduce<number[]>(
    (curve, t) => {
      curve.push((curve[curve.length - 1] || 0) + t.netPnl);
      return curve;
    },
    [0]
  );
  peakEquity = Math.max(...equityCurve, 0);
  initialized = true;
}

// ─── Record a closed trade ─────────────────────────────────

export function recordTrade(trade: Omit<ClosedTrade, "id" | "netPnl" | "holdMinutes">) {
  ensureInitialized();

  const netPnl = trade.realizedPnl - (trade.fees || 0);
  const holdMinutes = trade.exitTime && trade.entryTime
    ? (trade.exitTime - trade.entryTime) / 60000
    : 0;
  const slippageBps = trade.expectedPrice && trade.expectedPrice > 0
    ? Math.round(((trade.entryPrice - trade.expectedPrice) / trade.expectedPrice) * 10000)
    : undefined;

  const closed: ClosedTrade = {
    ...trade,
    id: `pnl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    netPnl,
    holdMinutes,
    slippageBps,
  };

  trades.push(closed);
  equityCurve.push((equityCurve[equityCurve.length - 1] || 0) + netPnl);
  peakEquity = Math.max(peakEquity, equityCurve[equityCurve.length - 1]);

  // Trim in-memory arrays if they grow too large
  if (trades.length > MAX_TRADES) {
    trades = trades.slice(-MAX_TRADES);
    equityCurve = equityCurve.slice(-MAX_TRADES);
  }

  persistTrades();
  return closed;
}

// ─── Compute summary metrics ────────────────────────────────

export function getSummary(): PnLSummary {
  ensureInitialized();

  if (trades.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0, realizedPnl: 0,
      totalFees: 0, netPnl: 0, avgWin: 0, avgLoss: 0, bestTrade: 0,
      worstTrade: 0, profitFactor: 0, sharpe: 0, maxDrawdown: 0, avgHoldMinutes: 0,
    };
  }

  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl <= 0);
  const totalFees = trades.reduce((s, t) => s + (t.fees || 0), 0);
  const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const bestTrade = Math.max(...trades.map(t => t.netPnl));
  const worstTrade = Math.min(...trades.map(t => t.netPnl));
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.netPnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.netPnl, 0) / losses.length) : 0;
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const profitFactor = losses.length > 0
    ? wins.reduce((s, t) => s + t.netPnl, 0) / Math.abs(losses.reduce((s, t) => s + t.netPnl, 0))
    : wins.length > 0 ? 999 : 0;
  const avgHoldMinutes = trades.reduce((s, t) => s + (t.holdMinutes || 0), 0) / trades.length;

  // Sharpe: avg return / std dev * sqrt(n)
  const returns = trades.map(t => t.netPnl);
  const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - avg) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (avg / stdDev) * Math.sqrt(trades.length) : 0;

  // Max drawdown from equity curve
  let peak = 0;
  let maxDD = 0;
  for (const eq of equityCurve) {
    peak = Math.max(peak, eq);
    if (peak > 0) maxDD = Math.max(maxDD, (peak - eq) / peak);
  }

  return {
    totalTrades: trades.length, wins: wins.length, losses: losses.length,
    winRate, realizedPnl: trades.reduce((s, t) => s + t.realizedPnl, 0),
    totalFees, netPnl, avgWin: Math.round(avgWin * 100) / 100, avgLoss: Math.round(avgLoss * 100) / 100,
    bestTrade: Math.round(bestTrade * 100) / 100, worstTrade: Math.round(worstTrade * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100, sharpe: Math.round(sharpe * 100) / 100,
    maxDrawdown: Math.round(maxDD * 1000) / 10, avgHoldMinutes: Math.round(avgHoldMinutes),
  };
}

// ─── Per-strategy breakdown ─────────────────────────────────

export function getStrategyBreakdown(): StrategyBreakdown {
  ensureInitialized();
  const breakdown: StrategyBreakdown = {};

  for (const t of trades) {
    const strat = t.strategy || "swarm";
    if (!breakdown[strat]) breakdown[strat] = { trades: 0, wins: 0, realizedPnl: 0, winRate: 0, avgPnl: 0 };
    breakdown[strat].trades++;
    if (t.netPnl > 0) breakdown[strat].wins++;
    breakdown[strat].realizedPnl += t.netPnl;
  }

  for (const key of Object.keys(breakdown)) {
    const b = breakdown[key];
    b.winRate = b.trades > 0 ? b.wins / b.trades : 0;
    b.avgPnl = b.trades > 0 ? b.realizedPnl / b.trades : 0;
    b.winRate = Math.round(b.winRate * 1000) / 10;
    b.avgPnl = Math.round(b.avgPnl * 100) / 100;
  }

  return breakdown;
}

// ─── Recent trades ──────────────────────────────────────────

export function getRecentTrades(limit = 10): ClosedTrade[] {
  ensureInitialized();
  return trades.slice(-limit).reverse();
}

// ─── Reset ──────────────────────────────────────────────────

export function resetPnL() {
  ensureInitialized();
  trades = [];
  equityCurve = [0];
  peakEquity = 0;
  persistTrades();
}
