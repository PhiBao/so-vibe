/**
 * SoSoValue Sentiment Engine
 * Analyzes news feed for symbol-specific sentiment to augment trading signals.
 */

import { getNewsFeed } from "@/lib/sosovalue";

interface SentimentScore {
  symbol: string;
  score: number; // -1 to 1
  confidence: number; // 0 to 1
  articleCount: number;
  latestHeadline: string;
}

const KEYWORD_MAP: Record<string, string[]> = {
  SOL: ["solana", "sol", "$sol"],
  ETH: ["ethereum", "eth", "$eth", "ether"],
  BTC: ["bitcoin", "btc", "$btc"],
};

function scoreSentiment(title: string): { score: number; weight: number } {
  const t = title.toLowerCase();
  let score = 0;
  let weight = 1;

  // Strong directional keywords
  const bullish = ["surge", "rally", "boom", "breakout", "bull", " ATH", "all-time", "moon", "adoption", "partnership", " ETF", "approval"];
  const bearish = ["crash", "dump", "bear", "decline", "plunge", "collapse", "SEC", "lawsuit", "hack", "exploit", "ban", "restriction"];

  for (const w of bullish) {
    if (t.includes(w.toLowerCase())) { score += 0.3; weight += 0.5; }
  }
  for (const w of bearish) {
    if (t.includes(w.toLowerCase())) { score -= 0.3; weight += 0.5; }
  }

  // Tag-based from API (if available)
  if (t.includes("positive")) { score += 0.2; }
  if (t.includes("negative")) { score -= 0.2; }

  return { score: Math.max(-1, Math.min(1, score)), weight };
}

export async function getSymbolSentiment(symbols: string[]): Promise<Record<string, SentimentScore>> {
  try {
    const feed = await getNewsFeed(50);
    const articles = feed?.data?.list || feed?.data || [];

    const result: Record<string, SentimentScore> = {};
    for (const sym of symbols) {
      result[sym] = { symbol: sym, score: 0, confidence: 0, articleCount: 0, latestHeadline: "" };
    }

    for (const article of articles) {
      const title = (article.title || article.headline || "").toLowerCase();
      if (!title) continue;

      for (const sym of symbols) {
        const keywords = KEYWORD_MAP[sym] || [sym.toLowerCase()];
        const matches = keywords.some((k) => title.includes(k));
        if (matches) {
          const { score, weight } = scoreSentiment(title);
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
    // Return neutral if API fails
    const fallback: Record<string, SentimentScore> = {};
    for (const sym of symbols) {
      fallback[sym] = { symbol: sym, score: 0, confidence: 0, articleCount: 0, latestHeadline: "" };
    }
    return fallback;
  }
}

// In-memory cache to avoid hitting rate limits
let sentimentCache: { data: Record<string, SentimentScore>; time: number } | null = null;
const SENTIMENT_CACHE_TTL = 300_000; // 5 minutes

export async function getCachedSentiment(symbols: string[]): Promise<Record<string, SentimentScore>> {
  if (sentimentCache && Date.now() - sentimentCache.time < SENTIMENT_CACHE_TTL) {
    // Filter only requested symbols from cache
    const result: Record<string, SentimentScore> = {};
    for (const sym of symbols) {
      result[sym] = sentimentCache.data[sym] || { symbol: sym, score: 0, confidence: 0, articleCount: 0, latestHeadline: "" };
    }
    return result;
  }

  const fresh = await getSymbolSentiment(symbols);
  sentimentCache = { data: fresh, time: Date.now() };
  return fresh;
}
