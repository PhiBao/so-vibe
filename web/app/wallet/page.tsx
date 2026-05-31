"use client";
import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useSodexTx } from "@/lib/use-sodex-tx";
import { useToast } from "@/components/ToastProvider";

interface WalletProfile {
  address: string;
  accountID?: number;
  equity: number;
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalReturn: number;
  bestTrade: number;
  worstTrade: number;
  maxDrawdown: number;
  sharpe: number;
  avgHoldMinutes: number;
  lastActive: number | null;
  currentPositions: Array<{ symbol: string; side: string; size: number; entryPrice: number }>;
  strategyType: string;
  strategyConfidence: number;
  fundings: { totalEarned: number; totalPaid: number };
  recentTrades: Array<{ time: number; symbol: string; side: string; pnl: number }>;
  error?: string;
}

export default function WalletPage() {
  const { address: myAddress, isConnected } = useAccount();
  const { sendInstructions } = useSodexTx();
  const { addToast } = useToast();

  const [searchAddress, setSearchAddress] = useState("");
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allocation, setAllocation] = useState<number>(100);
  const [copyLoading, setCopyLoading] = useState(false);

  const fetchProfile = useCallback(async (addr: string) => {
    setLoading(true);
    setError(null);
    setProfile(null);
    try {
      const res = await fetch(`/api/wallet/profile?address=${addr}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setProfile(data);
      setSearchAddress(addr);
    } catch (err: any) {
      setError(err.message || "Failed to fetch profile");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLookup = () => {
    const addr = searchAddress.trim();
    if (!addr || addr.length < 10) { setError("Enter a valid address"); return; }
    fetchProfile(addr);
  };

  const handleCopyTrades = async () => {
    if (!isConnected || !myAddress || !profile) return;
    setCopyLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAddress: profile.address,
          wallet: myAddress,
          allocation,
        }),
      });
      const data = await res.json();
      if (!data.success || !data.actions) {
        setError(data.error || "Copy failed");
        addToast(data.error || "Copy failed", "error");
        return;
      }

      addToast(`Copying ${data.ordersCount} positions from wallet...`, "info");

      for (let i = 0; i < data.actions.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 200));
        const result = await sendInstructions(data.actions[i]);
        if (!result.success) {
          addToast(`Order ${i + 1} failed: ${result.error}`, "error");
        } else {
          const pos = data.positions[i];
          addToast(`Copied ${pos.side} ${pos.symbol} (${pos.copySize.toFixed(4)})`, "success");
        }
      }
    } catch (err: any) {
      setError(err.message || "Copy execution failed");
      addToast(err.message || "Copy execution failed", "error");
    }
    setCopyLoading(false);
  };

  const formatTime = (ts: number | null) => {
    if (!ts) return "Never";
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const strategyColor = (type: string) => {
    const colors: Record<string, string> = { scalper: "var(--yellow)", day_trader: "var(--cyan)", swing_trader: "var(--green)", momentum: "var(--magenta)", carry_trader: "var(--cyan)", mixed: "var(--text-secondary)" };
    return colors[type] || "var(--text-secondary)";
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in">
      <div>
        <h1 className="text-xl font-bold text-[var(--cyan)] glow-cyan tracking-wider">WALLET_ANALYZER</h1>
        <p className="text-[12px] text-[var(--text-secondary)] font-mono mt-1">Analyze any SoDEX wallet &amp; copy trades with one click</p>
      </div>

      {/* Search bar */}
      <div className="terminal-card p-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
            placeholder="0x... wallet address"
            className="terminal-input flex-1 text-[13px] py-2 font-mono"
          />
          <button onClick={handleLookup} disabled={loading} className="btn-terminal btn-terminal-green text-[12px] py-2 px-6 font-bold">
            {loading ? "LOADING..." : "[ ANALYZE ]"}
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={() => setSearchAddress("0x0123456789070ce8f0d6bab722103d12674bc257")} className="text-[9px] text-[var(--text-secondary)] hover:text-[var(--cyan)] font-mono">Demo wallet 1</button>
          <span className="text-[var(--text-dim)]">|</span>
          {isConnected && myAddress && (
            <button onClick={() => { setSearchAddress(myAddress); fetchProfile(myAddress); }} className="text-[9px] text-[var(--text-secondary)] hover:text-[var(--cyan)] font-mono">Use my wallet</button>
          )}
        </div>
      </div>

      {error && (
        <div className="terminal-card p-4 border border-[var(--red)]/30 text-[var(--red)] font-mono text-[12px]">
          [ERR] {error}
        </div>
      )}

      {/* Profile */}
      {profile && !profile.error && (
        <div className="space-y-4 animate-in">
          {/* Strategy badge + stats */}
          <div className="terminal-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wider">Wallet</div>
                <div className="text-[13px] font-mono text-[var(--cyan)] mt-1">{profile.address.slice(0, 10)}...{profile.address.slice(-8)}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wider">Equity</div>
                <div className="text-[20px] font-mono font-bold text-[var(--cyan)]">${profile.equity.toFixed(2)}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <span className="text-[12px] px-3 py-1 border font-bold" style={{ borderColor: strategyColor(profile.strategyType), color: strategyColor(profile.strategyType) }}>
                {profile.strategyType.toUpperCase().replace(/_/g, " ")}
              </span>
              <span className="text-[11px] text-[var(--text-secondary)] font-mono">
                High confidence match ({Math.round(profile.strategyConfidence * 100)}%)
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="p-3 bg-white/[0.02] border border-[var(--border)] text-center">
                <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Win Rate</div>
                <div className={`text-lg font-mono font-bold ${profile.winRate >= 50 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{profile.winRate}%</div>
              </div>
              <div className="p-3 bg-white/[0.02] border border-[var(--border)] text-center">
                <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Profit Factor</div>
                <div className={`text-lg font-mono font-bold ${profile.profitFactor >= 1.5 ? "text-[var(--green)]" : "text-[var(--text-secondary)]"}`}>{profile.profitFactor}</div>
              </div>
              <div className="p-3 bg-white/[0.02] border border-[var(--border)] text-center">
                <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Sharpe</div>
                <div className={`text-lg font-mono font-bold ${profile.sharpe >= 1 ? "text-[var(--green)]" : "text-[var(--text)]"}`}>{profile.sharpe}</div>
              </div>
              <div className="p-3 bg-white/[0.02] border border-[var(--border)] text-center">
                <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Max DD</div>
                <div className="text-lg font-mono font-bold text-[var(--red)]">{profile.maxDrawdown}%</div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center text-[10px] font-mono">
              <div><span className="text-[var(--text-secondary)]">Total Return:</span> <span className={profile.totalReturn >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}>${profile.totalReturn}</span></div>
              <div><span className="text-[var(--text-secondary)]">Trades:</span> <span className="text-[var(--text)]">{profile.totalTrades}</span></div>
              <div><span className="text-[var(--text-secondary)]">Avg Win:</span> <span className="text-[var(--green)]">${profile.avgWin}</span></div>
              <div><span className="text-[var(--text-secondary)]">Avg Loss:</span> <span className="text-[var(--red)]">${profile.avgLoss}</span></div>
              <div><span className="text-[var(--text-secondary)]">Best:</span> <span className="text-[var(--green)]">${profile.bestTrade}</span></div>
              <div><span className="text-[var(--text-secondary)]">Worst:</span> <span className="text-[var(--red)]">${profile.worstTrade}</span></div>
              <div><span className="text-[var(--text-secondary)]">Avg Hold:</span> <span className="text-[var(--text)]">{profile.avgHoldMinutes}m</span></div>
              <div><span className="text-[var(--text-secondary)]">Last Active:</span> <span className="text-[var(--text)]">{formatTime(profile.lastActive)}</span></div>
              <div><span className="text-[var(--text-secondary)]">Funding Earned:</span> <span className="text-[var(--green)]">${profile.fundings.totalEarned}</span></div>
              <div><span className="text-[var(--text-secondary)]">Funding Paid:</span> <span className="text-[var(--red)]">${profile.fundings.totalPaid}</span></div>
              <div><span className="text-[var(--text-secondary)]">Equity:</span> <span className="text-[var(--cyan)]">${profile.equity.toFixed(2)}</span></div>
              <div><span className="text-[var(--text-secondary)]">Positions:</span> <span className="text-[var(--text)]">{profile.currentPositions.length}</span></div>
            </div>
          </div>

          {/* Current positions */}
          {profile.currentPositions.length > 0 && (
            <div className="terminal-card">
              <div className="terminal-header">
                <span className="text-[12px] font-bold tracking-wider">CURRENT_POSITIONS</span>
                <span className="text-[11px] text-[var(--text-secondary)] ml-auto">{profile.currentPositions.length} open</span>
              </div>
              <div className="p-4 space-y-2">
                {profile.currentPositions.map((pos, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 bg-white/[0.02] border border-[var(--border)]">
                    <div className="flex items-center gap-3">
                      <span className={`text-[11px] font-bold px-2 py-0.5 border ${pos.side === "long" ? "border-[var(--green)] text-[var(--green)]" : "border-[var(--red)] text-[var(--red)]"}`}>
                        {pos.side.toUpperCase()}
                      </span>
                      <span className="text-[13px] font-mono text-[var(--cyan)] font-bold">{pos.symbol}</span>
                    </div>
                    <div className="text-[11px] font-mono text-[var(--text-secondary)]">
                      {pos.size.toFixed(4)} @ ${pos.entryPrice.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Copy-trade controls */}
          {isConnected && myAddress && (
            <div className="terminal-card border-l-2 border-l-[var(--green)]">
              <div className="terminal-header">
                <span className="text-[12px] font-bold tracking-wider">COPY_THIS_WALLET</span>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-[11px] text-[var(--text-secondary)] font-mono">
                  Mirror this wallet's {profile.currentPositions.length} positions with proportional sizing.
                </div>
                <div className="flex items-center gap-4">
                  <label className="text-[11px] text-[var(--text-secondary)]">Allocation (USDC):</label>
                  <input
                    type="number"
                    value={allocation}
                    onChange={(e) => setAllocation(Number(e.target.value))}
                    className="terminal-input w-28 text-[13px] py-1.5 font-mono"
                    min={10}
                    step={10}
                  />
                  <span className="text-[10px] text-[var(--text-secondary)]">min $10</span>
                </div>
                <button
                  onClick={handleCopyTrades}
                  disabled={copyLoading || profile.currentPositions.length === 0}
                  className="btn-terminal btn-terminal-green text-[12px] py-2 px-6 font-bold disabled:opacity-40"
                >
                  {copyLoading ? "SIGNING..." : `[ COPY ${profile.currentPositions.length} POSITIONS ]`}
                </button>
              </div>
            </div>
          )}

          {!isConnected && profile.currentPositions.length > 0 && (
            <div className="terminal-card p-4 text-center border border-[var(--yellow)]/20">
              <div className="text-[12px] text-[var(--yellow)] font-mono">⚠ Connect your wallet to copy these trades</div>
            </div>
          )}
        </div>
      )}

      {!profile && !loading && !error && (
        <div className="terminal-card text-center py-12">
          <div className="text-[var(--cyan)] text-3xl mb-2 font-mono">&gt;_</div>
          <div className="text-[14px] text-[var(--text-secondary)] font-mono">Enter a SoDEX wallet address to analyze</div>
          <div className="text-[11px] text-[var(--text-secondary)] font-mono mt-1">Trades · Win rate · Sharpe · Strategy classification · Copy-trading</div>
        </div>
      )}
    </div>
  );
}
