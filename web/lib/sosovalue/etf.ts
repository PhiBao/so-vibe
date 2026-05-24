/**
 * SoSoValue ETF Data Client
 * Endpoints: /etfs/summary-history, /etfs, /etfs/{ticker}/market-snapshot, /etfs/{ticker}/history
 *
 * ETF flow data is one of the best institutional sentiment signals:
 * - Net inflow → bullish (institutions buying)
 * - Net outflow → bearish (institutions selling)
 * - Cumulative net inflow trend → long-term conviction
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

export interface ETFFlowDay {
  date: string;
  total_net_inflow: number;
  total_value_traded: number;
  total_net_assets: number;
  cum_net_inflow: number;
}

export interface ETFFlowAnalysis {
  symbol: string;
  signal: number;        // -1 to 1
  confidence: number;    // 0 to 1
  meta: {
    latestInflow: number;
    latestDate: string;
    totalNetAssets: number;
    cumNetInflow: number;
    consecutiveDays: number;
    trend7d: string;     // "inflow" | "outflow" | "mixed"
    avgDailyInflow7d: number;
  };
}

// ─── Fetch ETF Summary History ──────────────────────────────

export async function getETFSummaryHistory(
  symbol: string,
  countryCode: string = "US",
  limit: number = 30
): Promise<ETFFlowDay[]> {
  try {
    const data = await sosoGet(
      `/etfs/summary-history?symbol=${symbol.toUpperCase()}&country_code=${countryCode}&limit=${limit}`
    );
    const list = data?.data?.list || data?.data || data || [];
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error(`[SoSoValue ETF] Failed to fetch summary for ${symbol}:`, err);
    return [];
  }
}

// ─── Analyze ETF Flows into Trading Signal ──────────────────

export function analyzeETFFlows(history: ETFFlowDay[]): ETFFlowAnalysis {
  if (!history || history.length < 3) {
    return {
      symbol: "UNKNOWN",
      signal: 0,
      confidence: 0,
      meta: {
        latestInflow: 0,
        latestDate: "",
        totalNetAssets: 0,
        cumNetInflow: 0,
        consecutiveDays: 0,
        trend7d: "mixed",
        avgDailyInflow7d: 0,
      },
    };
  }

  // history is sorted reverse chronological (latest first)
  const latest = history[0];
  const last7 = history.slice(0, Math.min(7, history.length));

  // Count consecutive inflow/outflow days
  let consecutiveDays = 0;
  let direction: "inflow" | "outflow" | null = null;
  for (const day of history) {
    const isInflow = day.total_net_inflow > 0;
    if (direction === null) {
      direction = isInflow ? "inflow" : "outflow";
      consecutiveDays = 1;
    } else if ((direction === "inflow" && isInflow) || (direction === "outflow" && !isInflow)) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  // 7-day metrics
  const inflows7d = last7.filter(d => d.total_net_inflow > 0);
  const outflows7d = last7.filter(d => d.total_net_inflow < 0);
  const totalInflow7d = last7.reduce((sum, d) => sum + d.total_net_inflow, 0);
  const avgDailyInflow7d = totalInflow7d / last7.length;
  const totalNetAssets = latest.total_net_assets || 0;
  const cumNetInflow = latest.cum_net_inflow || 0;

  // Determine trend
  let trend7d: "inflow" | "outflow" | "mixed" = "mixed";
  if (inflows7d.length >= 5) trend7d = "inflow";
  else if (outflows7d.length >= 5) trend7d = "outflow";

  // ─── Compute signal ───────────────────────────────────────
  let signal = 0;
  let confidence = 0;

  // Magnitude: daily inflow relative to total net assets
  const flowMagnitude = totalNetAssets > 0 ? Math.abs(avgDailyInflow7d) / totalNetAssets : 0;

  if (trend7d === "inflow") {
    // Bullish: consistent buying pressure from institutions
    signal = Math.min(1, 0.3 + consecutiveDays * 0.1 + flowMagnitude * 100);
    confidence = Math.min(0.9, 0.4 + consecutiveDays * 0.08 + flowMagnitude * 50);
  } else if (trend7d === "outflow") {
    // Bearish: consistent selling / redemption
    signal = Math.max(-1, -0.3 - consecutiveDays * 0.1 - flowMagnitude * 100);
    confidence = Math.min(0.9, 0.4 + consecutiveDays * 0.08 + flowMagnitude * 50);
  } else if (inflows7d.length > outflows7d.length) {
    // Slight bullish bias
    signal = Math.min(0.4, 0.15 + flowMagnitude * 50);
    confidence = 0.4 + flowMagnitude * 30;
  } else if (outflows7d.length > inflows7d.length) {
    // Slight bearish bias
    signal = Math.max(-0.4, -0.15 - flowMagnitude * 50);
    confidence = 0.4 + flowMagnitude * 30;
  }

  signal = Math.max(-1, Math.min(1, signal));
  confidence = Math.min(1, confidence);

  return {
    symbol: "UNKNOWN",
    signal,
    confidence,
    meta: {
      latestInflow: latest.total_net_inflow,
      latestDate: latest.date,
      totalNetAssets,
      cumNetInflow,
      consecutiveDays,
      trend7d,
      avgDailyInflow7d,
    },
  };
}

// ─── Full ETF analysis for a symbol ─────────────────────────

export async function getETFSignal(symbol: string): Promise<ETFFlowAnalysis> {
  try {
    const history = await getETFSummaryHistory(symbol, "US", 30);
    const analysis = analyzeETFFlows(history);
    analysis.symbol = symbol;
    return analysis;
  } catch (err) {
    console.error(`[SoSoValue ETF] Analysis failed for ${symbol}:`, err);
    return {
      symbol,
      signal: 0,
      confidence: 0,
      meta: {
        latestInflow: 0,
        latestDate: "",
        totalNetAssets: 0,
        cumNetInflow: 0,
        consecutiveDays: 0,
        trend7d: "mixed",
        avgDailyInflow7d: 0,
      },
    };
  }
}
