"use client";
import { useState, useEffect, useCallback } from "react";

interface NewsArticle {
  title: string;
  source: string;
  url: string;
  time: string | null;
  sentiment: string | null;
}

export default function NewsPage() {
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    setNewsLoading(true);
    setNewsError(null);
    try {
      const res = await fetch("/api/news?type=hot&limit=20");
      const data = await res.json();
      if (data.articles && Array.isArray(data.articles)) {
        setNews(data.articles);
        if (data.articles.length === 0 && data.error) {
          setNewsError(data.error);
        }
      } else {
        setNews([]);
        setNewsError("Invalid response format");
      }
    } catch (err: any) {
      setNewsError(err.message || "Failed to load news");
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 120000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--cyan)] glow-cyan tracking-wider">SOSOVALUE_NEWS</h1>
          <p className="text-[11px] text-[var(--text-secondary)] font-mono mt-1">
            Real-time crypto news feed from{" "}
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
            <div className="space-y-2">
              {news.map((article, i) => (
                <a
                  key={i}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start justify-between py-3 px-3 bg-white/[0.02] border border-[var(--border)] hover:border-[var(--cyan)]/30 transition-colors group gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-mono text-[var(--text)] group-hover:text-[var(--cyan)] transition-colors leading-relaxed">
                      {article.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-[var(--text-secondary)]">{article.source}</span>
                      {article.sentiment && (
                        <span className={`text-[9px] px-1.5 py-0.5 border ${article.sentiment === "positive" ? "border-[var(--green)]/30 text-[var(--green)]" : article.sentiment === "negative" ? "border-[var(--red)]/30 text-[var(--red)]" : "border-[var(--text-dim)] text-[var(--text-secondary)]"}`}>
                          {article.sentiment.toUpperCase()}
                        </span>
                      )}
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
