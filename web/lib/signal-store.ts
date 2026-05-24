// Server-side signal store — persists latest signals across requests

interface Signal {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  size: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  longVotes: number;
  shortVotes: number;
  reasoning?: string | null;
  riskFactors?: string[];
  vibeScore?: {
    vibe: number;
    confidence: number;
    fullConsensus: boolean;
    breakdown: Record<string, { signal: number; confidence: number }>;
  };
  etfFlow?: {
    signal: number;
    trend: string;
    latestInflow: number;
  } | null;
  macroAlert?: string | null;
  details?: Array<Record<string, unknown>>;
  queuedAt: number;
}

let latestSignals: Signal[] = [];
let lastCycleTime = 0;

export function getSignals(): { signals: Signal[]; lastCycleTime: number } {
  return { signals: latestSignals, lastCycleTime };
}

export function setSignals(signals: Signal[]) {
  latestSignals = signals;
  lastCycleTime = Date.now();
}
