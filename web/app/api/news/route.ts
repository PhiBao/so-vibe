import { NextResponse } from "next/server";
import {
  getNewsFeed,
  getHotNews,
  getNewsByCurrency,
  getNewsByCategory,
  getFeaturedNews,
  searchNews,
} from "@/lib/sosovalue";

let cache: { data: any; time: number; cacheKey: string } | null = null;
const CACHE_TTL = 120_000; // 2 min

const SYMBOL_TO_CURRENCY_ID: Record<string, string> = {
  SOL: "1673723677362319871",
  ETH: "1673723677362319870",
  BTC: "1673723677362319867",
};

const CATEGORY_LABELS: Record<number, string> = {
  1: "news",
  2: "research",
  3: "institution",
  4: "insights",
  7: "announcement",
  13: "crypto_stock",
};

function detectSource(sourceLink: string): string {
  if (!sourceLink) return "NEWS";
  const url = sourceLink.toLowerCase();
  if (url.includes("x.com") || url.includes("twitter.com")) return "X";
  if (url.includes("sosovalue")) return "SoSoValue";
  return "NEWS";
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").trim();
}

function computeQuickSentiment(item: any): "bullish" | "bearish" | "neutral" {
  const tags: string[] = Array.isArray(item.tags) ? item.tags.map((t: string) => t.toLowerCase()) : [];
  const content = stripHtml(item.content || "").toLowerCase();
  const title = (item.title || "").toLowerCase();

  const bullish = ["bull", "surge", "rally", "breakout", "adoption", "approval", "partnership", "etf", "moon", "ath"];
  const bearish = ["bear", "crash", "dump", "decline", "lawsuit", "hack", "exploit", "ban", "sec", "regulation"];

  let score = 0;
  for (const tag of tags) {
    if (bullish.some((w) => tag.includes(w))) score += 0.5;
    if (bearish.some((w) => tag.includes(w))) score -= 0.5;
  }
  for (const w of bullish) { if (title.includes(w)) score += 0.3; if (content.includes(w)) score += 0.2; }
  for (const w of bearish) { if (title.includes(w)) score -= 0.3; if (content.includes(w)) score -= 0.2; }

  if (score > 0.3) return "bullish";
  if (score < -0.3) return "bearish";
  return "neutral";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "feed";
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
  const symbol = searchParams.get("symbol") || "";
  const category = searchParams.get("category") || "";
  const search = searchParams.get("search") || "";

  const cacheKey = `${type}|${limit}|${symbol}|${category}|${search}`;

  if (cache && Date.now() - cache.time < CACHE_TTL && cache.cacheKey === cacheKey) {
    return NextResponse.json(cache.data);
  }

  try {
    let raw: any;

    if (search) {
      raw = await searchNews(search, limit);
    } else if (symbol) {
      const currencyId = SYMBOL_TO_CURRENCY_ID[symbol.toUpperCase()];
      if (currencyId) {
        raw = await getNewsByCurrency(currencyId, limit);
      } else {
        raw = await getNewsFeed(limit);
      }
    } else if (category) {
      const catNum = parseInt(category);
      if (!isNaN(catNum)) {
        raw = await getNewsByCategory(catNum, limit);
      } else {
        raw = await getNewsFeed(limit);
      }
    } else if (type === "hot") {
      raw = await getHotNews(limit);
    } else if (type === "featured") {
      raw = await getFeaturedNews(limit);
    } else {
      raw = await getNewsFeed(limit);
    }

    const list = raw?.data?.list || raw?.data || raw || [];
    const articles = (Array.isArray(list) ? list : []).slice(0, limit);

    const normalized = articles.map((item: any) => {
      const sourceType = detectSource(item.original_link || item.source_link || "");
      const isXPost = sourceType === "X";
      const plainContent = item.content ? stripHtml(item.content).slice(0, 200) : "";

      let title = item.title || "";
      if (!title && isXPost) {
        const author = item.nick_name || item.author || "";
        title = plainContent.slice(0, 100) || (author ? `${author} on X` : "X Post");
      } else if (!title) {
        title = plainContent.slice(0, 100) || "News Article";
      }

      return {
        id: item.id || "",
        title,
        source: item.nick_name || item.author || item.source || item.siteName || "SoSoValue",
        sourceType,
        isXPost,
        author: item.author || "",
        author_avatar: item.author_avatar_url || "",
        url: item.original_link || item.source_link || "#",
        time: item.release_time || item.publishTime || null,
        category: CATEGORY_LABELS[item.category] || "news",
        categoryId: item.category || 0,
        impression_count: item.impression_count || 0,
        like_count: item.like_count || 0,
        retweet_count: item.retweet_count || 0,
        matched_currencies: Array.isArray(item.matched_currencies)
          ? item.matched_currencies.map((c: any) => c.name || c.symbol || c.full_name || "").filter(Boolean)
          : [],
        tags: Array.isArray(item.tags) ? item.tags.slice(0, 5) : [],
        feature_image: item.feature_image || "",
        is_blue_verified: !!item.is_blue_verified,
        verified_type: item.verified_type || "",
        quote_info: item.quote_info || null,
        content_preview: plainContent.slice(0, 80),
        sentiment: computeQuickSentiment(item),
      };
    });

    const hasLLM = !!process.env.DGRID_API_KEY;

    const result = {
      articles: normalized,
      type,
      symbol: symbol || null,
      category: category || null,
      total: raw?.data?.total || articles.length,
      llm_enabled: hasLLM,
      meta: {
        filters_applied: {
          symbol: !!symbol,
          category: !!category,
          search: !!search,
        },
      },
    };

    cache = { data: result, time: Date.now(), cacheKey };
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[News API Error]", message);
    return NextResponse.json({
      articles: [],
      type,
      error: message,
      llm_enabled: !!process.env.DGRID_API_KEY,
    });
  }
}
