"use client";
import { useState, useEffect } from "react";

interface ParameterRow {
  leverage: number;
  confidenceThreshold: number;
  totalReturn: string;
  sharpe: string;
  maxDrawdown: string;
  winRate: string;
  profitFactor: string;
  totalTrades: number;
  expectancy: string;
}

interface BacktestResult {
  totalReturn: string;
  annualReturn: string;
  sharpe: string;
  sortino: string;
  maxDrawdown: string;
  totalTrades: number;
  winRate: string;
  profitFactor: string;
  avgWin: string;
  avgLoss: string;
  maxConsecutiveLosses: number;
  finalCapital: string;
  expectancy: string;
  falsePositiveRate: string;
  avgBarsToTP: string;
  avgBarsToSL: string;
  exitReasons: Record<string, number>;
  dataSource: string;
  candlesUsed: number;
  parameterSweep: ParameterRow[] | null;
  combined?: boolean;
  error?: string;
}

const DATA_SOURCES = [
  { key: "sodex", label: "SoDEX 1h" },
  { key: "sosovalue", label: "SoSoValue 1d" },
  { key: "combined", label: "Combined" },
];

export default function BacktestPage() {
  const [symbol, setSymbol] = useState("SOL-USD");
  const [leverage, setLeverage] = useState(20);
  const [dataSource, setDataSource] = useState<"sodex" | "sosovalue" | "combined">("sodex");
  const [slippageBps, setSlippageBps] = useState(3);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.55);
  const [parameterSweep, setParameterSweep] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
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
        body: JSON.stringify({
          symbol,
          leverage,
          dataSource,
          slippageBps,
          confidenceThreshold,
          parameterSweep,
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ error: "Backtest engine failed" } as any);
    }
    setRunning(false);
  };

  const renderResult = (r: BacktestResult, key: string) => (
    <div key={key} className="space-y-4">
      <div className="terminal-card p-4 border-l-2 border-l-[var(--cyan)]">
        <div className="text-[11px] font-mono text-[var(--text-secondary)]">
          Data source: <span className="text-[var(--cyan)]">{r.dataSource}</span> · {r.candlesUsed} candles · {r.totalTrades} trades · slippage {slippageBps} bps
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Return", value: r.totalReturn, color: r.totalReturn.startsWith("-") ? "text-[var(--red)]" : "text-[var(--green)]" },
          { label: "Sharpe", value: r.sharpe },
          { label: "Max Drawdown", value: r.maxDrawdown, color: "text-[var(--red)]" },
          { label: "Win Rate", value: r.winRate },
          { label: "Profit Factor", value: r.profitFactor },
          { label: "Expectancy", value: r.expectancy },
          { label: "False Positive", value: r.falsePositiveRate },
          { label: "Final Capital", value: r.finalCapital },
        ].map((m) => (
          <div key={m.label} className="terminal-card text-center p-3">
            <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">{m.label}</div>
            <div className={`text-lg font-bold font-mono ${m.color || ""}`}>{m.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="terminal-card text-center p-3">
          <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Avg Win</div>
          <div className="text-lg font-bold font-mono text-[var(--green)]">{r.avgWin}</div>
        </div>
        <div className="terminal-card text-center p-3">
          <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Avg Loss</div>
          <div className="text-lg font-bold font-mono text-[var(--red)]">{r.avgLoss}</div>
        </div>
        <div className="terminal-card text-center p-3">
          <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Avg Bars to TP</div>
          <div className="text-lg font-bold font-mono">{r.avgBarsToTP}</div>
        </div>
        <div className="terminal-card text-center p-3">
          <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Avg Bars to SL</div>
          <div className="text-lg font-bold font-mono">{r.avgBarsToSL}</div>
        </div>
      </div>

      {r.exitReasons && Object.keys(r.exitReasons).length > 0 && (
        <div className="terminal-card p-4">
          <div className="text-[12px] font-bold tracking-wider text-[var(--cyan)] mb-3">EXIT_REASONS</div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(r.exitReasons).map(([reason, count]) => (
              <span key={reason} className="text-[11px] font-mono px-3 py-1 border border-[var(--border)] bg-white/[0.02]">
                {reason}: <span className="text-[var(--cyan)] font-bold">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {r.parameterSweep && r.parameterSweep.length > 0 && (
        <div className="terminal-card p-4">
          <div className="text-[12px] font-bold tracking-wider text-[var(--cyan)] mb-3">PARAMETER_SWEEP (sorted by Sharpe)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono text-left">
              <thead>
                <tr className="text-[var(--text-secondary)] border-b border-[var(--border)]">
                  <th className="py-2">Lev</th>
                  <th className="py-2">Conf</th>
                  <th className="py-2">Return</th>
                  <th className="py-2">Sharpe</th>
                  <th className="py-2">Max DD</th>
                  <th className="py-2">Win%</th>
                  <th className="py-2">PF</th>
                  <th className="py-2">Trades</th>
                  <th className="py-2">Expectancy</th>
                </tr>
              </thead>
              <tbody>
                {r.parameterSweep.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--border)]/50">
                    <td className="py-1.5">{row.leverage}x</td>
                    <td className="py-1.5">{(row.confidenceThreshold * 100).toFixed(0)}%</td>
                    <td className="py-1.5">{row.totalReturn}</td>
                    <td className="py-1.5 text-[var(--cyan)]">{row.sharpe}</td>
                    <td className="py-1.5 text-[var(--red)]">{row.maxDrawdown}</td>
                    <td className="py-1.5">{row.winRate}</td>
                    <td className="py-1.5">{row.profitFactor}</td>
                    <td className="py-1.5">{row.totalTrades}</td>
                    <td className="py-1.5">{row.expectancy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in">
      <div>
        <h1 className="text-xl font-bold text-[var(--cyan)] glow-cyan tracking-wider">BACKTEST_ENGINE</h1>
        <p className="text-[12px] text-[var(--text-secondary)] font-mono mt-1">Real data only · full swarm · slippage modeling · exit analysis</p>
      </div>

      {/* Config */}
      <div className="terminal-card">
        <div className="terminal-header">
          <span className="text-[12px] font-bold tracking-wider">PARAMETERS</span>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-2 block">Market</label>
            <div className="relative">
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="terminal-input w-full text-[13px] font-mono py-2 appearance-none cursor-pointer"
              >
                {symbolList.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-secondary)] pointer-events-none">▼</span>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-2 block">Data Source</label>
            <div className="relative">
              <select
                value={dataSource}
                onChange={(e) => setDataSource(e.target.value as any)}
                className="terminal-input w-full text-[13px] font-mono py-2 appearance-none cursor-pointer"
              >
                {DATA_SOURCES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-secondary)] pointer-events-none">▼</span>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-2 block">Slippage: {slippageBps} bps</label>
            <input type="range" min={0} max={15} step={1} value={slippageBps} onChange={(e) => setSlippageBps(parseInt(e.target.value))} className="w-full" />
            <div className="flex justify-between text-[10px] text-[var(--text-secondary)] font-mono mt-1"><span>0</span><span>7</span><span>15</span></div>
          </div>

          <div>
            <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-2 block">Confidence: {(confidenceThreshold * 100).toFixed(0)}%</label>
            <input type="range" min={50} max={70} step={5} value={confidenceThreshold * 100} onChange={(e) => setConfidenceThreshold(parseInt(e.target.value) / 100)} className="w-full" />
          </div>

          <div>
            <label className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-2 block">Leverage: {leverage}x</label>
            <input type="range" min={1} max={20} value={leverage} onChange={(e) => setLeverage(parseInt(e.target.value))} className="w-full" />
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)] font-mono cursor-pointer">
              <input
                type="checkbox"
                checked={parameterSweep}
                onChange={(e) => setParameterSweep(e.target.checked)}
                className="accent-[var(--cyan)]"
              />
              Parameter sweep
            </label>
          </div>

          <div className="flex items-end col-span-2 md:col-span-1">
            <button onClick={runBacktest} disabled={running} className="btn-terminal btn-terminal-green w-full text-[13px] py-2.5 font-bold">
              {running ? "RUNNING..." : "[ EXECUTE ]"}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {result && !result.error && !result.combined && renderResult(result, "main")}

      {result && !result.error && result.combined && (
        <div className="space-y-6">
          {(result as any).results.map((r: BacktestResult, i: number) => renderResult(r, `combined_${i}`))}
        </div>
      )}

      {result?.error && (
        <div className="terminal-card p-4 border border-[var(--red)] text-[var(--red)] font-mono text-[13px]">
          [ERR] {result.error}
        </div>
      )}

      {!result && !running && (
        <div className="terminal-card text-center py-12">
          <div className="text-[var(--cyan)] text-3xl mb-2 font-mono">&gt;_</div>
          <div className="text-[14px] text-[var(--text-secondary)] font-mono">Configure and run a backtest to see results</div>
          <div className="text-[11px] text-[var(--text-secondary)] font-mono mt-2">
            No synthetic candles — only real SoDEX or SoSoValue data
          </div>
        </div>
      )}
    </div>
  );
}
