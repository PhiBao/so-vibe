/**
 * SoSoValue API Client
 * Docs: https://sosovalue-1.gitbook.io/sosovalue-api-doc
 */

const SOSO_BASE = "https://openapi.sosovalue.com/openapi/v1";
const API_KEY = process.env.SOSO_API_KEY || "";

async function sosoGet(path: string) {
  const url = `${SOSO_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-soso-api-key": API_KEY,
    },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`SoSoValue GET ${path} failed: ${res.status}`);
  return res.json();
}

// ─── Feeds / News ──────────────────────────────────────────

export async function getNewsFeed(limit = 20) {
  return sosoGet(`/news?page=1&size=${limit}`);
}

export async function getHotNews(limit = 10) {
  return sosoGet(`/news/hot?page=1&size=${limit}`);
}

export async function getFeaturedNews(limit = 10) {
  return sosoGet(`/news/featured?page=1&size=${limit}`);
}

export async function searchNews(keyword: string, limit = 10) {
  return sosoGet(`/news/search?keyword=${encodeURIComponent(keyword)}&page=1&size=${limit}`);
}

// ─── Currency & Market Data ────────────────────────────────

export async function getCurrencyList() {
  return sosoGet("/currency/list");
}

export async function getCurrencyKlines(symbol: string, interval = "1h", limit = 100) {
  return sosoGet(`/currency/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
}

export async function getCurrencyPairs() {
  return sosoGet("/currency/pairs");
}

// ─── Index Data ────────────────────────────────────────────

export async function getIndexList() {
  return sosoGet("/index/list");
}

export async function getIndexSnapshot(indexId: string) {
  return sosoGet(`/index/snapshot?indexId=${indexId}`);
}

// ─── ETF Data ──────────────────────────────────────────────

export async function getEtfList() {
  return sosoGet("/etf/list");
}

export async function getEtfSnapshot(etfId: string) {
  return sosoGet(`/etf/snapshot?etfId=${etfId}`);
}

// ─── Macro ─────────────────────────────────────────────────

export async function getMacroEvents() {
  return sosoGet("/macro/events");
}

// ─── Analysis ──────────────────────────────────────────────

export async function getAnalysisCharts() {
  return sosoGet("/analysis/list");
}

export async function getChartData(chartId: string) {
  return sosoGet(`/analysis/data?chartId=${chartId}`);
}
