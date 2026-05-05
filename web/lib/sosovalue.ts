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

// Additional SoSoValue endpoints available:
// - /news/featured, /news/search
// - /currency/list, /currency/klines, /currency/pairs
// - /index/list, /index/snapshot
// - /etf/list, /etf/snapshot
// - /macro/events
// - /analysis/list, /analysis/data
