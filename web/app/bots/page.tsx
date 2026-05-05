"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount } from "wagmi";
import { useSodexTx } from "@/lib/use-sodex-tx";
import { useToast } from "@/components/ToastProvider";

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
  queuedAt: number;
}

interface BotConfig {
  minConfidence: number;
  maxMarginPct: number;
  symbols: string[];
  interval: number;
}

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
};

function saveLogs(logs: string[]) {
  try { localStorage.setItem("bot-logs", JSON.stringify(logs.slice(-30))); } catch {}
}

function persistConfig(config: BotConfig) {
  try { localStorage.setItem("bot-config", JSON.stringify(config)); } catch {}
}

export default function BotsPage() {
  const { address, isConnected } = useAccount();
  const { sendInstructions, needsNetworkSwitch, walletChainId } = useSodexTx();
  const { addToast } = useToast();

  const [mounted, setMounted] = useState(false);

  // Hydration-safe defaults — real values loaded in useEffect after mount
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [autoExecute, setAutoExecute] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [marketLimits, setMarketLimits] = useState<Record<string, MarketLimit>>({});
  const [portfolioValue, setPortfolioValue] = useState(0);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const cycleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load from localStorage after mount (prevents hydration mismatch)
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
    try {
      const savedConfig = localStorage.getItem("bot-config");
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        setConfig({
          minConfidence: typeof parsed.minConfidence === "number" ? parsed.minConfidence : DEFAULT_CONFIG.minConfidence,
          maxMarginPct: typeof parsed.maxMarginPct === "number" ? parsed.maxMarginPct : DEFAULT_CONFIG.maxMarginPct,
          symbols: Array.isArray(parsed.symbols) ? parsed.symbols : DEFAULT_CONFIG.symbols,
          interval: typeof parsed.interval === "number" ? parsed.interval : DEFAULT_CONFIG.interval,
        });
      }
    } catch {}
  }, []);

  // Persist running state
  useEffect(() => {
    try { localStorage.setItem("bot-running", JSON.stringify(running)); } catch {}
  }, [running]);

  // Persist logs (last 30 only)
  useEffect(() => { saveLogs(logs); }, [logs]);

  // Persist config to localStorage on every change
  useEffect(() => {
    persistConfig(config);
  }, [config]);

  // Fetch market limits
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

  // Balance sync
  useEffect(() => {
    if (!isConnected || !address) return;

    const fetchBalance = async () => {
      try {
        const res = await fetch(`/api/wallet/balance?address=${address}`);
        const data = await res.json();
        if (typeof data.usdc === "number") {
          setPortfolioValue(data.usdc);
        }
      } catch {}
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, [isConnected, address]);

  // Fetch latest signals from server on mount (so signals persist across page navigation)
  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const res = await fetch("/api/bot/signals");
        const data = await res.json();
        if (data.signals && Array.isArray(data.signals)) {
          setSignals(data.signals);
        }
      } catch {}
    };
    fetchSignals();
  }, []);

  // Run cycle — sends config in body so server doesn't need state
  const runCycle = useCallback(async () => {
    try {
      const body = {
        symbols: config.symbols,
        minConfidence: config.minConfidence,
        maxMarginPct: config.maxMarginPct,
        walletAddress: address || "",
        portfolioValue,
      };
      const res = await fetch("/api/bot/cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ran) return;

      // Append logs from this cycle
      if (data.logs && Array.isArray(data.logs)) {
        setLogs((prev) => [...prev, ...data.logs].slice(-50));
      }

      // Replace signals with fresh ones from this cycle
      if (data.signals && Array.isArray(data.signals)) {
        setSignals(data.signals.map((s: any) => ({ ...s, status: undefined })));
      } else {
        setSignals([]);
      }
    } catch {}
  }, [config.symbols, config.minConfidence, config.maxMarginPct, address, portfolioValue]);

  // Cycle timer
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

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Auto-execute
  useEffect(() => {
    if (!autoExecute || !isConnected || signals.length === 0) return;
    const exec = async () => {
      for (const sig of signals) {
        if (!address) continue;
        await handleExecute(sig);
      }
    };
    exec();
  }, [autoExecute, signals, isConnected, address]);

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

  const handleExecute = async (sig: TradeSignal) => {
    if (!isConnected || !address) return;
    setExecutingId(sig.id);
    setExecuteError(null);
    try {
      // Phase 1: Execute market order
      const res = await fetch("/api/bot/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signalId: sig.id,
          symbol: sig.symbol,
          side: sig.side,
          size: sig.size,
          price: sig.entryPrice,
          leverage: sig.leverage,
          wallet: address,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExecuteError(data.error || `Server error ${res.status}`);
        addToast(data.error || `Server error ${res.status}`, "error");
        return;
      }
      if (!data.success || !data.action) {
        setExecuteError(data.error || "Failed to build order");
        addToast(data.error || "Failed to build order", "error");
        return;
      }

      const result = await sendInstructions(data.action);
      if (!result.success) {
        setExecuteError(result.error || "Transaction failed");
        addToast(result.error || "Transaction failed", "error");
        return;
      }

      addToast(`${sig.side.toUpperCase()} ${sig.symbol} executed`, "success");

      // Phase 2: Auto-set SL/TP after position is open
      const hasSlTp = sig.stopLoss || sig.takeProfit;
      if (hasSlTp && address) {
        try {
          await new Promise((r) => setTimeout(r, 5000)); // wait for position to settle on-chain
          const sltpRes = await fetch("/api/positions/sl-tp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: sig.symbol,
              side: sig.side,
              stopLoss: sig.stopLoss,
              takeProfit: sig.takeProfit,
              wallet: address,
            }),
          });
          const sltpData = await sltpRes.json();
          if (sltpData.success && sltpData.actions) {
            for (let i = 0; i < sltpData.actions.length; i++) {
              if (i > 0) await new Promise((r) => setTimeout(r, 100));
              await sendInstructions(sltpData.actions[i]);
            }
          }
        } catch {
          // SL/TP failed silently — market order succeeded
        }
      }

      setSignals((prev) => prev.filter((s) => s.id !== sig.id));
    } catch (err: unknown) {
      setExecuteError(err instanceof Error ? err.message : "Request failed");
      addToast(err instanceof Error ? err.message : "Request failed", "error");
    } finally {
      setExecutingId(null);
    }
  };

  const updateConfig = (patch: Partial<BotConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const clearLogs = () => setLogs([]);

  // Prevent hydration mismatch — render placeholder until client state loaded
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
          <div className="text-[11px] font-mono text-[var(--yellow)]">
            <div>⚠ WRONG NETWORK — MetaMask on chain {walletChainId}, SoDEX requires 138565</div>
            <div>Add SoDEX Testnet manually: MetaMask → Settings → Networks → Add Network</div>
            <div>Name: SoDEX Testnet | Chain ID: 138565 | Currency: SOSO</div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--cyan)] glow-cyan tracking-wider">BOT_CONTROL</h1>
          <p className="text-[11px] text-[var(--text-secondary)] font-mono mt-1">Strategy swarm automation — server-side analysis, client-side execution</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoExecute(!autoExecute)}
            className={`btn-terminal text-[11px] py-2 px-4 ${autoExecute ? "btn-terminal-green" : ""}`}
            disabled={!isConnected}
            title={isConnected ? "Auto-sign signals with wallet" : "Connect wallet to enable"}
          >
            {autoExecute ? "[ AUTO: ON ]" : "[ AUTO: OFF ]"}
          </button>
          <button
            onClick={toggleBot}
            className={`btn-terminal text-[12px] py-2 px-6 font-bold ${running ? "btn-terminal-red" : "btn-terminal-green"}`}
          >
            {running ? "[ STOP BOT ]" : "[ START BOT ]"}
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <div className={`terminal-card p-4 border-l-2 ${running ? "border-l-[var(--green)]" : "border-l-[var(--red)]"}`}>
        <div className="flex items-center gap-3">
          <span className={`status-dot ${running ? "online" : "offline"}`} />
          <span className={`text-[12px] font-mono font-bold ${running ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
            SOVIBE_BOT {running ? "RUNNING" : "OFFLINE"}
          </span>
          {running && (
            <>
              <span className="text-[var(--text-secondary)]">|</span>
              <span className="text-[10px] text-[var(--text-secondary)] font-mono">
                Scanning: {config.symbols.join(", ")} · Interval: {config.interval}s
              </span>
            </>
          )}
          {!isConnected && (
            <span className="text-[10px] text-[var(--yellow)] font-mono ml-4">⚠ Connect wallet to execute trades</span>
          )}
        </div>
      </div>

      {/* Pending Signals */}
      <div className="terminal-card">
        <div className="terminal-header">
          <span className="text-[11px] font-bold tracking-wider">PENDING_SIGNALS</span>
          <span className="text-[10px] text-[var(--text-secondary)] ml-auto">{signals.length} from latest cycle</span>
        </div>
        <div className="p-4">
          {executeError && (
            <div className="mb-3 p-2 border border-[var(--red)]/30 bg-[var(--red)]/5 text-[var(--red)] text-[11px] font-mono">
              [ERR] {executeError}
            </div>
          )}
          {signals.length === 0 ? (
            <div className="text-center py-6 text-[var(--text-secondary)] text-[12px] font-mono">
              {running ? "No signals this cycle. Bot is scanning markets..." : "Start the bot to generate signals."}
            </div>
          ) : (
            <div className="space-y-2">
              {signals.map((sig) => {
                const sentimentDetail = (sig as any).details?.find((d: any) => d.name === "sosovalue_sentiment");
                const stratDetails = ((sig as any).details || []).filter((d: any) => d.name !== "sosovalue_sentiment");
                return (
                  <div key={sig.id} className="p-4 bg-white/[0.02] border border-[var(--border)] hover:border-[var(--cyan)]/30 transition-colors space-y-3">
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 border ${sig.side === "long" ? "border-[var(--green)] text-[var(--green)]" : "border-[var(--red)] text-[var(--red)]"}`}>
                          {sig.side.toUpperCase()}
                        </span>
                        <span className="text-[14px] font-mono font-bold text-[var(--cyan)]">{sig.symbol}</span>
                        <span className="text-[10px] text-[var(--text-secondary)] font-mono">@{sig.entryPrice.toFixed(2)}</span>
                        {sentimentDetail && (
                          <span className={`text-[9px] px-1.5 py-0.5 border ${sentimentDetail.signal === "bullish" ? "border-[var(--green)]/30 text-[var(--green)]" : sentimentDetail.signal === "bearish" ? "border-[var(--red)]/30 text-[var(--red)]" : "border-[var(--text-dim)] text-[var(--text-secondary)]"}`}>
                            SoSoValue: {sentimentDetail.signal}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-[10px] font-mono text-right">
                          <div className="text-[var(--cyan)] font-bold">{(sig.confidence * 100).toFixed(0)}% CONFIDENCE</div>
                          <div className="text-[var(--text-secondary)]">▲{sig.longVotes} ▼{sig.shortVotes} votes</div>
                        </div>
                        <button
                          onClick={() => handleExecute(sig)}
                          disabled={!isConnected || needsNetworkSwitch || executingId === sig.id}
                          className={`btn-terminal text-[10px] py-1.5 px-3 disabled:opacity-40 ${needsNetworkSwitch ? "border-[var(--yellow)] text-black bg-[var(--yellow)]" : "btn-terminal-green"}`}
                        >
                          {!isConnected ? "CONNECT" : needsNetworkSwitch ? "WRONG NET" : executingId === sig.id ? "SIGNING..." : "[ EXECUTE ]"}
                        </button>
                      </div>
                    </div>

                    {/* Strategy vote bars */}
                    {stratDetails.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider">Strategy Consensus</div>
                        <div className="flex gap-2 flex-wrap">
                          {stratDetails.map((d: any, i: number) => (
                            <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-black/30 border border-[var(--border)]">
                              <span className={`text-[9px] ${parseFloat(d.signal) > 0 ? "text-[var(--green)]" : parseFloat(d.signal) < 0 ? "text-[var(--red)]" : "text-[var(--text-secondary)]"}`}>
                                {parseFloat(d.signal) > 0 ? "▲" : parseFloat(d.signal) < 0 ? "▼" : "◆"}
                              </span>
                              <span className="text-[9px] font-mono text-[var(--text-secondary)]">{d.name}</span>
                              <span className="text-[9px] font-mono text-[var(--cyan)]">{(parseFloat(d.confidence) * 100).toFixed(0)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Risk metrics row */}
                    <div className="flex items-center gap-4 text-[10px] font-mono text-[var(--text-secondary)] border-t border-[var(--border)] pt-2">
                      <span>{sig.size.toFixed(4)} units</span>
                      <span className="text-[var(--text-secondary)]">|</span>
                      <span>${(sig.size * sig.entryPrice).toFixed(2)} notional</span>
                      <span className="text-[var(--text-secondary)]">|</span>
                      <span className="text-[var(--red)]">SL: {sig.stopLoss.toFixed(2)}</span>
                      <span className="text-[var(--text-secondary)]">|</span>
                      <span className="text-[var(--green)]">TP: {sig.takeProfit.toFixed(2)}</span>
                      <span className="text-[var(--text-secondary)]">|</span>
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
            <span className="text-[11px] font-bold tracking-wider">CONFIGURATION</span>
          </div>
          <div className="p-4 space-y-4">
            {/* Portfolio Value Display */}
            <div className="flex items-center justify-between py-2 px-3 bg-white/[0.02] border border-[var(--border)]">
              <span className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em]">Portfolio</span>
              <span className="text-[13px] font-mono text-[var(--cyan)]">${portfolioValue.toFixed(2)}</span>
            </div>

            <div>
              <label className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-2 block">Markets</label>
              {Object.keys(marketLimits).length === 0 ? (
                <div className="text-[11px] text-[var(--text-secondary)] font-mono">Loading available markets from SoDEX...</div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {Object.keys(marketLimits).map((s) => {
                    const limit = marketLimits[s];
                    const maxLev = limit?.maxLeverage || "?";
                    return (
                      <button
                        key={s}
                        onClick={() => {
                          const next = config.symbols.includes(s)
                            ? config.symbols.filter((x) => x !== s)
                            : [...config.symbols, s];
                          updateConfig({ symbols: next });
                        }}
                        className={`py-1.5 px-3 text-[11px] font-mono border transition-all ${config.symbols.includes(s) ? "border-[var(--cyan)] text-[var(--cyan)] bg-[var(--cyan)]/10" : "border-[var(--border)] text-[var(--text-secondary)]"}`}
                      >
                        {s}
                        <span className="text-[9px] text-[var(--text-secondary)] ml-1">({maxLev}x)</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em]">Min Confidence: {(config.minConfidence * 100).toFixed(0)}%</label>
                <span className="text-[9px] text-[var(--text-secondary)] cursor-help" title="Minimum signal strength required before the bot queues a trade. Higher = fewer but stronger signals.">(?)</span>
              </div>
              <input type="range" min={30} max={90} value={config.minConfidence * 100} onChange={(e) => updateConfig({ minConfidence: parseInt(e.target.value) / 100 })} className="w-full" />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em]">Max Margin: {config.maxMarginPct}%</label>
                <span className="text-[9px] text-[var(--text-secondary)] cursor-help" title="Percentage of your portfolio to use as margin per trade. 20% of $100 = $20 margin. Position size = margin × market max leverage.">(?)</span>
              </div>
              <input type="range" min={5} max={100} value={config.maxMarginPct} onChange={(e) => updateConfig({ maxMarginPct: parseInt(e.target.value) })} className="w-full" />
              <div className="flex justify-between text-[9px] text-[var(--text-secondary)] font-mono mt-1">
                <span>5%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em]">Scan Interval: {config.interval}s</label>
                <span className="text-[9px] text-[var(--text-secondary)] cursor-help" title="How often the bot analyzes markets and generates signals.">(?)</span>
              </div>
              <input type="range" min={10} max={300} step={10} value={config.interval} onChange={(e) => updateConfig({ interval: parseInt(e.target.value) })} className="w-full" />
            </div>


          </div>
        </div>

        {/* Live Log */}
        <div className="terminal-card flex flex-col h-[520px]">
          <div className="terminal-header">
            <span className="text-[11px] font-bold tracking-wider">BOT_LOG</span>
            <div className="flex items-center gap-3 ml-auto">
              <span className="text-[10px] text-[var(--text-secondary)]">{logs.length} entries</span>
              <button onClick={clearLogs} className="text-[10px] text-[var(--red)] hover:underline">[ clear ]</button>
            </div>
          </div>
          <div ref={logContainerRef} className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 bg-black/30">
            {logs.length === 0 ? (
              <div className="text-[var(--text-secondary)] py-4">{running ? "Waiting for log output..." : "Bot is offline. Start to see logs."}</div>
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

      {/* Strategy Details */}
      <div className="terminal-card">
        <div className="terminal-header">
          <span className="text-[11px] font-bold tracking-wider">STRATEGY_DETAILS</span>
        </div>
        <div className="p-4">
          <table className="terminal-table">
            <thead>
              <tr><th>Engine</th><th>Signal Type</th><th>Best In</th><th>Weight</th><th>Status</th></tr>
            </thead>
            <tbody>
              {[
                { name: "TrendFollow", signal: "EMA cross + RSI filter", best: "Trending markets", weight: "1.0x", status: "active" },
                { name: "MeanReversion", signal: "Bollinger + RSI extremes", best: "Range-bound", weight: "1.0x", status: "active" },
                { name: "Momentum", signal: "MACD hist + volume", best: "Breakouts", weight: "1.0x", status: "active" },
                { name: "SR_Bounce", signal: "Support/Resistance + RSI", best: "Reversals", weight: "1.0x", status: "active" },
                { name: "VolBreakout", signal: "Volume spike + direction", best: "High volatility", weight: "1.0x", status: "active" },
              ].map((s) => (
                <tr key={s.name}>
                  <td className="text-[var(--cyan)] font-mono">{s.name}</td>
                  <td className="text-[var(--text-secondary)]">{s.signal}</td>
                  <td className="text-[var(--text-secondary)]">{s.best}</td>
                  <td className="text-[var(--text-secondary)] font-mono">{s.weight}</td>
                  <td><span className="flex items-center gap-1.5"><span className="status-dot online" /><span className="text-[var(--green)] text-[10px]">{s.status}</span></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
