import { NextResponse } from "next/server";
import { getNewsFeed, getHotNews } from "@/lib/sosovalue";

// Simple in-memory cache to avoid hitting SoSoValue rate limits
let cache: { data: any; time: number } | null = null;
const CACHE_TTL = 120_000; // 2 minutes

function extractSourceFromContent(content?: string): string | null {
  if (!content) return null;
  const match = content.match(/\[([^\]]+)\]$/);
  return match ? match[1] : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "feed";
  const limit = Math.min(parseInt(searchParams.get("limit") || "5"), 20);

  // Check cache
  if (cache && Date.now() - cache.time < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const data = type === "hot" ? await getHotNews(limit) : await getNewsFeed(limit);
    const articles = data?.data?.list || data?.data || data || [];
    const normalized = (Array.isArray(articles) ? articles : []).slice(0, limit).map((item: any) => ({
      title: item.title || item.headline || "Untitled",
      source: item.source || item.siteName || extractSourceFromContent(item.content) || "SoSoValue",
      url: item.url || item.link || item.source_link || "#",
      time: item.publishTime || item.time || item.createdAt || item.release_time || null,
      sentiment: item.sentiment || item.tag || null,
    }));

    const result = { articles: normalized, type };
    cache = { data: result, time: Date.now() };
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[News API Error]", message);
    // Return empty but successful so UI doesn't break
    return NextResponse.json({ articles: [], type, error: message });
  }
}
