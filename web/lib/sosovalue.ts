/**
 * SoSoValue API Client — Full endpoint coverage
 * Docs: https://sosovalue-1.gitbook.io/sosovalue-api-doc
 */

const SOSO_BASE = "https://openapi.sosovalue.com/openapi/v1";
const API_KEY = process.env.SOSO_API_KEY || "";

async function sosoGet(path: string, revalidate = 60) {
  const url = `${SOSO_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-soso-api-key": API_KEY,
    },
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`SoSoValue GET ${path} failed: ${res.status}`);
  return res.json();
}

// ─── Feeds / News ──────────────────────────────────────────

export async function getNewsFeed(limit = 20) {
  return sosoGet(`/news?page_size=${limit}&page=1`);
}

export async function getNewsByCategory(category: number, limit = 20) {
  return sosoGet(`/news?category=${category}&page_size=${limit}&page=1`);
}

export async function getNewsByCurrency(currencyId: string, limit = 20) {
  return sosoGet(`/news?currency_id=${currencyId}&page_size=${limit}&page=1`);
}

export async function getNewsByProject(projectId: string, limit = 20) {
  return sosoGet(`/news?project_id=${projectId}&page_size=${limit}&page=1`);
}

export async function getHotNews(limit = 10) {
  return sosoGet(`/news/hot?page_size=${limit}&page=1`);
}

export async function getFeaturedNews(limit = 10) {
  return sosoGet(`/news/featured?page_size=${limit}&page=1`);
}

export async function searchNews(keyword: string, limit = 20) {
  return sosoGet(`/news/search?keyword=${encodeURIComponent(keyword)}&page_size=${limit}&page=1`);
}

// ─── Currency & Pairs ──────────────────────────────────────

export async function getCurrencies() {
  return sosoGet("/currencies");
}

export async function getCurrencyInfo(currencyId: string) {
  return sosoGet(`/currencies/${currencyId}`);
}

export async function getCurrencyMarketSnapshot(currencyId: string) {
  return sosoGet(`/currencies/${currencyId}/market-snapshot`, 300);
}

export async function getCurrencyKlines(currencyId: string, startTime?: number, endTime?: number, limit = 100) {
  let path = `/currencies/${currencyId}/klines?interval=1d&limit=${limit}`;
  if (startTime) path += `&start_time=${startTime}`;
  if (endTime) path += `&end_time=${endTime}`;
  return sosoGet(path, 300);
}

export async function getCurrencySupply(currencyId: string) {
  return sosoGet(`/currencies/${currencyId}/supply`, 3600);
}

export async function getCurrencyPairs(currencyId: string) {
  return sosoGet(`/currencies/${currencyId}/pairs`, 300);
}

export async function getSectorSpotlight() {
  return sosoGet("/currencies/sector-spotlight", 300);
}

// ─── ETF ───────────────────────────────────────────────────

export async function getETFSummaryHistory(symbol: string, countryCode = "US", limit = 30) {
  return sosoGet(`/etfs/summary-history?symbol=${symbol.toUpperCase()}&country_code=${countryCode}&limit=${limit}`, 300);
}

export async function getETFList() {
  return sosoGet("/etfs", 3600);
}

export async function getETFMarketSnapshot(ticker: string) {
  return sosoGet(`/etfs/${ticker}/market-snapshot`, 300);
}

export async function getETFHistory(ticker: string) {
  return sosoGet(`/etfs/${ticker}/history`, 300);
}

// ─── SoSoValue Index ───────────────────────────────────────

export async function getIndices() {
  return sosoGet("/indices", 3600);
}

export async function getIndexConstituents(indexTicker: string) {
  return sosoGet(`/indices/${indexTicker}/constituents`, 3600);
}

export async function getIndexMarketSnapshot(indexTicker: string) {
  return sosoGet(`/indices/${indexTicker}/market-snapshot`, 300);
}

export async function getIndexKlines(indexTicker: string) {
  return sosoGet(`/indices/${indexTicker}/klines`, 300);
}

// ─── Crypto Stocks ─────────────────────────────────────────

export async function getCryptoStocks() {
  return sosoGet("/crypto-stocks", 3600);
}

export async function getCryptoStockMarketSnapshot(stockTicker: string) {
  return sosoGet(`/crypto-stocks/${stockTicker}/market-snapshot`, 300);
}

export async function getCryptoSectors() {
  return sosoGet("/crypto-stocks/sector", 3600);
}

// ─── Macro ─────────────────────────────────────────────────

export async function getMacroEvents(date?: string, limit = 20) {
  let path = `/macro/events?limit=${limit}`;
  if (date) path += `&date=${date}`;
  return sosoGet(path, 3600);
}

// ─── Fundraising ───────────────────────────────────────────

export async function getFundraisingProjects() {
  return sosoGet("/fundraising/projects", 3600);
}

export async function getFundraisingProjectDetail(projectId: string) {
  return sosoGet(`/fundraising/projects/${projectId}`, 3600);
}

// ─── Analysis Charts ───────────────────────────────────────

export async function getAnalysisCharts() {
  return sosoGet("/analyses", 3600);
}

export async function getAnalysisChartData(chartName: string) {
  return sosoGet(`/analyses/${chartName}`, 3600);
}
