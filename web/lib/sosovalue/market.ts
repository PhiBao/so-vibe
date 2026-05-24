/**
 * SoSoValue Market Snapshot Client
 * Endpoints: /currencies/{id}/market-snapshot, /currencies/{id}/token-economics
 *
 * Provides ATH distance, cycle position, FDV, supply data for regime detection.
 */

const SOSO_BASE = "https://openapi.sosovalue.com/openapi/v1";
const API_KEY = process.env.SOSO_API_KEY || "";

async function sosoGet(path: string) {
  const res = await fetch(`${SOSO_BASE}${path}`, {
    headers: { "Content-Type": "application/json", "x-soso-api-key": API_KEY },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`SoSoValue GET ${path} failed: ${res.status}`);
  return res.json();
}

export interface MarketSnapshot {
  price: number;
  change_pct_24h: number;
  turnover_24h: number;
  high_24h: number;
  low_24h: number;
  marketcap: number;
  fdv: number;
  max_supply: string;
  total_supply: string;
  circulating_supply: string;
  ath: number;
  ath_date: string;
  down_from_ath: string;
  cycle_low: number;
  cycle_low_date: string;
  up_from_cycle_low: string;
  marketcap_rank: number;
}

export interface CyclePosition {
  symbol: string;
  price: number;
  marketcapRank: number;
  athDistancePct: number;     // % below ATH (negative = below)
  cyclePositionPct: number;   // % above cycle low
  marketcap: number;
  fdv: number;
}

// Symbol → SoSoValue currency_id mapping
const CURRENCY_ID_MAP: Record<string, string> = {
  "SOL": "1673723677362319871",  // Solana
  "ETH": "1673723677362319870",  // Ethereum
  "BTC": "1673723677362319867",  // Bitcoin
};

// ─── Fetch Market Snapshot ──────────────────────────────────

export async function getMarketSnapshot(symbol: string): Promise<MarketSnapshot | null> {
  const currencyId = CURRENCY_ID_MAP[symbol.toUpperCase()];
  if (!currencyId) {
    console.warn(`[SoSoValue Market] No currency_id for ${symbol}`);
    return null;
  }

  try {
    const data = await sosoGet(`/currencies/${currencyId}/market-snapshot`);
    return (data?.data || data) as MarketSnapshot;
  } catch (err) {
    console.error(`[SoSoValue Market] Snapshot failed for ${symbol}:`, err);
    return null;
  }
}

// ─── Compute Cycle Position ─────────────────────────────────

export function computeCyclePosition(snapshot: MarketSnapshot | null, symbol: string): CyclePosition {
  if (!snapshot) {
    return {
      symbol,
      price: 0,
      marketcapRank: 999,
      athDistancePct: 0,
      cyclePositionPct: 50,
      marketcap: 0,
      fdv: 0,
    };
  }

  const athDist = snapshot.ath > 0 ? ((snapshot.price - snapshot.ath) / snapshot.ath) * 100 : 0;
  const cyclePos = snapshot.cycle_low > 0 ? ((snapshot.price - snapshot.cycle_low) / snapshot.cycle_low) * 100 : 0;

  return {
    symbol,
    price: snapshot.price,
    marketcapRank: snapshot.marketcap_rank,
    athDistancePct: Math.round(athDist * 100) / 100,
    cyclePositionPct: Math.round(cyclePos * 100) / 100,
    marketcap: snapshot.marketcap,
    fdv: snapshot.fdv,
  };
}

// ─── Get cycle position for a symbol ────────────────────────

export async function getCyclePosition(symbol: string): Promise<CyclePosition> {
  try {
    const snapshot = await getMarketSnapshot(symbol);
    return computeCyclePosition(snapshot, symbol);
  } catch (err) {
    console.error(`[SoSoValue Market] Cycle position failed for ${symbol}:`, err);
    return {
      symbol,
      price: 0,
      marketcapRank: 999,
      athDistancePct: 0,
      cyclePositionPct: 50,
      marketcap: 0,
      fdv: 0,
    };
  }
}
