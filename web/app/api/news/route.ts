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

    const normalized = articles.map((item: any) => ({
      id: item.id || "",
      title: item.title || item.headline || "Untitled",
      source: item.nick_name || item.source || item.siteName || "SoSoValue",
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
    }));

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
