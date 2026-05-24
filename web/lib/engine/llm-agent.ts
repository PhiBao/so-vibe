/**
 * DGrid AI Agent — LLM-powered intelligence layer for SoVibe
 * Uses DGrid AI Gateway (OpenAI-compatible) for:
 *   1. News sentiment analysis (replaces keyword counter)
 *   2. Market regime classification
 *   3. Signal reasoning / explainability
 *
 * DGrid API: https://api.dgrid.ai/v1 (OpenAI-compatible)
 * Docs: https://docs.dgrid.ai/
 */

import OpenAI from "openai";

const DGRID_BASE = "https://api.dgrid.ai/v1";
const DGRID_API_KEY = process.env.DGRID_API_KEY || "";

const client = new OpenAI({
  baseURL: DGRID_BASE,
  apiKey: DGRID_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://sovibe.xyz",
    "X-Title": "SoVibe Terminal",
  },
});

// Lightweight model for cost efficiency on frequent calls
const FAST_MODEL = "openai/gpt-4o-mini";

// ─── Types ──────────────────────────────────────────────────

export interface NewsSentimentResult {
  score: number;       // -1 (bearish) to 1 (bullish)
  confidence: number;  // 0 to 1
  reasoning: string;
  keyNarratives: string[];
  latestHeadline: string;
  articleCount: number;
}

export interface MarketRegimeResult {
  regime: "trending_up" | "trending_down" | "ranging" | "high_volatility" | "low_volatility" | "pre_macro_event";
  confidence: number;
  reasoning: string;
  suggestedWeights: {
    trendFollowing: number;
    meanReversion: number;
    momentum: number;
    srBounce: number;
    volumeBreakout: number;
  };
}

export interface SignalReasoningResult {
  reasoning: string;
  riskFactors: string[];
  convictionLevel: "low" | "medium" | "high";
}

// ─── News Sentiment Analysis ────────────────────────────────

export async function analyzeNewsSentiment(
  symbol: string,
  articles: Array<{ title: string; content?: string; tags?: string[] }>
): Promise<NewsSentimentResult> {
  if (!DGRID_API_KEY || articles.length === 0) {
    return {
      score: 0,
      confidence: 0,
      reasoning: DGRID_API_KEY ? "No articles to analyze" : "DGRID_API_KEY not configured",
      keyNarratives: [],
      latestHeadline: "",
      articleCount: 0,
    };
  }

  const headlines = articles.slice(0, 15).map(a => `- ${a.title}${a.tags?.length ? ` [tags: ${a.tags.join(", ")}]` : ""}`).join("\n");

  const prompt = `Analyze the following crypto news headlines for ${symbol} sentiment.
Return a JSON object with:
- score: number from -1 (extremely bearish) to 1 (extremely bullish)
- confidence: number from 0 to 1 (how confident you are in this assessment)
- reasoning: short 1-2 sentence summary of WHY you scored it this way
- keyNarratives: array of 1-3 key narratives detected (e.g. "ETF inflows", "regulatory fear", "institutional adoption")

Headlines:
${headlines}

Respond with ONLY the JSON object, no markdown, no explanation.`;

  try {
    const completion = await client.chat.completions.create({
      model: FAST_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 300,
    });

    const text = completion.choices[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: Math.max(-1, Math.min(1, Number(parsed.score) || 0)),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reasoning: String(parsed.reasoning || ""),
      keyNarratives: Array.isArray(parsed.keyNarratives) ? parsed.keyNarratives.slice(0, 3) : [],
      latestHeadline: articles[0]?.title || "",
      articleCount: articles.length,
    };
  } catch (err) {
    console.error(`[LLM] News sentiment failed for ${symbol}:`, err);
    return {
      score: 0,
      confidence: 0,
      reasoning: `LLM analysis failed: ${err instanceof Error ? err.message : "unknown error"}`,
      keyNarratives: [],
      latestHeadline: "",
      articleCount: articles.length,
    };
  }
}

// ─── Market Regime Classification ───────────────────────────

export async function classifyMarketRegime(
  symbol: string,
  context: {
    technicals: {
      rsi: number;
      macdHistogram: number;
      bbPosition: string;
      emaAlignment: string;
      volumeRatio: number;
    };
    marketSnapshot?: {
      athDistance: number;    // % from ATH
      cyclePosition: number;  // % from cycle low
      marketcapRank: number;
    };
    etfFlow?: {
      recentInflow: number;
      trend: string;
    };
    macroEvents?: Array<{ name: string; date: string }>;
  }
): Promise<MarketRegimeResult> {
  if (!DGRID_API_KEY) {
    return {
      regime: "ranging",
      confidence: 0.3,
      reasoning: "DGRID_API_KEY not configured — falling back to ranging default",
      suggestedWeights: { trendFollowing: 0.2, meanReversion: 0.2, momentum: 0.2, srBounce: 0.2, volumeBreakout: 0.2 },
    };
  }

  const contextStr = JSON.stringify(context, null, 2);

  const prompt = `Classify the current market regime for ${symbol} based on this data:
${contextStr}

Return a JSON object with:
- regime: one of "trending_up", "trending_down", "ranging", "high_volatility", "low_volatility", "pre_macro_event"
- confidence: 0-1
- reasoning: 1 sentence
- suggestedWeights: object with 5 strategy weights (trendFollowing, meanReversion, momentum, srBounce, volumeBreakout) that sum to 1.0 based on which strategies work best in this regime

Respond with ONLY the JSON object.`;

  try {
    const completion = await client.chat.completions.create({
      model: FAST_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 300,
    });

    const text = completion.choices[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      regime: parsed.regime || "ranging",
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reasoning: String(parsed.reasoning || ""),
      suggestedWeights: {
        trendFollowing: Number(parsed.suggestedWeights?.trendFollowing) || 0.2,
        meanReversion: Number(parsed.suggestedWeights?.meanReversion) || 0.2,
        momentum: Number(parsed.suggestedWeights?.momentum) || 0.2,
        srBounce: Number(parsed.suggestedWeights?.srBounce) || 0.2,
        volumeBreakout: Number(parsed.suggestedWeights?.volumeBreakout) || 0.2,
      },
    };
  } catch (err) {
    console.error(`[LLM] Regime classification failed for ${symbol}:`, err);
    return {
      regime: "ranging",
      confidence: 0.3,
      reasoning: "Classification failed — defaulting to ranging",
      suggestedWeights: { trendFollowing: 0.2, meanReversion: 0.2, momentum: 0.2, srBounce: 0.2, volumeBreakout: 0.2 },
    };
  }
}

// ─── Signal Reasoning / Explainability ──────────────────────

export async function explainSignal(
  symbol: string,
  signal: {
    action: string;
    signal: number;
    confidence: number;
    longVotes: number;
    shortVotes: number;
    details: Array<{ name: string; signal: string; confidence: string }>;
    vibeScore?: { vibe: number; confidence: number; fullConsensus: boolean };
    price?: number;
  },
  sentiments?: { llm?: NewsSentimentResult; etfFlow?: { signal: number; meta: any } }
): Promise<SignalReasoningResult> {
  if (!DGRID_API_KEY) {
    return {
      reasoning: `${symbol}: ${signal.action.toUpperCase()} signal (${(signal.confidence * 100).toFixed(0)}% confidence, ${signal.longVotes}L/${signal.shortVotes}S votes). LLM reasoning unavailable — add DGRID_API_KEY.`,
      riskFactors: ["LLM disabled"],
      convictionLevel: signal.confidence > 0.7 ? "high" : signal.confidence > 0.5 ? "medium" : "low",
    };
  }

  const signalStr = JSON.stringify(signal, null, 2);
  const sentimentStr = sentiments ? JSON.stringify(sentiments, null, 2) : "N/A";

  const prompt = `Explain this trading signal in 2-3 sentences for a crypto trader. Make it actionable.

Signal data:
${signalStr}

Additional context:
${sentimentStr}

Return JSON:
- reasoning: 2-3 sentence explanation of WHY this signal was generated
- riskFactors: array of 1-3 key risk factors to watch
- convictionLevel: "low", "medium", or "high"

Respond with ONLY the JSON object.`;

  try {
    const completion = await client.chat.completions.create({
      model: FAST_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 300,
    });

    const text = completion.choices[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      reasoning: String(parsed.reasoning || `${signal.action.toUpperCase()} signal on ${symbol} at ${signal.confidence} confidence`),
      riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors.slice(0, 3) : [],
      convictionLevel: parsed.convictionLevel || "medium",
    };
  } catch (err) {
    console.error(`[LLM] Signal reasoning failed for ${symbol}:`, err);
    return {
      reasoning: `${symbol}: ${signal.action.toUpperCase()} signal (${(signal.confidence * 100).toFixed(0)}% confidence, ${signal.longVotes}L/${signal.shortVotes}S votes)`,
      riskFactors: [],
      convictionLevel: signal.confidence > 0.7 ? "high" : signal.confidence > 0.5 ? "medium" : "low",
    };
  }
}
