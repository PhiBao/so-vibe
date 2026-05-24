"use client";
import { useState, useEffect, useCallback } from "react";

interface NewsArticle {
  id: string;
  title: string;
  source: string;
  author: string;
  author_avatar: string;
  url: string;
  time: string | null;
  category: string;
  categoryId: number;
  impression_count: number;
  like_count: number;
  retweet_count: number;
  matched_currencies: string[];
  tags: string[];
  feature_image: string;
  is_blue_verified: boolean;
  verified_type: string;
}

const SYMBOLS = ["BTC", "ETH", "SOL"];

export default function NewsPage() {
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<string>("");
  const [llmEnabled, setLlmEnabled] = useState(false);

  const fetchNews = useCallback(async () => {
    setNewsLoading(true);
    setNewsError(null);
    try {
      const params = new URLSearchParams();
      params.set("type", "hot");
      params.set("limit", "30");
      if (activeSymbol) params.set("symbol", activeSymbol);

      const res = await fetch(`/api/news?${params.toString()}`);
      const data = await res.json();
      if (data.articles && Array.isArray(data.articles)) {
        setNews(data.articles);
        setLlmEnabled(data.llm_enabled || false);
        if (data.articles.length === 0 && data.error) {
          setNewsError(data.error);
        }
      }
    } catch (err: any) {
      setNewsError(err.message || "Failed to load news");
    } finally {
      setNewsLoading(false);
    }
  }, [activeSymbol]);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 120000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const formatTime = (ts: string | null) => {
    if (!ts) return "";
    const d = new Date(typeof ts === "string" ? parseInt(ts) : ts);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const formatEngagement = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--cyan)] glow-cyan tracking-wider">
            SOSOVALUE_NEWS{llmEnabled ? "_AI" : ""}
          </h1>
          <p className="text-[11px] text-[var(--text-secondary)] font-mono mt-1">
            {llmEnabled ? "DGrid AI-powered sentiment analysis" : "Real-time crypto news feed"} from{" "}
            <a href="https://sosovalue.com" target="_blank" rel="noopener noreferrer" className="text-[var(--cyan)] hover:underline">
              sosovalue.com
            </a>
          </p>
        </div>
        <button
          onClick={fetchNews}
          disabled={newsLoading}
          className="btn-terminal text-[10px] py-1.5 px-3 disabled:opacity-40"
        >
          {newsLoading ? "LOADING..." : "[ REFRESH ]"}
        </button>
      </div>

      {/* Symbol filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSymbol("")}
          className={`text-[10px] px-3 py-1 border font-mono transition-colors ${
            !activeSymbol
              ? "border-[var(--cyan)] text-[var(--cyan)] bg-[var(--cyan)]/10"
              : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--cyan)]/30"
          }`}
        >
          ALL
        </button>
        {SYMBOLS.map((sym) => (
          <button
            key={sym}
            onClick={() => setActiveSymbol(sym)}
            className={`text-[10px] px-3 py-1 border font-mono transition-colors ${
              activeSymbol === sym
                ? "border-[var(--cyan)] text-[var(--cyan)] bg-[var(--cyan)]/10"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--cyan)]/30"
            }`}
          >
            {sym}
          </button>
        ))}
      </div>

      <div className="terminal-card">
        <div className="p-4">
          {newsLoading && news.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-secondary)] text-[12px] font-mono">Loading news feed...</div>
          ) : newsError ? (
            <div className="text-center py-8 space-y-3">
              <div className="text-[var(--red)] text-[12px] font-mono">[ERR] {newsError}</div>
              <button onClick={fetchNews} className="btn-terminal text-[10px] py-1.5 px-3">[ RETRY ]</button>
            </div>
          ) : news.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-secondary)] text-[12px] font-mono">No articles available</div>
          ) : (
            <div className="space-y-1">
              {news.map((article, i) => (
                <a
                  key={article.id || i}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start justify-between py-3 px-3 bg-white/[0.02] border border-[var(--border)] hover:border-[var(--cyan)]/30 transition-colors group gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-mono text-[var(--text)] group-hover:text-[var(--cyan)] transition-colors leading-relaxed">
                      {article.title}
                    </div>

                    {/* Tags + Currencies row */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {/* Matched currencies */}
                      {article.matched_currencies.slice(0, 3).map((c) => (
                        <span key={c} className="text-[8px] px-1.5 py-0.5 border border-[var(--green)]/30 text-[var(--green)] font-mono">
                          ${c}
                        </span>
                      ))}
                      {/* Tags */}
                      {article.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[8px] px-1.5 py-0.5 border border-[var(--border)] text-[var(--text-dim)] font-mono">
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* Source + category + engagement */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-[var(--text-secondary)]">
                        {article.source}
                        {article.is_blue_verified && (
                          <span className="ml-1 text-[var(--cyan)]">✓</span>
                        )}
                      </span>
                      <span className="text-[9px] px-1 py-0.5 border border-[var(--border)] text-[var(--text-dim)]">
                        {article.category.toUpperCase()}
                      </span>
                      {article.impression_count > 0 && (
                        <span className="text-[9px] text-[var(--text-dim)]">
                          👁 {formatEngagement(article.impression_count)}
                        </span>
                      )}
                      {article.like_count > 0 && (
                        <span className="text-[9px] text-[var(--text-dim)]">
                          ♥ {formatEngagement(article.like_count)}
                        </span>
                      )}
                      <span className="text-[10px] text-[var(--text-dim)] ml-auto">
                        {formatTime(article.time)}
                      </span>
                    </div>
                  </div>
                  <span className="text-[12px] text-[var(--text-secondary)] ml-2 shrink-0 mt-0.5">↗</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
