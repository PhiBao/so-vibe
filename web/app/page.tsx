"use client";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useToast } from "@/components/ToastProvider";

const SYMBOLS = ["SOL-USD", "ETH-USD", "BTC-USD"];

function StatBlock({ label, value, sub, color = "cyan" }: { label: string; value: string; sub?: string; color?: "cyan" | "green" | "red" | "magenta" | "yellow" }) {
  const colorMap = { cyan: "text-[var(--cyan)]", green: "text-[var(--green)]", red: "text-[var(--red)]", magenta: "text-[var(--magenta)]", yellow: "text-[var(--yellow)]" };
  return (
    <div className="terminal-card p-4 animate-in">
      <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-[0.15em] mb-2">{label}</div>
      <div className={`text-xl font-bold font-mono ${colorMap[color]}`}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">{sub}</div>}
    </div>
  );
}

function MarketRow({ sym, data }: { sym: string; data: Record<string, unknown> }) {
  const price = (data.price as number) || 0;
  const change = parseFloat(data.change24h as string || "0");
  const rsi = parseFloat(data.rsi as string || "50");
  const trend = data.trend as string || "unknown";
  const trendColor = trend === "bullish" ? "text-[var(--green)]" : trend === "bearish" ? "text-[var(--red)]" : "text-[var(--text-tertiary)]";
  const trendLabel = trend === "bullish" ? "LONG_BIAS" : trend === "bearish" ? "SHORT_BIAS" : "NEUTRAL";
  const changeColor = change >= 0 ? "text-[var(--green)]" : "text-[var(--red)]";
  return (
    <div className="flex items-center justify-between py-3 border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02] px-2 transition-colors">
      <div className="flex items-center gap-3 w-32"><span className="text-[var(--cyan)] text-sm font-bold">{sym}</span><span className="text-[10px] text-[var(--text-dim)]">-PERP</span></div>
      <div className="w-32 text-right"><span className="text-[13px] font-mono font-semibold">${price.toFixed(2)}</span></div>
      <div className={`w-24 text-right text-[11px] font-mono ${changeColor}`}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</div>
      <div className="w-20 text-right"><span className={`text-[11px] font-mono ${trendColor}`}>{trendLabel}</span></div>
      <div className="w-16 text-right text-[11px] text-[var(--text-tertiary)] font-mono">RSI {rsi.toFixed(1)}</div>
      <a href={`/trade?symbol=${sym}`} className="btn-terminal text-[10px] py-1 px-3 ml-4">EXECUTE</a>
    </div>
  );
}

interface NewsArticle {
  title: string;
  source: string;
  url: string;
  time: string | null;
  sentiment: string | null;
}

export default function Dashboard() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [markets, setMarkets] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [botStatus, setBotStatus] = useState({ running: false, cycle: 0 });
  const [walletData, setWalletData] = useState<Record<string, unknown> | null>(null);
  const [pendingSignals, setPendingSignals] = useState<number>(0);
  const [botSignalList, setBotSignalList] = useState<any[]>([]);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const { addToast } = useToast();

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [statusRes, botRes, signalRes] = await Promise.all([
          fetch("/api/status"),
          fetch("/api/bot/status").catch(() => null),
          fetch("/api/bot/signals").catch(() => null),
        ]);
        const statusData = await statusRes.json();
        setStatus(statusData);
        if (botRes) { const botData = await botRes.json(); setBotStatus(botData); }
        if (signalRes) {
          const sigData = await signalRes.json();
          setPendingSignals(sigData.count || 0);
          setBotSignalList(sigData.signals || []);
        }

        const marketData: Record<string, Record<string, unknown>> = {};
        for (const sym of SYMBOLS) {
          try { const res = await fetch(`/api/market?symbol=${sym}`); marketData[sym] = await res.json(); } catch {}
        }
        setMarkets(marketData);
      } catch {}
      setLoading(false);
    };
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isConnected || !address) { setWalletData(null); return; }
    const fetchWallet = async () => {
      try { const res = await fetch(`/api/wallet/balance?address=${address}`); const data = await res.json(); setWalletData(data); } catch {}
    };
    fetchWallet();
    const interval = setInterval(fetchWallet, 15000);
    return () => clearInterval(interval);
  }, [isConnected, address]);

  // Fetch SoSoValue news
  const fetchNews = useCallback(async () => {
    setNewsLoading(true);
    setNewsError(null);
    try {
      const res = await fetch("/api/news?type=hot&limit=5");
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

  // Show skeleton stats while loading
  const isLoadingMarkets = Object.keys(markets).length === 0;

  const portfolio = (status as { portfolio?: Record<string, unknown> })?.portfolio || {};
  const stats = (status as { stats?: Record<string, unknown> })?.stats || {};
  const positions = (status as { positions?: Array<Record<string, unknown>> })?.positions || [];
  const walletPositions = (walletData?.positions as Array<Record<string, unknown>>) || [];
  const walletUsdc = (walletData?.usdc as number) || 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--cyan)] glow-cyan tracking-wider">DASHBOARD</h1>
          <p className="text-[11px] text-[var(--text-dim)] font-mono mt-1">Agentic swarm trading on SoDEX perpetuals</p>
        </div>
        <div className="flex items-center gap-3">
          {pendingSignals > 0 && (
            <a href="/bots" className="flex items-center gap-2 px-3 py-1.5 terminal-card text-[10px] border border-[var(--yellow)]/30">
              <span className="status-dot warn" />
              <span className="text-[var(--yellow)]">{pendingSignals} SIGNAL{pendingSignals > 1 ? "S" : ""} PENDING</span>
            </a>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 terminal-card text-[10px]">
            <span className={`status-dot ${botStatus.running ? "online" : "offline"}`} />
            <span className={botStatus.running ? "text-[var(--green)]" : "text-[var(--red)]"}>BOT {botStatus.running ? "ACTIVE" : "STANDBY"}</span>
            {botStatus.running && <span className="text-[var(--text-dim)]">cycle #{botStatus.cycle}</span>}
          </div>
        </div>
      </div>

      {isConnected && walletData ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBlock label="Portfolio (SoDEX)" value={`$${walletUsdc.toFixed(2)}`} sub={`${walletPositions.length} open positions`} color="cyan" />
            <StatBlock label="Unrealized PnL" value={`$${walletPositions.reduce((s: number, p: Record<string, unknown>) => s + ((p.unrealizedPnl as number) || 0), 0).toFixed(2)}`} color={walletPositions.reduce((s: number, p: Record<string, unknown>) => s + ((p.unrealizedPnl as number) || 0), 0) >= 0 ? "green" : "red"} />
            <StatBlock label="Win Rate" value={`${stats.winRate as string || "0"}%`} sub={`${stats.totalTrades as number || 0} trades`} color="green" />
            <StatBlock label="Drawdown" value={`${portfolio.drawdown as string || "0"}%`} sub={`PF: ${stats.profitFactor as string || "0"}`} color="yellow" />
          </div>

          <div className="terminal-card border-l-2 border-l-[var(--cyan)]">
            <div className="terminal-header">
              <span className="text-[11px] font-bold tracking-wider">WALLET_OVERVIEW</span>
              <span className="text-[10px] text-[var(--text-dim)] ml-auto">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
            </div>
            <div className="p-4 space-y-4">
              {/* SoDEX Account ID */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.15em]">SoDEX Account ID</label>
                <span className="text-[11px] font-mono text-[var(--cyan)]">
                  {walletData?.accountID ? (walletData.accountID as number) : "resolving..."}
                </span>
                {walletData?.accountID ? (
                  <span className="text-[9px] text-[var(--green)]">Auto-resolved</span>
                ) : (
                  <span className="text-[9px] text-[var(--yellow)]">Fund your account to trade</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[9px] text-[var(--green)]">API key active — ready to trade</span>
              </div>

              {walletPositions.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-2">On-Chain Positions</div>
                  {walletPositions.map((pos, i) => (
                    <div key={i} className="flex items-center justify-between py-2 px-3 bg-white/[0.02] border border-[var(--border)]">
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 border ${(pos.side as string)?.toLowerCase() === "long" ? "border-[var(--green)] text-[var(--green)]" : "border-[var(--red)] text-[var(--red)]"}`}>{(pos.side as string || "?").toUpperCase()}</span>
                        <span className="text-[12px] font-mono font-semibold text-[var(--cyan)]">{pos.symbol as string}</span>
                      </div>
                      <div className="text-[11px] font-mono text-[var(--text-secondary)]">Size: {(pos.size as number || 0).toFixed(4)}</div>
                      <div className={`text-[11px] font-mono font-bold ${(pos.unrealizedPnl as number || 0) >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{(pos.unrealizedPnl as number || 0) >= 0 ? "+" : ""}${(pos.unrealizedPnl as number || 0).toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-[var(--text-dim)] text-[12px] font-mono">No open positions on SoDEX</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="terminal-card p-6 text-center border border-[var(--yellow)]/20">
          <div className="text-[var(--yellow)] text-sm mb-2 font-mono">⚠ WALLET NOT CONNECTED</div>
          <div className="text-[12px] text-[var(--text-dim)] font-mono">Connect your EVM wallet to see real portfolio data from SoDEX</div>
        </div>
      )}

      <div className="terminal-card">
        <div className="terminal-header"><span className="text-[11px] font-bold tracking-wider">MARKET_DATA</span><span className="text-[10px] text-[var(--text-dim)] ml-auto">sodex.dev/api/v1</span></div>
        <div className="p-4">
          <div className="flex items-center justify-between text-[10px] text-[var(--text-dim)] uppercase tracking-wider px-2 pb-2 border-b border-[var(--border)] mb-2">
            <span className="w-32">Asset</span><span className="w-32 text-right">Price</span><span className="w-24 text-right">24h</span><span className="w-20 text-right">Signal</span><span className="w-16 text-right">RSI</span><span className="ml-4 w-20" />
          </div>
          {SYMBOLS.map((sym) => (<MarketRow key={sym} sym={sym} data={markets[sym] || {}} />))}
        </div>
      </div>

      {/* SoSoValue News Feed */}
      <div className="terminal-card">
        <div className="terminal-header">
          <span className="text-[11px] font-bold tracking-wider">SOSOVALUE_NEWS</span>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] text-[var(--text-dim)]">{news.length} articles</span>
            <button
              onClick={fetchNews}
              disabled={newsLoading}
              className="text-[9px] text-[var(--cyan)] hover:text-[var(--cyan-dim)] disabled:opacity-40"
            >
              {newsLoading ? "LOADING..." : "[ REFRESH ]"}
            </button>
          </div>
        </div>
        <div className="p-4">
          {newsLoading && news.length === 0 ? (
            <div className="text-center py-4 text-[var(--text-dim)] text-[11px] font-mono">Loading news feed...</div>
          ) : newsError ? (
            <div className="text-center py-4 space-y-2">
              <div className="text-[var(--red)] text-[11px] font-mono">[ERR] {newsError}</div>
              <button onClick={fetchNews} className="btn-terminal text-[10px] py-1 px-2">[ RETRY ]</button>
            </div>
          ) : news.length === 0 ? (
            <div className="text-center py-4 text-[var(--text-dim)] text-[11px] font-mono">No articles available</div>
          ) : (
            <div className="space-y-2">
              {news.map((article, i) => (
                <a
                  key={i}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between py-2 px-3 bg-white/[0.02] border border-[var(--border)] hover:border-[var(--cyan)]/30 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-mono text-[var(--text)] truncate group-hover:text-[var(--cyan)] transition-colors">{article.title}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-[var(--text-dim)]">{article.source}</span>
                      {article.sentiment && (
                        <span className={`text-[9px] px-1.5 py-0.5 border ${article.sentiment === "positive" ? "border-[var(--green)]/30 text-[var(--green)]" : article.sentiment === "negative" ? "border-[var(--red)]/30 text-[var(--red)]" : "border-[var(--text-dim)] text-[var(--text-dim)]"}`}>
                          {article.sentiment.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--text-dim)] ml-3 shrink-0">↗</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pending Bot Signals */}
      {isConnected && pendingSignals > 0 && (
        <div className="terminal-card border-l-2 border-l-[var(--yellow)]">
          <div className="terminal-header">
            <span className="text-[11px] font-bold tracking-wider text-[var(--yellow)]">PENDING_SIGNALS</span>
            <span className="text-[10px] text-[var(--text-dim)] ml-auto">{pendingSignals} queued</span>
          </div>
          <div className="p-4 space-y-3">
            {botSignalList.map((sig: any, i: number) => {
              const stratDetails = (sig.details || []).filter((d: any) => d.name !== "sosovalue_sentiment");
              const sentimentDetail = (sig.details || []).find((d: any) => d.name === "sosovalue_sentiment");
              return (
                <div key={i} className="p-3 bg-white/[0.02] border border-[var(--border)] space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 border ${sig.side === "long" ? "border-[var(--green)] text-[var(--green)]" : "border-[var(--red)] text-[var(--red)]"}`}>{(sig.side || "?").toUpperCase()}</span>
                      <span className="text-[13px] font-mono font-bold text-[var(--cyan)]">{sig.symbol}</span>
                      <span className="text-[10px] text-[var(--text-dim)] font-mono">@{sig.entryPrice?.toFixed(2)}</span>
                      {sentimentDetail && (
                        <span className={`text-[9px] px-1.5 py-0.5 border ${sentimentDetail.signal === "bullish" ? "border-[var(--green)]/30 text-[var(--green)]" : sentimentDetail.signal === "bearish" ? "border-[var(--red)]/30 text-[var(--red)]" : "border-[var(--text-dim)] text-[var(--text-dim)]"}`}>
                          SoSoValue: {sentimentDetail.signal}
                        </span>
                      )}
                    </div>
                    <a href="/bots" className="btn-terminal text-[10px] py-1 px-2">EXECUTE</a>
                  </div>
                  {stratDetails.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {stratDetails.map((d: any, j: number) => (
                        <span key={j} className="text-[9px] font-mono px-1.5 py-0.5 bg-black/30 border border-[var(--border)] text-[var(--text-secondary)]">
                          {d.name}: <span className={parseFloat(d.signal) > 0 ? "text-[var(--green)]" : parseFloat(d.signal) < 0 ? "text-[var(--red)]" : "text-[var(--text-dim)]"}>{parseFloat(d.signal) > 0 ? "▲" : parseFloat(d.signal) < 0 ? "▼" : "◆"}</span> {(parseFloat(d.confidence) * 100).toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-[10px] font-mono text-[var(--text-secondary)]">
                    <span className="text-[var(--cyan)]">{(sig.confidence * 100).toFixed(0)}% confidence</span>
                    <span className="text-[var(--text-dim)]">|</span>
                    <span className="text-[var(--red)]">SL: {sig.stopLoss?.toFixed(2)}</span>
                    <span className="text-[var(--text-dim)]">|</span>
                    <span className="text-[var(--green)]">TP: {sig.takeProfit?.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {positions.length > 0 && (
        <div className="terminal-card">
          <div className="terminal-header"><span className="text-[11px] font-bold tracking-wider">BOT_POSITIONS</span><span className="text-[10px] text-[var(--text-dim)] ml-auto">{positions.length} active</span></div>
          <div className="p-4 space-y-2">
            {positions.map((pos, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 bg-white/[0.02] border border-[var(--border)]">
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 border ${(pos.side as string) === "long" ? "border-[var(--green)] text-[var(--green)]" : "border-[var(--red)] text-[var(--red)]"}`}>{(pos.side as string).toUpperCase()}</span>
                  <span className="text-[12px] font-mono font-semibold">{pos.symbol as string}</span>
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] font-mono">Entry: ${(pos.entryPrice as number || 0).toFixed(2)} · {(pos.leverage as number || 1)}x</div>
                <div className="text-[11px] text-[var(--text-dim)] font-mono">SL: <span className="text-[var(--red)]">${(pos.stopLoss as number || 0).toFixed(2)}</span><span className="mx-2 text-[var(--text-dim)]">|</span>TP: <span className="text-[var(--green)]">${(pos.takeProfit as number || 0).toFixed(2)}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
