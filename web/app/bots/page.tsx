"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useSodexTx } from "@/lib/use-sodex-tx";
import { useToast } from "@/components/ToastProvider";
import { getNetworkConfig } from "@/lib/config";
import { isBotConfigured, signBotAction, submitSignedAction } from "@/lib/bot-signer-client";
import Tooltip from "@/components/Tooltip";

interface TradeSignal {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  size: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  longVotes: number;
  shortVotes: number;
  reasoning?: string | null;
  riskFactors?: string[];
  etfFlow?: { signal: number; trend: string; latestInflow: number } | null;
  macroAlert?: string | null;
  vibeScore?: { vibe: number; confidence: number; fullConsensus: boolean };
  details?: Array<{ name: string; signal: string; confidence: string; meta?: any }>;
  queuedAt: number;
}

interface StrategyConfig {
  enabled: boolean;
  weight: number;
}

interface BotConfig {
  minConfidence: number;
  maxMarginPct: number;
  symbols: string[];
  interval: number;
  strategyConfig: Record<string, StrategyConfig>;
}

const ALL_STRATEGIES = [
  { key: "trend_following", label: "TrendFollow", signal: "EMA cross + RSI filter", best: "Trending markets", defWeight: 0.15 },
  { key: "mean_reversion", label: "MeanReversion", signal: "Bollinger + RSI extremes", best: "Range-bound", defWeight: 0.15 },
  { key: "momentum", label: "Momentum", signal: "MACD hist + volume", best: "Breakouts", defWeight: 0.15 },
  { key: "sr_bounce", label: "SR_Bounce", signal: "Support/Resistance + RSI", best: "Reversals", defWeight: 0.15 },
  { key: "volume_breakout", label: "VolBreakout", signal: "Volume spike + direction", best: "High volatility", defWeight: 0.15 },
  { key: "sosovalue_sentiment", label: "Sentiment", signal: "DGrid LLM news analysis", best: "News-driven", defWeight: 0.20 },
  { key: "etf_flow", label: "ETF_Flow", signal: "SoSoValue ETF net flow", best: "Macro trend", defWeight: 0.15 },
];

const DEFAULT_STRATEGY_CONFIG: Record<string, StrategyConfig> = {};
ALL_STRATEGIES.forEach((s) => {
  DEFAULT_STRATEGY_CONFIG[s.key] = { enabled: true, weight: s.defWeight };
});

interface MarketLimit {
  maxLeverage: number;
  takerFee: number;
  makerFee: number;
  isolatedOnly: boolean;
}

const DEFAULT_CONFIG: BotConfig = {
  minConfidence: 0.55,
  maxMarginPct: 20,
  symbols: ["SOL-USD", "ETH-USD", "BTC-USD"],
  interval: 60,
  strategyConfig: DEFAULT_STRATEGY_CONFIG,
};

function saveLogs(logs: string[]) {
  try { localStorage.setItem("bot-logs", JSON.stringify(logs.slice(-30))); } catch {}
}

function persistConfig(config: BotConfig) {
  try { localStorage.setItem("bot-config", JSON.stringify(config)); } catch {}
}

// ─── PnL Scorecard Component ─────────────────────────────────

function SignalAccuracyPanel() {
  const [pnlData, setPnlData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/bot/pnl").then(r => r.json()).then(setPnlData).catch(() => {});
    const interval = setInterval(() => {
      fetch("/api/bot/pnl").then(r => r.json()).then(setPnlData).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!pnlData || pnlData.summary?.totalTrades === 0) return null;

  const s = pnlData.summary;
  const slippageAvg = pnlData.recentTrades?.length
    ? pnlData.recentTrades.reduce((acc: number, t: any) => acc + (t.slippageBps || 0), 0) / pnlData.recentTrades.length
    : 0;

  return (
    <div className="terminal-card">
      <div className="terminal-header">
        <span className="text-[12px] font-bold tracking-wider">SIGNAL_ACCURACY</span>
        <span className="text-[11px] text-[var(--text-secondary)] ml-auto">from on-chain closed trades</span>
      </div>
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
          <div className="text-[9px] text-[var(--text-secondary)] uppercase">Hit Rate</div>
          <div className="text-[15px] font-mono font-bold text-[var(--cyan)]">{(s.winRate * 100).toFixed(1)}%</div>
        </div>
        <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
          <div className="text-[9px] text-[var(--text-secondary)] uppercase">Avg Slippage</div>
          <div className="text-[15px] font-mono font-bold text-[var(--text)]">{slippageAvg.toFixed(1)} bps</div>
        </div>
        <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
          <div className="text-[9px] text-[var(--text-secondary)] uppercase">Net PnL</div>
          <div className={`text-[15px] font-mono font-bold ${s.netPnl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>${s.netPnl.toFixed(2)}</div>
        </div>
        <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
          <div className="text-[9px] text-[var(--text-secondary)] uppercase">Sharpe</div>
          <div className="text-[15px] font-mono font-bold text-[var(--text)]">{s.sharpe}</div>
        </div>
      </div>
    </div>
  );
}

function PnlScorecard() {
  const [pnlData, setPnlData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/bot/pnl").then(r => r.json()).then(setPnlData).catch(() => {});
    const interval = setInterval(() => {
      fetch("/api/bot/pnl").then(r => r.json()).then(setPnlData).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!pnlData || pnlData.summary?.totalTrades === 0) return null;

  const s = pnlData.summary;
  const strats = pnlData.strategies || {};
  const stratKeys = Object.keys(strats);

  return (
    <div className="terminal-card">
      <div className="terminal-header">
        <span className="text-[12px] font-bold tracking-wider">STRATEGY_PERFORMANCE</span>
        <span className="text-[11px] text-[var(--text-secondary)] ml-auto">{s.totalTrades} closed trades</span>
      </div>
      <div className="p-4 space-y-4">
        {/* Summary metrics */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Net PnL</div>
            <div className={`text-[13px] font-mono font-bold ${s.netPnl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>${s.netPnl.toFixed(2)}</div>
          </div>
          <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Win Rate</div>
            <div className="text-[13px] font-mono font-bold text-[var(--cyan)]">{s.winRate * 100}%</div>
          </div>
          <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Profit Factor</div>
            <div className="text-[13px] font-mono font-bold text-[var(--text)]">{s.profitFactor}</div>
          </div>
          <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Sharpe</div>
            <div className="text-[13px] font-mono font-bold text-[var(--text)]">{s.sharpe}</div>
          </div>
          <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Max DD</div>
            <div className="text-[13px] font-mono font-bold text-[var(--red)]">{s.maxDrawdown}%</div>
          </div>
          <div className="p-2 text-center bg-white/[0.02] border border-[var(--border)]">
            <div className="text-[9px] text-[var(--text-secondary)] uppercase">Avg Win/Loss</div>
            <div className="text-[13px] font-mono font-bold text-[var(--text)]">${s.avgWin.toFixed(2)} / -${s.avgLoss.toFixed(2)}</div>
          </div>
        </div>

        {/* Per-strategy breakdown */}
        {stratKeys.length > 0 && (
          <div>
            <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider mb-2">Strategy Breakdown</div>
            <div className="space-y-1">
              {stratKeys.map((key) => {
                const st = strats[key];
                return (
                  <div key={key} className="flex items-center gap-4 py-1.5 px-3 bg-white/[0.02] border border-[var(--border)] text-[11px] font-mono">
                    <span className="w-32 text-[var(--cyan)]">{key}</span>
                    <span className="w-16 text-right">{st.trades} trades</span>
                    <span className="w-16 text-right text-[var(--text-secondary)]">{st.winRate}% win</span>
                    <span className={`w-24 text-right font-bold ${st.realizedPnl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>${st.realizedPnl.toFixed(2)}</span>
                    <span className="w-20 text-right text-[var(--text-secondary)]">avg ${st.avgPnl.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BotsPage() {
  const { address, isConnected } = useAccount();
  const { sendInstructions, needsNetworkSwitch, walletChainId } = useSodexTx();
  const { addToast } = useToast();
  const networkCfg = getNetworkConfig();

  const [mounted, setMounted] = useState(false);

  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [autoExecute, setAutoExecute] = useState(false);
  const [execMode, setExecMode] = useState<"off" | "manual" | "auto">("off");
  const [autoAvailable, setAutoAvailable] = useState(false);
  const [networkName, setNetworkName] = useState("TESTNET");
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [marketLimits, setMarketLimits] = useState<Record<string, MarketLimit>>({});
  const [portfolioValue, setPortfolioValue] = useState(0);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const cycleTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const savedRunning = localStorage.getItem("bot-running");
      if (savedRunning) setRunning(JSON.parse(savedRunning));
    } catch {}
    try {
      const savedLogs = localStorage.getItem("bot-logs");
      if (savedLogs) setLogs(JSON.parse(savedLogs));
    } catch {}

    // Load config from URL param first, then localStorage
    let loadedFromUrl = false;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const encoded = params.get("config");
      if (encoded) {
        try {
          const json = decodeURIComponent(atob(encoded));
          const parsed = JSON.parse(json);
          setConfig({
            minConfidence: typeof parsed.minConfidence === "number" ? parsed.minConfidence : DEFAULT_CONFIG.minConfidence,
            maxMarginPct: typeof parsed.maxMarginPct === "number" ? parsed.maxMarginPct : DEFAULT_CONFIG.maxMarginPct,
            symbols: Array.isArray(parsed.symbols) ? parsed.symbols : DEFAULT_CONFIG.symbols,
            interval: typeof parsed.interval === "number" ? parsed.interval : DEFAULT_CONFIG.interval,
            strategyConfig: parsed.strategyConfig || DEFAULT_STRATEGY_CONFIG,
          });
          loadedFromUrl = true;
          addToast("Strategy config loaded from shared link", "success");
        } catch {}
      }
    }

    if (!loadedFromUrl) {
      try {
        const savedConfig = localStorage.getItem("bot-config");
        if (savedConfig) {
          const parsed = JSON.parse(savedConfig);
          setConfig({
            minConfidence: typeof parsed.minConfidence === "number" ? parsed.minConfidence : DEFAULT_CONFIG.minConfidence,
            maxMarginPct: typeof parsed.maxMarginPct === "number" ? parsed.maxMarginPct : DEFAULT_CONFIG.maxMarginPct,
            symbols: Array.isArray(parsed.symbols) ? parsed.symbols : DEFAULT_CONFIG.symbols,
            interval: typeof parsed.interval === "number" ? parsed.interval : DEFAULT_CONFIG.interval,
            strategyConfig: parsed.strategyConfig || DEFAULT_STRATEGY_CONFIG,
          });
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem("bot-running", JSON.stringify(running)); } catch {}
  }, [running]);

  useEffect(() => { saveLogs(logs); }, [logs]);

  useEffect(() => { persistConfig(config); }, [config]);

  const fetchMarketLimits = useCallback(async () => {
    try {
      const res = await fetch("/api/markets");
      const data = await res.json();
      if (data.markets) setMarketLimits(data.markets);
    } catch {}
  }, []);

  useEffect(() => {
    fetchMarketLimits();
    const interval = setInterval(fetchMarketLimits, 60000);
    return () => clearInterval(interval);
  }, [fetchMarketLimits]);

  // Check auto-trading availability from browser-stored bot keys
  useEffect(() => {
    setAutoAvailable(isBotConfigured());
    const onStorage = () => setAutoAvailable(isBotConfigured());
    const onFocus = () => setAutoAvailable(isBotConfigured());
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!isConnected || !address) return;
    const fetchBalance = async () => {
      try {
        const res = await fetch(`/api/wallet/balance?address=${address}`);
        const data = await res.json();
        if (typeof data.usdc === "number") setPortfolioValue(data.usdc);
      } catch {}
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, [isConnected, address]);

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const res = await fetch("/api/bot/signals");
        const data = await res.json();
        if (data.signals && Array.isArray(data.signals)) setSignals(data.signals);
      } catch {}
    };
    fetchSignals();
  }, []);

  const runCycle = useCallback(async () => {
    try {
      const body = {
        symbols: config.symbols,
        minConfidence: config.minConfidence,
        maxMarginPct: config.maxMarginPct,
        walletAddress: address || "",
        portfolioValue,
        strategyConfig: config.strategyConfig,
      };
      const res = await fetch("/api/bot/cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ran) return;
      if (data.logs && Array.isArray(data.logs)) {
        setLogs((prev) => [...prev, ...data.logs].slice(-50));
      }
      if (data.signals && Array.isArray(data.signals)) {
        setSignals(data.signals.map((s: any) => ({ ...s, status: undefined })));
      } else {
        setSignals([]);
      }
    } catch {}
  }, [config.symbols, config.minConfidence, config.maxMarginPct, address, portfolioValue, config.strategyConfig]);

  useEffect(() => {
    if (cycleTimerRef.current) clearInterval(cycleTimerRef.current);
    if (running) {
      runCycle();
      cycleTimerRef.current = setInterval(runCycle, (config.interval || 60) * 1000);
    }
    return () => {
      if (cycleTimerRef.current) clearInterval(cycleTimerRef.current);
    };
  }, [running, config.interval, runCycle]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (!autoExecute || signals.length === 0) return;
    const exec = async () => {
      for (const sig of signals) {
        if (execMode === "auto") {
          await handleAutoExecute(sig);
        } else if (isConnected && address) {
          await handleExecute(sig);
        }
      }
    };
    exec();
  }, [autoExecute, signals, execMode, isConnected, address]);

  const toggleBot = async () => {
    const nextRunning = !running;
    setRunning(nextRunning);
    try {
      await fetch("/api/bot/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ running: nextRunning }),
      });
    } catch {}
  };

  const toggleStrategy = (key: string) => {
    setConfig((prev) => ({
      ...prev,
      strategyConfig: {
        ...prev.strategyConfig,
        [key]: {
          ...prev.strategyConfig[key],
          enabled: !prev.strategyConfig[key]?.enabled,
        },
      },
    }));
  };

  const setStrategyWeight = (key: string, pct: number) => {
    setConfig((prev) => ({
      ...prev,
      strategyConfig: {
        ...prev.strategyConfig,
        [key]: {
          ...prev.strategyConfig[key],
          weight: pct / 100,
        },
      },
    }));
  };

  const handleExecute = async (sig: TradeSignal) => {
    if (!isConnected || !address) return;
    setExecutingId(sig.id);
    setExecuteError(null);
    try {
      const res = await fetch("/api/bot/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signalId: sig.id, symbol: sig.symbol, side: sig.side,
          size: sig.size, price: sig.entryPrice, leverage: sig.leverage, wallet: address,
          stopLoss: sig.stopLoss, takeProfit: sig.takeProfit,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setExecuteError(data.error || `Server error ${res.status}`); addToast(data.error || `Server error ${res.status}`, "error"); return; }
      if (!data.success || !data.action) { setExecuteError(data.error || "Failed to build order"); addToast(data.error || "Failed to build order", "error"); return; }

      const result = await sendInstructions(data.action);
      if (!result.success) { setExecuteError(result.error || "Transaction failed"); addToast(result.error || "Transaction failed", "error"); return; }

      const hasSlTp = sig.stopLoss || sig.takeProfit;
      addToast(`${sig.side.toUpperCase()} ${sig.symbol} executed${hasSlTp ? " · SL/TP attached" : ""}`, "success");
      setSignals((prev) => prev.filter((s) => s.id !== sig.id));
      fetch(`/api/bot/signals?id=${sig.id}`, { method: "DELETE" }).catch(() => {});
      // Sync fills after delay to pick up any closed positions from this trade
      setTimeout(() => {
        fetch("/api/bot/record-fills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) }).catch(() => {});
      }, 3000);
    } catch (err: unknown) {
      setExecuteError(err instanceof Error ? err.message : "Request failed");
      addToast(err instanceof Error ? err.message : "Request failed", "error");
    } finally {
      setExecutingId(null);
    }
  };

  const handleAutoExecute = async (sig: TradeSignal) => {
    if (!address) return;
    if (!isBotConfigured()) {
      setExecuteError("Bot keys not configured. Go to Settings > Auto Trade Bot.");
      addToast("Bot keys not configured", "error");
      return;
    }
    setExecutingId(sig.id);
    setExecuteError(null);
    try {
      const res = await fetch("/api/bot/auto-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address, symbol: sig.symbol, side: sig.side,
          size: sig.size, price: sig.entryPrice, leverage: sig.leverage,
          stopLoss: sig.stopLoss, takeProfit: sig.takeProfit,
        }),
      });
      const data = await res.json();
      if (!data.success || !data.action) {
        setExecuteError(data.error || "Auto-execute failed");
        addToast(data.error || "Auto-execute failed", "error");
        return;
      }

      const signed = await signBotAction(data.action, data.action.message?.nonce || Date.now());
      const result = await submitSignedAction(signed);
      if (!result.success) {
        setExecuteError(result.error || "Auto-execute failed");
        addToast(result.error || "Auto-execute failed", "error");
        return;
      }

      const hasSlTp = sig.stopLoss || sig.takeProfit;
      addToast(`AUTO ${sig.side.toUpperCase()} ${sig.symbol} executed${hasSlTp ? " · SL/TP attached" : ""}`, "success");
      setSignals((prev) => prev.filter((s) => s.id !== sig.id));
      fetch(`/api/bot/signals?id=${sig.id}`, { method: "DELETE" }).catch(() => {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Auto-execute failed";
      const lower = msg.toLowerCase();
      let hint = "";
      if (lower.includes("not unlocked") || lower.includes("not configured")) {
        hint = " Unlock your bot keys in Settings first.";
      } else if (lower.includes("not found") || lower.includes("api key")) {
        hint = " Check the API key name and key pair in Settings — they must match the key created at sodex.com/apikeys.";
      } else if (lower.includes("unauthorized") || lower.includes("forbidden")) {
        hint = " The API key may be revoked or on the wrong network. Check sodex.com/apikeys.";
      }
      setExecuteError(msg + hint);
      addToast(msg + hint, "error");
    } finally {
      setExecutingId(null);
    }
  };

  const updateConfig = (patch: Partial<BotConfig>) => setConfig((prev) => ({ ...prev, ...patch }));
  const clearLogs = () => setLogs([]);

  const activeStrategyCount = Object.values(config.strategyConfig).filter((s) => s.enabled).length;

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="text-[var(--text-secondary)] font-mono text-sm"><span className="text-[var(--cyan)]">&gt;</span> loading bot module...<span className="animate-blink">_</span></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in">
      {isConnected && needsNetworkSwitch && (
        <div className="terminal-card p-3 border-l-2 border-l-[var(--yellow)]">
          <div className="text-[12px] font-mono text-[var(--yellow)]">
            <div>⚠ WRONG NETWORK — MetaMask on chain {walletChainId}, SoDEX requires {networkCfg.chainId}</div>
            <div>Add {networkCfg.displayName} manually: MetaMask → Settings → Networks → Add Network</div>
            <div>Name: {networkCfg.displayName} | Chain ID: {networkCfg.chainId} | Currency: SOSO</div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--cyan)] glow-cyan tracking-wider">BOT_CONTROL</h1>
          <p className="text-[12px] text-[var(--text-secondary)] font-mono mt-1">Strategy swarm automation — {activeStrategyCount}/7 strategies active</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-black/30 border border-[var(--border)] rounded-sm overflow-hidden">
            <button
              onClick={() => { setAutoExecute(false); setExecMode("off"); }}
              className={`text-[11px] px-3 py-1.5 font-mono transition-colors ${execMode === "off" && !autoExecute ? "bg-[var(--red)]/20 text-[var(--red)] font-bold" : "text-[var(--text-secondary)] hover:text-[var(--text)]"}`}
            >OFF</button>
            <button
              onClick={() => { setAutoExecute(true); setExecMode("manual"); }}
              disabled={!isConnected}
              className={`text-[11px] px-3 py-1.5 font-mono transition-colors border-x border-[var(--border)] ${execMode === "manual" && autoExecute ? "bg-[var(--cyan)]/20 text-[var(--cyan)] font-bold" : "text-[var(--text-secondary)] hover:text-[var(--text)] disabled:opacity-30"}`}
            >MANUAL</button>
            <Tooltip text={autoAvailable ? "Trades are signed locally with your decrypted bot key." : "Go to Settings to register and save an encrypted bot key before enabling AUTO."}>
              <button
                onClick={() => { setAutoExecute(true); setExecMode("auto"); }}
                disabled={!autoAvailable}
                className={`text-[11px] px-3 py-1.5 font-mono transition-colors ${execMode === "auto" && autoExecute ? "bg-[var(--green)]/20 text-[var(--green)] font-bold" : "text-[var(--text-secondary)] hover:text-[var(--text)] disabled:opacity-30"}`}
              >AUTO</button>
            </Tooltip>
          </div>
          <button
            onClick={toggleBot}
            className={`btn-terminal text-[13px] py-2 px-6 font-bold ${running ? "btn-terminal-red" : "btn-terminal-green"}`}
          >
            {running ? "[ STOP BOT ]" : "[ START BOT ]"}
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <div className={`terminal-card p-4 border-l-2 ${running ? "border-l-[var(--green)]" : "border-l-[var(--red)]"}`}>
        <div className="flex items-center gap-3">
          <span className={`status-dot ${running ? "online" : "offline"}`} />
          <span className={`text-[13px] font-mono font-bold ${running ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
            SOVIBE_BOT {running ? "RUNNING" : "OFFLINE"}
          </span>
          {execMode === "auto" && !autoAvailable && (
            <span className="text-[11px] text-[var(--yellow)] font-mono ml-4">
              AUTO requires unlocked bot keys —{" "}
              <Link href="/settings" className="underline text-[var(--cyan)]">configure in Settings</Link>
            </span>
          )}
          {running && (
            <>
              <span className="text-[var(--text-secondary)]">|</span>
              <span className="text-[11px] text-[var(--text-secondary)] font-mono">
                Scanning: {config.symbols.join(", ")} · Interval: {config.interval}s · Strategies: {activeStrategyCount}
              </span>
            </>
          )}
          {!isConnected && (
            <span className="text-[11px] text-[var(--yellow)] font-mono ml-4">⚠ Connect wallet to execute trades</span>
          )}
        </div>
      </div>

      {/* Pending Signals — larger, more readable */}
      <div className="terminal-card">
        <div className="terminal-header">
          <span className="text-[13px] font-bold tracking-wider">PENDING_SIGNALS</span>
          <span className="text-[11px] text-[var(--text-secondary)] ml-auto">{signals.length} from latest cycle</span>
        </div>
        <div className="p-5">
          {executeError && (
            <div className="mb-4 p-3 border border-[var(--red)]/30 bg-[var(--red)]/5 text-[var(--red)] text-[12px] font-mono">
              [ERR] {executeError}
            </div>
          )}
          {signals.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-secondary)] text-[13px] font-mono">
              {running ? "No signals this cycle. Bot is scanning markets..." : "Start the bot to generate signals."}
            </div>
          ) : (
            <div className="space-y-3">
              {signals.map((sig) => {
                const sentimentDetail = sig.details?.find((d: any) => d.name === "sosovalue_sentiment");
                const etfDetail = sig.details?.find((d: any) => d.name === "etf_flow");
                const stratDetails = (sig.details || []).filter((d: any) => d.name !== "sosovalue_sentiment" && d.name !== "etf_flow");
                return (
                  <div key={sig.id} className="p-5 bg-white/[0.02] border border-[var(--border)] hover:border-[var(--cyan)]/30 transition-colors space-y-4">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={`text-[12px] font-bold px-3 py-1 border ${sig.side === "long" ? "border-[var(--green)] text-[var(--green)]" : "border-[var(--red)] text-[var(--red)]"}`}>
                          {sig.side.toUpperCase()}
                        </span>
                        <span className="text-[16px] font-mono font-bold text-[var(--cyan)]">{sig.symbol}</span>
                        <span className="text-[12px] text-[var(--text-secondary)] font-mono">@{sig.entryPrice.toFixed(2)}</span>
                        {sentimentDetail?.meta?.narratives?.[0] && (
                          <span className="text-[11px] px-2 py-0.5 border border-[var(--magenta)]/30 text-[var(--magenta)] font-mono">
                            🧠 {sentimentDetail.meta.narratives[0]}
                          </span>
                        )}
                        {etfDetail && (
                          <span className={`text-[11px] px-2 py-0.5 border font-mono ${etfDetail.signal === "bullish" ? "border-[var(--green)]/30 text-[var(--green)]" : "border-[var(--red)]/30 text-[var(--red)]"}`}>
                            🏦 ETF: {etfDetail.meta?.trend7d || etfDetail.signal}
                          </span>
                        )}
                        {sig.macroAlert && (
                          <span className="text-[11px] px-2 py-0.5 border border-[var(--yellow)]/30 text-[var(--yellow)] font-mono">
                            ⚠ {sig.macroAlert}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-[13px] font-mono text-[var(--cyan)] font-bold">{(sig.confidence * 100).toFixed(0)}% CONFIDENCE</div>
                          <div className="text-[11px] text-[var(--text-secondary)] font-mono">▲{sig.longVotes} ▼{sig.shortVotes} votes</div>
                        </div>
                        <button
                          onClick={() => execMode === "auto" ? handleAutoExecute(sig) : handleExecute(sig)}
                          disabled={(!isConnected && execMode !== "auto") || needsNetworkSwitch || executingId === sig.id}
                          className={`btn-terminal text-[12px] py-2 px-4 disabled:opacity-40 font-bold ${needsNetworkSwitch ? "border-[var(--yellow)] text-black bg-[var(--yellow)]" : execMode === "auto" ? "btn-terminal-green" : "btn-terminal-green"}`}
                        >
                          {!isConnected && execMode !== "auto" ? "CONNECT" : needsNetworkSwitch ? "WRONG NET" : executingId === sig.id ? "SIGNING..." : execMode === "auto" ? "[ AUTO EXECUTE ]" : "[ EXECUTE ]"}
                        </button>
                      </div>
                    </div>

                    {/* LLM Reasoning */}
                    {sig.reasoning && (
                      <div className="p-3 border-l-2 border-l-[var(--magenta)] bg-[var(--magenta)]/5">
                        <div className="text-[12px] text-[var(--magenta)] font-mono leading-relaxed">
                          💭 {sig.reasoning}
                        </div>
                        {sig.riskFactors && sig.riskFactors.length > 0 && (
                          <div className="flex gap-2 mt-2 flex-wrap">
                            {sig.riskFactors.map((r, i) => (
                              <span key={i} className="text-[10px] px-2 py-1 border border-[var(--red)]/20 text-[var(--red)] font-mono">{r}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Strategy votes */}
                    {stratDetails.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-wider">Strategy Consensus</div>
                        <div className="flex gap-2 flex-wrap">
                          {stratDetails.map((d: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-black/30 border border-[var(--border)]">
                              <span className={`text-[11px] font-bold ${parseFloat(d.signal) > 0 ? "text-[var(--green)]" : parseFloat(d.signal) < 0 ? "text-[var(--red)]" : "text-[var(--text-secondary)]"}`}>
                                {parseFloat(d.signal) > 0 ? "▲" : parseFloat(d.signal) < 0 ? "▼" : "◆"}
                              </span>
                              <span className="text-[11px] font-mono text-[var(--text)]">{d.name}</span>
                              <span className="text-[11px] font-mono text-[var(--cyan)] font-bold">{(parseFloat(d.confidence) * 100).toFixed(0)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Vibe Score */}
                    {sig.vibeScore && (
                      <div className="flex items-center gap-3 text-[11px] font-mono border-t border-[var(--border)] pt-3">
                        <span className="text-[var(--text-secondary)]">VIBE:</span>
                        <span className={`font-bold ${sig.vibeScore.vibe > 0 ? "text-[var(--green)]" : sig.vibeScore.vibe < 0 ? "text-[var(--red)]" : "text-[var(--text-secondary)]"}`}>
                          {sig.vibeScore.vibe > 0 ? "+" : ""}{sig.vibeScore.vibe.toFixed(2)}
                        </span>
                        <span className="text-[var(--text-secondary)]">|</span>
                        <span className={sig.vibeScore.fullConsensus ? "text-[var(--green)]" : "text-[var(--text-secondary)]"}>
                          {sig.vibeScore.fullConsensus ? "🔒 Full Consensus" : "Partial"}
                        </span>
                      </div>
                    )}

                    {/* Risk metrics */}
                    <div className="flex items-center gap-4 text-[12px] font-mono text-[var(--text-secondary)] border-t border-[var(--border)] pt-3">
                      <span className="text-[var(--text)] font-bold">{sig.size.toFixed(4)} units</span>
                      <span className="text-[var(--text-dim)]">|</span>
                      <span>${(sig.size * sig.entryPrice).toFixed(2)} notional</span>
                      <span className="text-[var(--text-dim)]">|</span>
                      <span className="text-[var(--red)] font-bold">SL: {sig.stopLoss.toFixed(2)}</span>
                      <span className="text-[var(--text-dim)]">|</span>
                      <span className="text-[var(--green)] font-bold">TP: {sig.takeProfit.toFixed(2)}</span>
                      <span className="text-[var(--text-dim)]">|</span>
                      <span>{sig.leverage}x lev</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Config Panel */}
        <div className="terminal-card space-y-4">
          <div className="terminal-header">
            <span className="text-[12px] font-bold tracking-wider">CONFIGURATION</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between py-3 px-3 bg-white/[0.02] border border-[var(--border)]">
              <span className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.15em]">Portfolio</span>
              <span className="text-[14px] font-mono text-[var(--cyan)] font-bold">${portfolioValue.toFixed(2)}</span>
            </div>

            <div>
              <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-2 block">Markets</label>
              {Object.keys(marketLimits).length === 0 ? (
                <div className="text-[12px] text-[var(--text-secondary)] font-mono">Loading available markets from SoDEX...</div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {Object.keys(marketLimits).map((s) => {
                    const limit = marketLimits[s];
                    return (
                      <button
                        key={s}
                        onClick={() => {
                          const next = config.symbols.includes(s) ? config.symbols.filter((x) => x !== s) : [...config.symbols, s];
                          updateConfig({ symbols: next });
                        }}
                        className={`py-2 px-3 text-[12px] font-mono border transition-all ${config.symbols.includes(s) ? "border-[var(--cyan)] text-[var(--cyan)] bg-[var(--cyan)]/10" : "border-[var(--border)] text-[var(--text-secondary)]"}`}
                      >
                        {s} <span className="text-[10px] text-[var(--text-secondary)] ml-1">({limit?.maxLeverage || "?"}x)</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.15em]">Min Confidence: {(config.minConfidence * 100).toFixed(0)}%</label>
              </div>
              <input type="range" min={30} max={90} value={config.minConfidence * 100} onChange={(e) => updateConfig({ minConfidence: parseInt(e.target.value) / 100 })} className="w-full" />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.15em]">Max Margin: {config.maxMarginPct}%</label>
              </div>
              <input type="range" min={5} max={100} value={config.maxMarginPct} onChange={(e) => updateConfig({ maxMarginPct: parseInt(e.target.value) })} className="w-full" />
              <div className="flex justify-between text-[10px] text-[var(--text-secondary)] font-mono mt-1"><span>5%</span><span>50%</span><span>100%</span></div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.15em]">Scan Interval: {config.interval}s</label>
              </div>
              <input type="range" min={10} max={300} step={10} value={config.interval} onChange={(e) => updateConfig({ interval: parseInt(e.target.value) })} className="w-full" />
            </div>
          </div>
        </div>

        {/* Live Log */}
        <div className="terminal-card flex flex-col h-[520px]">
          <div className="terminal-header">
            <span className="text-[12px] font-bold tracking-wider">BOT_LOG</span>
            <div className="flex items-center gap-3 ml-auto">
              <span className="text-[11px] text-[var(--text-secondary)]">{logs.length} entries</span>
              <button onClick={clearLogs} className="text-[11px] text-[var(--red)] hover:underline">[ clear ]</button>
            </div>
          </div>
          <div ref={logContainerRef} className="flex-1 overflow-y-auto p-4 font-mono text-[12px] space-y-1 bg-black/30">
            {logs.length === 0 ? (
              <div className="text-[var(--text-secondary)] py-4">Bot is offline. Start to see logs.</div>
            ) : (
              logs.map((line, i) => {
                const isError = line.includes("ERR") || line.includes("error") || line.includes("failed");
                const isSuccess = line.includes("OK") || line.includes("success") || line.includes("SIGNAL");
                const isWarn = line.includes("WARN") || line.includes("⚠") || line.includes("⏸");
                return (
                  <div key={i} className={`log-entry ${isError ? "log-error" : isSuccess ? "log-success" : isWarn ? "log-warn" : "log-info"}`}>{line}</div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Strategy Builder */}
      <div className="terminal-card">
        <div className="terminal-header">
          <span className="text-[12px] font-bold tracking-wider">STRATEGY_BUILDER</span>
          <span className="text-[11px] text-[var(--text-secondary)] ml-auto">{activeStrategyCount}/7 active</span>
        </div>
        <div className="p-4">
          <div className="text-[11px] text-[var(--text-secondary)] mb-4 font-mono">Toggle strategies on/off and adjust their influence weight. Changes take effect on the next cycle.</div>
          <div className="space-y-2">
            {ALL_STRATEGIES.map((s) => {
              const cfg = config.strategyConfig[s.key] || { enabled: true, weight: s.defWeight };
              const weightPct = Math.round(cfg.weight * 100);
              return (
                <div key={s.key} className={`flex items-center gap-4 p-3 border transition-colors ${cfg.enabled ? "border-[var(--border)] bg-white/[0.02]" : "border-[var(--border)]/30 bg-black/20 opacity-60"}`}>
                  {/* Toggle */}
                  <button
                    onClick={() => toggleStrategy(s.key)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${cfg.enabled ? "bg-[var(--green)]" : "bg-[var(--border)]"}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${cfg.enabled ? "left-[22px]" : "left-[2px]"}`} />
                  </button>

                  {/* Name */}
                  <div className="w-28 shrink-0">
                    <div className="text-[12px] font-mono text-[var(--cyan)] font-bold">{s.label}</div>
                    <div className="text-[10px] text-[var(--text-secondary)]">{s.best}</div>
                  </div>

                  {/* Description */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-[var(--text-secondary)] font-mono">{s.signal}</div>
                  </div>

                  {/* Weight slider */}
                  <div className="w-40 shrink-0 flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-secondary)] w-8 text-right">{weightPct}%</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={weightPct}
                      onChange={(e) => setStrategyWeight(s.key, parseInt(e.target.value))}
                      disabled={!cfg.enabled}
                      className="w-24"
                    />
                  </div>

                  {/* Status badge */}
                  <span className={`text-[10px] px-2 py-0.5 border font-mono shrink-0 ${cfg.enabled ? "border-[var(--green)]/30 text-[var(--green)]" : "border-[var(--red)]/30 text-[var(--red)]"}`}>
                    {cfg.enabled ? "ON" : "OFF"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Strategy Performance Scorecard */}
      <PnlScorecard />

      {/* Signal Accuracy from on-chain fills */}
      <SignalAccuracyPanel />
      {/* Config Card Export */}
      <div className="terminal-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-bold tracking-wider text-[var(--cyan)]">STRATEGY_CONFIG_CARD</div>
            <div className="text-[11px] text-[var(--text-secondary)] font-mono mt-1">
              Share this config to let others replicate your strategy setup. Copy as JSON or share via URL.
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const card = {
                  name: "SoVibe Strategy Config",
                  minConfidence: config.minConfidence,
                  maxMarginPct: config.maxMarginPct,
                  symbols: config.symbols,
                  interval: config.interval,
                  strategyConfig: config.strategyConfig,
                };
                navigator.clipboard.writeText(JSON.stringify(card, null, 2));
                addToast("Config copied to clipboard", "success");
              }}
              className="btn-terminal text-[11px] py-1.5 px-3"
            >
              [ COPY JSON ]
            </button>
            <button
              onClick={() => {
                const card = {
                  minConfidence: config.minConfidence,
                  maxMarginPct: config.maxMarginPct,
                  symbols: config.symbols,
                  interval: config.interval,
                  strategyConfig: config.strategyConfig,
                };
                const encoded = btoa(encodeURIComponent(JSON.stringify(card)));
                const url = `${window.location.origin}/bots?config=${encoded}`;
                navigator.clipboard.writeText(url);
                addToast("Shareable URL copied!", "success");
              }}
              className="btn-terminal btn-terminal-green text-[11px] py-1.5 px-3"
            >
              [ COPY SHARE LINK ]
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
