/**
 * SoSoValue Macro Events Client
 * Endpoint: /macro/events
 *
 * Macro events (FOMC, CPI, NFP, GDP) create volatility.
 * Detecting upcoming events helps avoid trading into high-uncertainty windows.
 */

const SOSO_BASE = "https://openapi.sosovalue.com/openapi/v1";
const API_KEY = process.env.SOSO_API_KEY || "";

async function sosoGet(path: string) {
  const res = await fetch(`${SOSO_BASE}${path}`, {
    headers: { "Content-Type": "application/json", "x-soso-api-key": API_KEY },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`SoSoValue GET ${path} failed: ${res.status}`);
  return res.json();
}

export interface MacroEvent {
  id: string;
  name: string;
  date: string;
  time?: string;
  country?: string;
  importance?: string;     // "high" | "medium" | "low"
  forecast?: string;
  previous?: string;
  actual?: string;
}

export interface MacroAnalysis {
  upcomingEvents: MacroEvent[];
  hasHighImpactSoon: boolean;  // High-impact event within 48h
  nextHighImpactEvent: MacroEvent | null;
  signal: number;              // -0.3 to 0 (bearish adjustment for pre-macro uncertainty)
  confidence: number;
}

// ─── Fetch Macro Events ─────────────────────────────────────

export async function getMacroEvents(date?: string): Promise<MacroEvent[]> {
  try {
    const path = date ? `/macro/events?date=${date}` : "/macro/events";
    const data = await sosoGet(path);
    const list = data?.data?.list || data?.data || data || [];
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error("[SoSoValue Macro] Events fetch failed:", err);
    return [];
  }
}

// ─── Analyze Upcoming Events ────────────────────────────────

const HIGH_IMPACT_KEYWORDS = [
  "FOMC", "FED", "CPI", "NFP", "GDP", "INTEREST RATE",
  "INFLATION", "EMPLOYMENT", "PCE", "PMI", "UNEMPLOYMENT",
];

export function analyzeMacroEvents(events: MacroEvent[]): MacroAnalysis {
  const now = Date.now();
  const HOURS_48 = 48 * 60 * 60 * 1000;
  const HOURS_72 = 72 * 60 * 60 * 1000;

  const upcoming = events.filter(e => {
    const eventTime = new Date(e.date).getTime();
    return eventTime > now && eventTime < now + HOURS_72;
  });

  const highImpact = upcoming.filter(e => {
    const name = (e.name || "").toUpperCase();
    return HIGH_IMPACT_KEYWORDS.some(kw => name.includes(kw)) ||
      (e.importance || "").toLowerCase() === "high";
  });

  // Sort by date ascending
  highImpact.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const nextHighImpact = highImpact[0] || null;

  const hasHighImpactSoon = nextHighImpact !== null &&
    (new Date(nextHighImpact.date).getTime() - now) < HOURS_48;

  // Pre-macro uncertainty: reduce conviction, slight bearish tilt
  const signal = hasHighImpactSoon ? -0.15 : 0;
  const confidence = hasHighImpactSoon ? 0.3 : 0;

  return {
    upcomingEvents: upcoming.slice(0, 5),
    hasHighImpactSoon,
    nextHighImpactEvent: nextHighImpact,
    signal,
    confidence,
  };
}

// ─── Full macro analysis ────────────────────────────────────

export async function getMacroSignal(): Promise<MacroAnalysis> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const events = await getMacroEvents(today);
    return analyzeMacroEvents(events);
  } catch (err) {
    console.error("[SoSoValue Macro] Analysis failed:", err);
    return {
      upcomingEvents: [],
      hasHighImpactSoon: false,
      nextHighImpactEvent: null,
      signal: 0,
      confidence: 0,
    };
  }
}
