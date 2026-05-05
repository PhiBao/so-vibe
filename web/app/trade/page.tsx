"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { useSodexTx } from "@/lib/use-sodex-tx";
import { useToast } from "@/components/ToastProvider";

interface MarketLimit {
  maxLeverage: number;
  takerFee: number;
  makerFee: number;
  isolatedOnly: boolean;
}

function TradeContent() {
  const searchParams = useSearchParams();
  const defaultSymbol = searchParams.get("symbol") || "SOL-USD";
  const { address, isConnected } = useAccount();
  const { sendInstructions, needsNetworkSwitch, walletChainId } = useSodexTx();
  const { addToast } = useToast();

  const [symbol, setSymbol] = useState(defaultSymbol);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [sizeUnits, setSizeUnits] = useState(0);
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [market, setMarket] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [marketLimits, setMarketLimits] = useState<Record<string, MarketLimit>>({});
  const [symbolList, setSymbolList] = useState<string[]>(["SOL-USD", "ETH-USD", "BTC-USD"]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const price = (market?.price as number) || 0;
  const marketLimit = marketLimits[symbol];
  const maxLeverage = marketLimit?.maxLeverage || 10;

  // Max units = balance * maxLeverage / price
  // Cap at $2,000 notional for testnet liquidity
  const maxUnits = price > 0 && walletBalance > 0
    ? Math.min((walletBalance * maxLeverage) / price, 2000 / price)
    : 0;

  const notional = sizeUnits * price;
  const effectiveLeverage = walletBalance > 0 ? notional / walletBalance : 0;
  const marginUsed = walletBalance > 0 ? notional / maxLeverage : 0;

  useEffect(() => {
    const fetchMarket = async () => {
      try {
        const res = await fetch(`/api/market?symbol=${symbol}`);
        const data = await res.json();
        setMarket(data);
        if (data.price) {
          const p = data.price as number;
          const atr = p * 0.02;
          setStopLoss(side === "buy" ? (p - atr * 1.5).toFixed(2) : (p + atr * 1.5).toFixed(2));
          setTakeProfit(side === "buy" ? (p + atr * 3).toFixed(2) : (p - atr * 3).toFixed(2));
        }
      } catch {}
    };
    fetchMarket();
  }, [symbol, side]);

  useEffect(() => {
    const fetchLimits = async () => {
      try {
        const res = await fetch("/api/markets");
        const data = await res.json();
        if (data.markets) {
          setMarketLimits(data.markets);
          const symbols = Object.keys(data.markets).sort();
          if (symbols.length > 0) setSymbolList(symbols);
        }
      } catch {}
    };
    fetchLimits();
  }, []);

  useEffect(() => {
    if (!isConnected || !address) { setWalletBalance(0); return; }
    const fetchBalance = async () => {
      try {
        const res = await fetch(`/api/wallet/balance?address=${address}`);
        const data = await res.json();
        setWalletBalance(data.usdc || 0);
      } catch {}
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [isConnected, address]);

  const handleMax = () => {
    if (maxUnits > 0) setSizeUnits(maxUnits);
  };

  const handleSubmit = async () => {
    if (!sizeUnits || !price) return;
    if (!isConnected) { setResult("[ERR] Connect wallet first"); return; }
    setSubmitting(true);
    setResult(null);
    try {
      // Phase 1: Market order
      // Add 5% slippage buffer so market order crosses the spread
      const slippagePrice = side === "buy" ? price * 1.05 : price * 0.95;
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol, side,
          size: sizeUnits,
          price: slippagePrice,
          leverage: maxLeverage,
          wallet: address,
        }),
      });
      const data = await res.json();
      if (!data.success || !data.action) {
        setResult(`[ERR] ${data.error || "Failed to build order"}`);
        addToast(data.error || "Failed to build order", "error");
        setSubmitting(false);
        return;
      }

      setResult("[OK] Building transaction... Please sign in your wallet");
      const result = await sendInstructions(data.action);
      if (!result.success) {
        setResult(`[ERR] ${result.error || "Transaction failed"}`);
        addToast(result.error || "Transaction failed", "error");
        setSubmitting(false);
        return;
      }

      const orderData = (result.data as any)?.data?.[0];
      const orderState = orderData?.state;
      const orderMsg = orderData?.msg;
      if (orderState !== undefined && orderState !== 2) {
        setResult(`[OK] Order submitted (state: ${orderState}${orderMsg ? ` — ${orderMsg}` : ""}). Position may take a moment to appear on testnet.`);
      } else {
        setResult(`[OK] ${side === "buy" ? "LONG" : "SHORT"} ${sizeUnits.toFixed(4)} ${symbol} @ $${price.toFixed(2)}`);
      }
      addToast(`${side === "buy" ? "LONG" : "SHORT"} ${sizeUnits.toFixed(4)} ${symbol} submitted`, "success");

      // Phase 2: SL/TP conditional order (after position is open)
      const hasSlTp = stopLoss || takeProfit;
      if (hasSlTp && address) {
        try {
          await new Promise((r) => setTimeout(r, 5000)); // wait 5s for position to settle on testnet
          const sltpRes = await fetch("/api/positions/sl-tp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol,
              side,
              stopLoss: stopLoss ? parseFloat(stopLoss) : null,
              takeProfit: takeProfit ? parseFloat(takeProfit) : null,
              wallet: address,
              size: sizeUnits,
            }),
          });
          const sltpData = await sltpRes.json();
          if (sltpData.success && sltpData.actions) {
            for (let i = 0; i < sltpData.actions.length; i++) {
              const action = sltpData.actions[i];
              // Stagger nonces by 100ms to avoid "nonce already used"
              if (i > 0) await new Promise((r) => setTimeout(r, 100));
              const sltpResult = await sendInstructions(action);
              if (sltpResult.success) {
                setResult((prev) => `${prev}\n[OK] SL/TP set`);
                addToast("SL/TP set successfully", "success");
              } else {
                addToast(sltpResult.error || "SL/TP failed", "error");
              }
            }
          }
        } catch {
          // SL/TP failed silently
        }
      }

      setSizeUnits(0);
    } catch (err: any) {
      const msg = err?.message || err?.error || String(err);
      console.error("[Trade] execution error:", err);
      setResult(`[ERR] ${msg}`);
      addToast(msg, "error");
    }
    setSubmitting(false);
  };

  const rsi = (market?.rsi as string) || "—";
  const trend = (market?.trend as string) || "unknown";
  const ema = (market?.ema as Record<string, number>) || {};

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in">
      <div>
        <h1 className="text-lg font-bold text-[var(--cyan)] glow-cyan tracking-wider">TRADE_EXECUTION</h1>
        <p className="text-[11px] text-[var(--text-secondary)] font-mono mt-1">SoDEX perpetuals — sign transactions with your wallet</p>
        {mounted && isConnected && address && (
          <div className="mt-2 text-[10px] font-mono text-[var(--text-secondary)]">
            <span className="text-[var(--cyan)]">WALLET:</span> {address} | <span className="text-[var(--cyan)]">CHAIN:</span> {walletChainId} {needsNetworkSwitch ? "(WRONG)" : "(OK)"}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6 items-start">
        {/* Order Form */}
        <div className="terminal-card space-y-4 sticky top-4">
          <div className="terminal-header">
            <span className="text-[11px] font-bold tracking-wider">ORDER_PACKET</span>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-2 block">Market</label>
              <div className="relative">
                <select
                  value={symbol}
                  onChange={(e) => { setSymbol(e.target.value); setSizeUnits(0); }}
                  className="terminal-input w-full text-[12px] font-mono py-2 appearance-none cursor-pointer"
                >
                  {symbolList.map((s) => (
                    <option key={s} value={s}>
                      {s} ({marketLimits[s]?.maxLeverage || "?"}x)
                    </option>
                  ))}
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-secondary)] pointer-events-none">▼</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1">
              <button onClick={() => setSide("buy")} className={`py-2.5 text-[12px] font-mono font-bold transition-all border ${side === "buy" ? "border-[var(--green)] text-black bg-[var(--green)]" : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--green)]/50"}`}>LONG</button>
              <button onClick={() => setSide("sell")} className={`py-2.5 text-[12px] font-mono font-bold transition-all border ${side === "sell" ? "border-[var(--red)] text-white bg-[var(--red)]" : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--red)]/50"}`}>SHORT</button>
            </div>

            {/* Order Size Slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em]">Order Size</label>
                <div className="text-right">
                  <div className="text-[16px] font-bold font-mono text-white">{sizeUnits.toFixed(4)}</div>
                  <div className="text-[10px] text-[var(--text-secondary)] font-mono">${notional.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={maxUnits}
                  step={maxUnits / 100}
                  value={sizeUnits}
                  onChange={(e) => setSizeUnits(parseFloat(e.target.value))}
                  className="flex-1"
                  disabled={maxUnits <= 0}
                />
                <button
                  onClick={handleMax}
                  disabled={maxUnits <= 0}
                  className="px-3 py-1.5 text-[10px] font-mono border border-[var(--border)] hover:border-[var(--cyan)]/50 text-[var(--text-secondary)] transition-colors disabled:opacity-40"
                >
                  MAX
                </button>
              </div>
              <div className="flex justify-between text-[9px] text-[var(--text-secondary)] font-mono mt-1">
                <span>0</span>
                <span>{(maxUnits / 2).toFixed(2)}</span>
                <span>{maxUnits.toFixed(2)} {symbol}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-1 block">Stop Loss</label>
                <input type="number" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="terminal-input w-full text-[11px]" />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-1 block">Take Profit</label>
                <input type="number" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} className="terminal-input w-full text-[11px]" />
              </div>
            </div>

            <div className="p-3 border border-[var(--border)] bg-black/20 space-y-1.5 text-[11px] font-mono">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Notional</span>
                <span>${notional.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Margin Used</span>
                <span>${marginUsed.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Effective Lev</span>
                <span className={effectiveLeverage > maxLeverage * 0.9 ? "text-[var(--red)]" : "text-[var(--cyan)]"}>
                  {effectiveLeverage.toFixed(1)}x / {maxLeverage}x max
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Liq. Price (est)</span>
                <span className="text-[var(--yellow)]">
                  ~${side === "buy"
                    ? (price * (1 - 1 / Math.max(effectiveLeverage, 1) * 0.9)).toFixed(2)
                    : (price * (1 + 1 / Math.max(effectiveLeverage, 1) * 0.9)).toFixed(2)}
                </span>
              </div>
              {walletBalance > 0 && (
                <div className="flex justify-between border-t border-[var(--border)] pt-1.5 mt-1">
                  <span className="text-[var(--text-secondary)]">Balance</span>
                  <span className="text-[var(--cyan)]">${walletBalance.toFixed(2)} USDC</span>
                </div>
              )}
            </div>

            {isConnected && needsNetworkSwitch && (
              <div className="p-2 border border-[var(--yellow)]/30 bg-[var(--yellow)]/5 text-[var(--yellow)] text-[10px] font-mono">
                <div>⚠ MetaMask is on chain {walletChainId}. SoDEX requires chain 138565.</div>
                <div>Add SoDEX Testnet manually: MetaMask → Settings → Networks → Add Network</div>
                <div>Name: SoDEX Testnet | Chain ID: 138565 | Currency: SOSO</div>
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={submitting || sizeUnits <= 0 || !price || (isConnected && needsNetworkSwitch)}
              className={`w-full py-3 text-[13px] font-mono font-bold transition-all disabled:opacity-40 border ${side === "buy" ? "border-[var(--green)] text-black bg-[var(--green)] hover:opacity-90" : "border-[var(--red)] text-white bg-[var(--red)] hover:opacity-90"}`}
            >
              {!mounted ? "LOADING..." : !isConnected ? "[ CONNECT WALLET ]" : needsNetworkSwitch ? "[ WRONG NETWORK ]" : submitting ? "SIGNING..." : `${side === "buy" ? "LONG" : "SHORT"} ${symbol}`}
            </button>

            {result && (
              <div className={`p-3 text-[11px] font-mono border ${result.startsWith("[OK]") ? "border-[var(--green)] text-[var(--green)] bg-[var(--green)]/5" : "border-[var(--red)] text-[var(--red)] bg-[var(--red)]/5"}`}>
                {result}
              </div>
            )}
          </div>
        </div>

        {/* Market Info */}
        <div className="col-span-2 space-y-4">
          <div className="terminal-card">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-[var(--cyan)]">{symbol}</span>
                <div>
                  <div className="text-[11px] text-[var(--text-secondary)]">SODEX-PERP</div>
                  <div className="text-[10px] text-[var(--text-secondary)]">Max leverage: {maxLeverage}x · {marketLimit?.takerFee ? (marketLimit.takerFee * 10000).toFixed(1) : "3.5"} bps taker</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold font-mono">${price.toFixed(2)}</div>
                <div className={`text-[12px] font-mono ${trend === "bullish" ? "text-[var(--green)]" : trend === "bearish" ? "text-[var(--red)]" : "text-[var(--text-tertiary)]"}`}>
                  {trend === "bullish" ? "▲ BULLISH" : trend === "bearish" ? "▼ BEARISH" : "● NEUTRAL"}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">RSI (14)</div>
              <div className="text-lg font-bold font-mono" style={{ color: parseFloat(rsi) < 30 ? "var(--green)" : parseFloat(rsi) > 70 ? "var(--red)" : "var(--text)" }}>{rsi}</div>
            </div>
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">Trend</div>
              <div className={`text-lg font-bold font-mono ${trend === "bullish" ? "text-[var(--green)]" : trend === "bearish" ? "text-[var(--red)]" : "text-[var(--text)]"}`}>{trend.toUpperCase()}</div>
            </div>
            <div className="terminal-card text-center p-3">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">EMA</div>
              <div className="text-[10px] font-mono text-[var(--text-secondary)]">
                9:{ema.ema9?.toFixed(1) || "—"} 21:{ema.ema21?.toFixed(1) || "—"}
              </div>
            </div>
          </div>

          <div className="terminal-card">
            <div className="terminal-header">
              <span className="text-[11px] font-bold tracking-wider">ORDER_BOOK_L2</span>
              <span className="text-[10px] text-[var(--text-secondary)] ml-auto">spread: {price > 0 ? "0.02%" : "—"}</span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] text-[var(--green)] uppercase tracking-wider mb-2 font-bold">Bids</div>
                {((market?.book as Record<string, unknown>)?.bids as number[][])?.slice(0, 5).map((bid: number[], i: number) => (
                  <div key={i} className="flex justify-between py-1 text-[11px] font-mono">
                    <span className="text-[var(--green)]">${bid[0]?.toFixed(2)}</span>
                    <span className="text-[var(--text-secondary)]">{bid[1]?.toFixed(4)}</span>
                  </div>
                )) || <div className="text-[11px] text-[var(--text-secondary)] font-mono">Loading...</div>}
              </div>
              <div>
                <div className="text-[10px] text-[var(--red)] uppercase tracking-wider mb-2 font-bold">Asks</div>
                {((market?.book as Record<string, unknown>)?.asks as number[][])?.slice(0, 5).map((ask: number[], i: number) => (
                  <div key={i} className="flex justify-between py-1 text-[11px] font-mono">
                    <span className="text-[var(--red)]">${ask[0]?.toFixed(2)}</span>
                    <span className="text-[var(--text-secondary)]">{ask[1]?.toFixed(4)}</span>
                  </div>
                )) || <div className="text-[11px] text-[var(--text-secondary)] font-mono">Loading...</div>}
              </div>
            </div>
          </div>

          <div className="terminal-card">
            <div className="terminal-header">
              <span className="text-[11px] font-bold tracking-wider">RECENT_CANDLES</span>
              <span className="text-[10px] text-[var(--text-secondary)] ml-auto">1h timeframe</span>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th className="text-right">Open</th>
                    <th className="text-right">High</th>
                    <th className="text-right">Low</th>
                    <th className="text-right">Close</th>
                    <th className="text-right">Vol</th>
                  </tr>
                </thead>
                <tbody>
                  {((market?.candles as Array<Record<string, unknown>>)?.slice(-8).reverse() || []).map((c: Record<string, unknown>, i: number) => {
                    const o = c.open as number; const cl = c.close as number;
                    return (
                      <tr key={i}>
                        <td className="text-[var(--text-secondary)]">{new Date((c.time as number) || 0).toLocaleTimeString()}</td>
                        <td className="text-right">${o?.toFixed(2)}</td>
                        <td className="text-right">${(c.high as number)?.toFixed(2)}</td>
                        <td className="text-right">${(c.low as number)?.toFixed(2)}</td>
                        <td className={`text-right ${cl >= o ? "text-[var(--green)]" : "text-[var(--red)]"}`}>${cl?.toFixed(2)}</td>
                        <td className="text-right text-[var(--text-secondary)]">{(c.volume as number)?.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[80vh] text-[var(--text-secondary)] font-mono">
        <span className="text-[var(--cyan)]">&gt;</span> loading trade module...<span className="animate-blink">_</span>
      </div>
    }>
      <TradeContent />
    </Suspense>
  );
}
