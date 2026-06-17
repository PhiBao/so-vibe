"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";

interface PnLSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  sharpe: number;
  maxDrawdown: number;
  avgWin: number;
  avgLoss: number;
}

interface PnLData {
  summary: PnLSummary;
  recentTrades: Array<{
    symbol: string;
    side: string;
    netPnl: number;
    exitTime: number;
  }>;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <div className="h-10 text-[10px] text-[var(--text-secondary)] font-mono flex items-center">No equity data</div>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 40;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10 overflow-visible" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}

export default function PnLWidget() {
  const { address, isConnected } = useAccount();
  const [data, setData] = useState<PnLData | null>(null);
  const [lastRecorded, setLastRecorded] = useState(0);

  const syncFills = async () => {
    if (!isConnected || !address) return;
    try {
      await fetch("/api/bot/record-fills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      setLastRecorded(Date.now());
    } catch {}
  };

  const fetchPnL = async () => {
    try {
      const res = await fetch("/api/bot/pnl");
      const json = await res.json();
      setData(json);
    } catch {}
  };

  useEffect(() => {
    fetchPnL();
    const interval = setInterval(fetchPnL, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    syncFills();
    const interval = setInterval(syncFills, 30000);
    return () => clearInterval(interval);
  }, [isConnected, address]);

  if (!data || !data.summary) return null;

  const s = data.summary;
  const equity = data.recentTrades
    .slice()
    .reverse()
    .reduce<number[]>((acc, t) => {
      const prev = acc[acc.length - 1] || 0;
      acc.push(prev + t.netPnl);
      return acc;
    }, []);

  return (
    <div className="terminal-card">
      <div className="terminal-header">
        <span className="text-[12px] font-bold tracking-wider">LIVE_PnL</span>
        <span className="text-[10px] text-[var(--text-secondary)] ml-auto">
          {isConnected ? "syncing on-chain fills" : "connect wallet to sync fills"}
        </span>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Net PnL</div>
            <div className={`text-[15px] font-mono font-bold ${s.netPnl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>${s.netPnl.toFixed(2)}</div>
          </div>
          <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Win Rate</div>
            <div className="text-[15px] font-mono font-bold text-[var(--cyan)]">{(s.winRate * 100).toFixed(1)}%</div>
          </div>
          <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Sharpe</div>
            <div className="text-[15px] font-mono font-bold text-[var(--text)]">{s.sharpe}</div>
          </div>
          <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Max DD</div>
            <div className="text-[15px] font-mono font-bold text-[var(--red)]">{s.maxDrawdown}%</div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Equity Curve</span>
            <span className="text-[10px] text-[var(--text-secondary)] font-mono">{s.totalTrades} closed trades</span>
          </div>
          <Sparkline data={equity} color={s.netPnl >= 0 ? "var(--green)" : "var(--red)"} />
        </div>

        {data.recentTrades && data.recentTrades.length > 0 && (
          <div>
            <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider mb-2">Recent Closed Trades</div>
            <div className="space-y-1">
              {data.recentTrades.slice(0, 5).map((t, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] font-mono py-1 px-2 bg-white/[0.02] border border-[var(--border)]">
                  <span className="text-[var(--cyan)]">{t.symbol}</span>
                  <span className="text-[var(--text-secondary)]">{t.side.toUpperCase()}</span>
                  <span className={`font-bold ${t.netPnl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>${t.netPnl.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
