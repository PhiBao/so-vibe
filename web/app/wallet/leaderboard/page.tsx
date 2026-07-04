"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useToast } from "@/components/ToastProvider";

type SortKey = "sharpe" | "totalReturn" | "winRate" | "profitFactor" | "totalTrades";

interface LeaderboardWallet {
  address: string;
  label?: string;
  source?: "curated" | "discovered";
  equity: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalReturn: number;
  sharpe: number;
  maxDrawdown: number;
  avgHoldMinutes: number;
  lastActive: number | null;
  strategyType: string;
  strategyConfidence: number;
  currentPositions: Array<{ symbol: string; side: string; size: number; entryPrice: number }>;
}

const SORT_LABELS: Record<SortKey, string> = {
  sharpe: "Sharpe",
  totalReturn: "Total Return",
  winRate: "Win Rate",
  profitFactor: "Profit Factor",
  totalTrades: "Trade Count",
};

function formatTime(ts: number | null) {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function LeaderboardPage() {
  const { addToast } = useToast();
  const [wallets, setWallets] = useState<LeaderboardWallet[]>([]);
  const [sort, setSort] = useState<SortKey>("sharpe");
  const [minTrades, setMinTrades] = useState(5);
  const [loading, setLoading] = useState(false);

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/wallet/leaderboard?sort=${sort}&minTrades=${minTrades}`);
      const data = await res.json();
      if (data.error) {
        addToast(data.error, "error");
        setWallets([]);
      } else {
        setWallets(data.wallets || []);
      }
    } catch (err: any) {
      addToast(err.message || "Failed to load leaderboard", "error");
      setWallets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, [sort, minTrades]);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--cyan)] glow-cyan tracking-wider">COPY_LEADERBOARD</h1>
          <p className="text-[12px] text-[var(--text-secondary)] font-mono mt-1">
            Auto-discovered wallets ranked by on-chain performance. Analyze any wallet to add it here.
          </p>
        </div>
        <Link href="/wallet" className="btn-terminal text-[11px] py-1.5 px-3">
          [ WALLET ANALYZER ]
        </Link>
      </div>

      <div className="terminal-card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wider">Sort By</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="terminal-input text-[12px] py-1.5 font-mono bg-black"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>{SORT_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wider">Min Trades</label>
            <input
              type="number"
              min={0}
              value={minTrades}
              onChange={(e) => setMinTrades(Number(e.target.value))}
              className="terminal-input w-20 text-[12px] py-1.5 font-mono"
            />
          </div>
          <button
            onClick={fetchLeaderboard}
            disabled={loading}
            className="btn-terminal btn-terminal-green text-[11px] py-1.5 px-4 font-bold ml-auto"
          >
            {loading ? "SCANNING..." : "[ REFRESH ]"}
          </button>
        </div>
      </div>

      {wallets.length === 0 && !loading && (
        <div className="terminal-card text-center py-12">
          <div className="text-[var(--text-secondary)] font-mono text-[13px]">
            No wallets discovered yet.
          </div>
          <div className="text-[11px] text-[var(--text-dim)] font-mono mt-1">
            Analyze any wallet in <span className="text-[var(--cyan)]">/wallet</span> and it will appear here automatically.
            <br />
            <span className="text-[var(--yellow)]">SoDEX native leaderboard API — coming soon.</span>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {wallets.map((w, idx) => (
          <div key={w.address} className="terminal-card p-4 hover:border-[var(--cyan)]/30 transition-colors">
            <div className="flex items-center gap-4 mb-3">
              <div className="text-[18px] font-mono font-bold text-[var(--cyan)] w-8">#{idx + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-mono text-[var(--text)] font-bold">
                    {w.label || `${w.address.slice(0, 8)}...${w.address.slice(-6)}`}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--text-dim)]">{w.address}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] px-2 py-0.5 border border-[var(--green)]/30 text-[var(--green)] font-mono">
                    {w.strategyType.toUpperCase().replace(/_/g, " ")}
                  </span>
                  {w.source === "discovered" && (
                    <span className="text-[9px] px-1.5 py-0.5 border border-[var(--magenta)]/30 text-[var(--magenta)] font-mono">
                      DISCOVERED
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--text-secondary)] font-mono">
                    {w.strategyConfidence > 0 ? `${Math.round(w.strategyConfidence * 100)}% match` : "unclassified"}
                  </span>
                </div>
              </div>
              <Link
                href={`/wallet?address=${w.address}`}
                className="btn-terminal btn-terminal-green text-[11px] py-1.5 px-3 font-bold"
              >
                [ ANALYZE & COPY ]
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center text-[11px] font-mono">
              <div className="p-2 bg-white/[0.02] border border-[var(--border)]">
                <div className="text-[9px] text-[var(--text-secondary)] uppercase">Equity</div>
                <div className="text-[var(--cyan)] font-bold">${w.equity.toFixed(2)}</div>
              </div>
              <div className="p-2 bg-white/[0.02] border border-[var(--border)]">
                <div className="text-[9px] text-[var(--text-secondary)] uppercase">Total Return</div>
                <div className={`font-bold ${w.totalReturn >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>${w.totalReturn.toFixed(2)}</div>
              </div>
              <div className="p-2 bg-white/[0.02] border border-[var(--border)]">
                <div className="text-[9px] text-[var(--text-secondary)] uppercase">Win Rate</div>
                <div className={`font-bold ${w.winRate >= 50 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{w.winRate}%</div>
              </div>
              <div className="p-2 bg-white/[0.02] border border-[var(--border)]">
                <div className="text-[9px] text-[var(--text-secondary)] uppercase">Sharpe</div>
                <div className="text-[var(--text)] font-bold">{w.sharpe}</div>
              </div>
              <div className="p-2 bg-white/[0.02] border border-[var(--border)]">
                <div className="text-[9px] text-[var(--text-secondary)] uppercase">Profit Factor</div>
                <div className="text-[var(--text)] font-bold">{w.profitFactor}</div>
              </div>
              <div className="p-2 bg-white/[0.02] border border-[var(--border)]">
                <div className="text-[9px] text-[var(--text-secondary)] uppercase">Trades</div>
                <div className="text-[var(--text)] font-bold">{w.totalTrades}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 mt-3 text-[10px] text-[var(--text-secondary)] font-mono">
              <span>Max DD: <span className="text-[var(--red)]">{w.maxDrawdown}%</span></span>
              <span>Avg Hold: {w.avgHoldMinutes}m</span>
              <span>Last Active: {formatTime(w.lastActive)}</span>
              <span>Open Positions: {w.currentPositions.length}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
