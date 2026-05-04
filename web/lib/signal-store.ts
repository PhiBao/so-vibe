// Server-side signal store — persists latest signals across requests
// In production this would be Redis; for now module-level memory

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

export function clearSignals() {
  latestSignals = [];
}
