/**
 * SoSoValue Sentiment Engine v2
 * Now uses DGrid LLM for real sentiment analysis instead of keyword matching.
 * Falls back to keyword-based scoring if DGRID_API_KEY is not configured.
 */

import { analyzeNewsSentiment, type NewsSentimentResult } from "@/lib/engine/llm-agent";

const SOSO_BASE = "https://openapi.sosovalue.com/openapi/v1";
const API_KEY = process.env.SOSO_API_KEY || "";

async function sosoGet(path: string) {
  const res = await fetch(`${SOSO_BASE}${path}`, {
    headers: { "Content-Type": "application/json", "x-soso-api-key": API_KEY },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`SoSoValue GET ${path} failed: ${res.status}`);
  return res.json();
}

interface SentimentScore {
  symbol: string;
  score: number;
  confidence: number;
  articleCount: number;
  latestHeadline: string;
  reasoning?: string;
  keyNarratives?: string[];
}

// Symbol → SoSoValue currency_id mapping
const SYMBOL_TO_CURRENCY_ID: Record<string, string> = {
  SOL: "1673723677362319871",
  ETH: "1673723677362319870",
  BTC: "1673723677362319867",
};

// ─── Legacy keyword scorer (fallback when LLM unavailable) ──

const KEYWORD_MAP: Record<string, string[]> = {
  SOL: ["solana", "sol", "$sol"],
  ETH: ["ethereum", "eth", "$eth", "ether"],
  BTC: ["bitcoin", "btc", "$btc"],
};

function keywordScore(headline: string): { score: number; weight: number } {
  const t = headline.toLowerCase();
  let score = 0;
  let weight = 1;
  const bullish = ["surge", "rally", "boom", "breakout", "bull", " ATH", "all-time", "moon", "adoption", "partnership", " ETF", "approval"];
  const bearish = ["crash", "dump", "bear", "decline", "plunge", "collapse", "SEC", "lawsuit", "hack", "exploit", "ban", "restriction"];
  for (const w of bullish) { if (t.includes(w.toLowerCase())) { score += 0.3; weight += 0.5; } }
  for (const w of bearish) { if (t.includes(w.toLowerCase())) { score -= 0.3; weight += 0.5; } }
  if (t.includes("positive")) score += 0.2;
  if (t.includes("negative")) score -= 0.2;
  return { score: Math.max(-1, Math.min(1, score)), weight };
}

// ─── Fetch currency-matched news from SoSoValue ─────────────

async function fetchCurrencyNews(symbol: string, limit = 20): Promise<Array<{ title: string; content?: string; tags?: string[] }>> {
  try {
    const currencyId = SYMBOL_TO_CURRENCY_ID[symbol.toUpperCase()];
    const path = currencyId
      ? `/news?currency_id=${currencyId}&page_size=${limit}&page=1`
      : `/news?page_size=${limit}&page=1`;

    const data = await sosoGet(path);
    const list = data?.data?.list || data?.data || [];

    if (!Array.isArray(list)) return [];

    return list.slice(0, limit).map((item: any) => ({
      title: item.title || "",
      content: item.content || "",
      tags: item.tags || [],
    }));
  } catch {
    return [];
  }
}

// ─── LLM-powered sentiment (primary path) ───────────────────

async function llmSentiment(symbol: string): Promise<SentimentScore> {
  const articles = await fetchCurrencyNews(symbol, 15);

  if (articles.length === 0) {
    return {
      symbol,
      score: 0,
      confidence: 0,
      articleCount: 0,
      latestHeadline: "",
      reasoning: "No articles found",
      keyNarratives: [],
    };
  }

  const result: NewsSentimentResult = await analyzeNewsSentiment(symbol, articles);

  return {
    symbol,
    score: result.score,
    confidence: result.confidence,
    articleCount: result.articleCount,
    latestHeadline: result.latestHeadline,
    reasoning: result.reasoning,
    keyNarratives: result.keyNarratives,
  };
}

// ─── Legacy keyword sentiment (fallback) ────────────────────

async function legacySentiment(symbols: string[]): Promise<Record<string, SentimentScore>> {
  try {
    const data = await sosoGet("/news?page_size=50&page=1");
    const articles = data?.data?.list || data?.data || [];

    const result: Record<string, SentimentScore> = {};
    for (const sym of symbols) {
      result[sym] = { symbol: sym, score: 0, confidence: 0, articleCount: 0, latestHeadline: "" };
    }

    for (const article of Array.isArray(articles) ? articles : []) {
      const title = (article.title || article.headline || "").toLowerCase();
      if (!title) continue;

      for (const sym of symbols) {
        const keywords = KEYWORD_MAP[sym] || [sym.toLowerCase()];
        if (keywords.some(k => title.includes(k))) {
          const { score, weight } = keywordScore(title);
          const s = result[sym];
          s.score = (s.score * s.articleCount + score * weight) / (s.articleCount + weight);
          s.confidence = Math.min(1, s.confidence + 0.15);
          s.articleCount += 1;
          if (!s.latestHeadline) s.latestHeadline = article.title || article.headline;
        }
      }
    }
    return result;
  } catch {
    const fallback: Record<string, SentimentScore> = {};
    for (const sym of symbols) {
      fallback[sym] = { symbol: sym, score: 0, confidence: 0, articleCount: 0, latestHeadline: "" };
    }
    return fallback;
  }
}

// ─── Main export: get sentiment for symbols ─────────────────

export async function getSymbolSentiment(symbols: string[]): Promise<Record<string, SentimentScore>> {
  const hasLLM = !!process.env.DGRID_API_KEY;

  // Run LLM sentiment for each symbol in parallel
  if (hasLLM) {
    const results = await Promise.all(
      symbols.map(async (sym) => {
        try {
          return await llmSentiment(sym);
        } catch {
          return { symbol: sym, score: 0, confidence: 0, articleCount: 0, latestHeadline: "", reasoning: "LLM analysis failed" };
        }
      })
    );
    const map: Record<string, SentimentScore> = {};
    for (const r of results) map[r.symbol] = r;
    return map;
  }

  // Fall back to legacy keyword matching
  return legacySentiment(symbols);
}

// ─── Cache ──────────────────────────────────────────────────

let sentimentCache: { data: Record<string, SentimentScore>; time: number } | null = null;
const SENTIMENT_CACHE_TTL = 300_000; // 5 min

export async function getCachedSentiment(symbols: string[]): Promise<Record<string, SentimentScore>> {
  if (sentimentCache && Date.now() - sentimentCache.time < SENTIMENT_CACHE_TTL) {
    const result: Record<string, SentimentScore> = {};
    for (const sym of symbols) {
      result[sym] = sentimentCache.data[sym] || {
        symbol: sym, score: 0, confidence: 0, articleCount: 0, latestHeadline: "",
      };
    }
    return result;
  }

  const fresh = await getSymbolSentiment(symbols);
  sentimentCache = { data: fresh, time: Date.now() };
  return fresh;
}
