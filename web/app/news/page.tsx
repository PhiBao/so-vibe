"use client";
import { useState, useEffect, useCallback } from "react";

interface NewsArticle {
  id: string;
  title: string;
  source: string;
  sourceType: string;
  isXPost: boolean;
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
  quote_info: any | null;
  content_preview: string;
  sentiment: "bullish" | "bearish" | "neutral";
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
        if (data.articles.length === 0 && data.error) setNewsError(data.error);
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

  const sentimentBorder = (s: string) => {
    if (s === "bullish") return "border-l-[var(--green)]";
    if (s === "bearish") return "border-l-[var(--red)]";
    return "border-l-[var(--text-dim)]";
  };

  const sentimentBadge = (s: string) => {
    if (s === "bullish") return { border: "border-[var(--green)]/40", text: "text-[var(--green)]", bg: "bg-[var(--green)]/5", label: "▲ BULLISH" };
    if (s === "bearish") return { border: "border-[var(--red)]/40", text: "text-[var(--red)]", bg: "bg-[var(--red)]/5", label: "▼ BEARISH" };
    return { border: "border-[var(--text-dim)]", text: "text-[var(--text-secondary)]", bg: "", label: "◆ NEUTRAL" };
  };

  const sourceBadge = (type: string) => {
    if (type === "X") return { border: "border-[var(--magenta)]/30", text: "text-[var(--magenta)]", label: "X POST" };
    return { border: "border-[var(--cyan)]/30", text: "text-[var(--cyan)]", label: "NEWS" };
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--cyan)] glow-cyan tracking-wider">
            SOSOVALUE_NEWS{llmEnabled ? "_AI" : ""}
          </h1>
          <p className="text-[12px] text-[var(--text-secondary)] font-mono mt-1">
            {llmEnabled ? "DGrid AI-powered sentiment analysis" : "Real-time crypto news feed"} from{" "}
            <a href="https://sosovalue.com" target="_blank" rel="noopener noreferrer" className="text-[var(--cyan)] hover:underline">
              sosovalue.com
            </a>
          </p>
        </div>
        <button onClick={fetchNews} disabled={newsLoading} className="btn-terminal text-[11px] py-2 px-4 disabled:opacity-40">
          {newsLoading ? "LOADING..." : "[ REFRESH ]"}
        </button>
      </div>

      {/* Symbol filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSymbol("")}
          className={`text-[11px] px-3 py-1.5 border font-mono transition-colors ${!activeSymbol ? "border-[var(--cyan)] text-[var(--cyan)] bg-[var(--cyan)]/10" : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--cyan)]/30"}`}
        >ALL</button>
        {SYMBOLS.map((sym) => (
          <button
            key={sym}
            onClick={() => setActiveSymbol(sym)}
            className={`text-[11px] px-3 py-1.5 border font-mono transition-colors ${activeSymbol === sym ? "border-[var(--cyan)] text-[var(--cyan)] bg-[var(--cyan)]/10" : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--cyan)]/30"}`}
          >{sym}</button>
        ))}
      </div>

      <div className="terminal-card">
        <div className="p-1">
          {newsLoading && news.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-secondary)] text-[13px] font-mono">Loading news feed...</div>
          ) : newsError ? (
            <div className="text-center py-12 space-y-3">
              <div className="text-[var(--red)] text-[13px] font-mono">[ERR] {newsError}</div>
              <button onClick={fetchNews} className="btn-terminal text-[11px] py-1.5 px-3">[ RETRY ]</button>
            </div>
          ) : news.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-secondary)] text-[13px] font-mono">No articles available</div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {news.map((article, i) => {
                const sBadge = sentimentBadge(article.sentiment);
                const srcBadge = sourceBadge(article.sourceType);
                return (
                  <a
                    key={article.id || i}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block py-4 px-4 border-l-2 ${sentimentBorder(article.sentiment)} bg-white/[0.01] hover:bg-white/[0.04] hover:border-l-[var(--cyan)] transition-all group`}
                  >
                    {/* Title row */}
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-mono text-[var(--text)] group-hover:text-[var(--cyan)] transition-colors leading-snug mb-2">
                          {article.isXPost && (
                            <span className={`inline-flex items-center gap-1 mr-2 text-[10px] px-1.5 py-0.5 border ${srcBadge.border} ${srcBadge.text}`}>
                              🐦 {srcBadge.label}
                            </span>
                          )}
                          {article.title}
                        </div>

                        {/* Content preview for X posts or short titles */}
                        {article.content_preview && article.title.length < 60 && (
                          <div className="text-[11px] text-[var(--text-secondary)] font-mono leading-relaxed mb-2 opacity-80">
                            {article.content_preview}
                          </div>
                        )}

                        {/* Quote info */}
                        {article.quote_info && (
                          <div className="mb-2 p-2 border border-[var(--border)]/50 bg-black/20">
                            <div className="text-[10px] text-[var(--text-dim)] font-mono">
                              📢 Quoting: <span className="text-[var(--cyan)]">{article.quote_info.author || article.quote_info.nick_name || "Unknown"}</span>
                            </div>
                            {article.quote_info.content && (
                              <div className="text-[11px] text-[var(--text-secondary)] font-mono mt-0.5 leading-relaxed">
                                {article.quote_info.content.slice(0, 120)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Sentiment + Source + Meta row */}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {/* Sentiment badge */}
                      <span className={`text-[10px] px-2 py-0.5 border font-mono font-bold ${sBadge.border} ${sBadge.text} ${sBadge.bg}`}>
                        {sBadge.label}
                      </span>

                      {/* Matched currencies */}
                      {article.matched_currencies.slice(0, 3).map((c) => (
                        <span key={c} className="text-[10px] px-1.5 py-0.5 border border-[var(--green)]/30 text-[var(--green)] font-mono">
                          ${c}
                        </span>
                      ))}

                      {/* Tags */}
                      {article.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 border border-[var(--border)] text-[var(--text-dim)] font-mono">
                          {tag}
                        </span>
                      ))}

                      {/* Engagement + source + time */}
                      <div className="flex items-center gap-3 ml-auto">
                        <span className="text-[10px] text-[var(--text-secondary)] font-mono">
                          {article.source}
                          {article.is_blue_verified && <span className="ml-1 text-[var(--cyan)]">✓</span>}
                        </span>
                        {article.impression_count > 0 && (
                          <span className="text-[10px] text-[var(--text-dim)] font-mono">👁 {formatEngagement(article.impression_count)}</span>
                        )}
                        {article.like_count > 0 && (
                          <span className="text-[10px] text-[var(--text-dim)] font-mono">♥ {formatEngagement(article.like_count)}</span>
                        )}
                        <span className="text-[10px] text-[var(--text-dim)] font-mono">{formatTime(article.time)}</span>
                        <span className="text-[var(--text-secondary)] text-[14px] group-hover:text-[var(--cyan)] transition-colors">↗</span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
