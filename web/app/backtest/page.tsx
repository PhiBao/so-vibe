"use client";
import { useState, useEffect } from "react";

export default function BacktestPage() {
  const [symbol, setSymbol] = useState("SOL-USD");
  const [leverage, setLeverage] = useState(20);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ error?: string; totalReturn?: string; sharpe?: string; sortino?: string; maxDrawdown?: string; winRate?: string; profitFactor?: string; totalTrades?: number; avgWin?: string; avgLoss?: string; finalCapital?: string } | null>(null);
  const [symbolList, setSymbolList] = useState<string[]>(["SOL-USD", "ETH-USD", "BTC-USD"]);

  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const res = await fetch("/api/markets");
        const data = await res.json();
        if (data.markets) {
          const symbols = Object.keys(data.markets).sort();
          if (symbols.length > 0) setSymbolList(symbols);
        }
      } catch {}
    };
    fetchSymbols();
  }, []);

  const runBacktest = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, leverage }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ error: "Backtest engine failed" });
    }
    setRunning(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in">
      <div>
        <h1 className="text-lg font-bold text-[var(--cyan)] glow-cyan tracking-wider">BACKTEST_ENGINE</h1>
        <p className="text-[11px] text-[var(--text-secondary)] font-mono mt-1">Test strategies on historical data</p>
      </div>

      {/* Config */}
      <div className="terminal-card">
        <div className="terminal-header">
          <span className="text-[11px] font-bold tracking-wider">PARAMETERS</span>
        </div>
        <div className="p-4 grid grid-cols-3 gap-4">
            <div>
            <label className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-2 block">Market</label>
            <div className="relative">
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="terminal-input w-full text-[12px] font-mono py-2 appearance-none cursor-pointer"
              >
                {symbolList.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-secondary)] pointer-events-none">▼</span>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-2 block">Leverage: {leverage}x</label>
            <input type="range" min={1} max={20} value={leverage} onChange={(e) => setLeverage(parseInt(e.target.value))} className="w-full" />
            <div className="flex justify-between text-[9px] text-[var(--text-secondary)] font-mono mt-1"><span>1x</span><span>10x</span><span>20x</span></div>
          </div>
          <div className="flex items-end">
            <button onClick={runBacktest} disabled={running} className="btn-terminal btn-terminal-green w-full text-[12px] py-2.5 font-bold">
              {running ? "RUNNING..." : "[ EXECUTE ]"}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {result && !result.error && (
        <div className="space-y-4 animate-in">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Total Return</div>
              <div className="text-lg font-bold font-mono text-[var(--green)]">{result.totalReturn as string}</div>
            </div>
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Sharpe Ratio</div>
              <div className="text-lg font-bold font-mono">{result.sharpe as string}</div>
            </div>
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Max Drawdown</div>
              <div className="text-lg font-bold font-mono text-[var(--red)]">{result.maxDrawdown as string}</div>
            </div>
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Win Rate</div>
              <div className="text-lg font-bold font-mono">{result.winRate as string}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Profit Factor</div>
              <div className="text-lg font-bold font-mono">{result.profitFactor as string}</div>
            </div>
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Total Trades</div>
              <div className="text-lg font-bold font-mono">{result.totalTrades as number}</div>
            </div>
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Avg Win</div>
              <div className="text-lg font-bold font-mono text-[var(--green)]">{result.avgWin as string}</div>
            </div>
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Final Capital</div>
              <div className="text-lg font-bold font-mono">{result.finalCapital as string}</div>
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] text-[var(--text-secondary)] font-mono">
              Backtest executed on {result.totalTrades as number} trades using 6-strategy swarm synthesis.
            </div>
          </div>
        </div>
      )}

      {result?.error && (
        <div className="terminal-card p-4 border border-[var(--red)] text-[var(--red)] font-mono text-[12px]">
          [ERR] {result.error as string}
        </div>
      )}

      {!result && !running && (
        <div className="terminal-card text-center py-12">
          <div className="text-[var(--cyan)] text-2xl mb-2 font-mono">&gt;_</div>
          <div className="text-[13px] text-[var(--text-secondary)] font-mono">Configure and run a backtest to see results</div>
          <div className="text-[10px] text-[var(--text-secondary)] font-mono mt-1">Uses historical candles with 6-strategy swarm</div>
        </div>
      )}
    </div>
  );
}
