import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { Backtester } from "@/lib/engine/backtest.js";

const SOSO_BASE = "https://openapi.sosovalue.com/openapi/v1";
const API_KEY = process.env.SOSO_API_KEY || "";

const SYMBOL_TO_CURRENCY_ID: Record<string, string> = {
  SOL: "1673723677362319871",
  ETH: "1673723677362319870",
  BTC: "1673723677362319867",
};

async function fetchSoSoValueKlines(symbol: string, limit = 200): Promise<any[]> {
  try {
    const base = symbol.split("-")[0];
    const currencyId = SYMBOL_TO_CURRENCY_ID[base];
    if (!currencyId) return [];

    const res = await fetch(
      `${SOSO_BASE}/currencies/${currencyId}/klines?interval=1d&limit=${limit}`,
      { headers: { "Content-Type": "application/json", "x-soso-api-key": API_KEY } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const list = data?.data?.list || data?.data || data || [];
    if (!Array.isArray(list) || list.length === 0) return [];

    // Convert 1d klines to 1h by expanding each day into 24 hourly bars
    const hourly: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }> = [];
    for (const day of list) {
      const { open, high, low, close, volume, timestamp } = day;
      const dayVolPerHour = (volume || 0) / 24;
      const range = high - low;
      const ts = typeof timestamp === "number" ? timestamp : parseInt(timestamp);
      for (let h = 0; h < 24; h++) {
        const barTs = ts + h * 3600000;
        const progress = h / 24;
        // Simulate intraday movement with small random walk within day range
        const midPrice = open + (close - open) * progress;
        const noise = (Math.random() - 0.5) * range * 0.3;
        const barClose = midPrice + noise;
        const prevClose = hourly.length > 0 ? hourly[hourly.length - 1].close : open;
        const barOpen = h === 0 ? open : prevClose;
        hourly.push({
          timestamp: barTs,
          open: barOpen,
          high: Math.max(barOpen, barClose) + Math.random() * range * 0.15,
          low: Math.min(barOpen, barClose) - Math.random() * range * 0.15,
          close: barClose,
          volume: dayVolPerHour * (0.5 + Math.random()),
        });
      }
    }
    return hourly;
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const { symbol, leverage, dataSource } = body;

  if (!symbol || typeof leverage !== "number") {
    return NextResponse.json({ error: "Missing symbol or leverage" }, { status: 400 });
  }

  try {
    await initDex();
    const adapter = getAdapter();
    let candles;
    let dataSourceLabel = "SoDEX";

    if (dataSource === "sosovalue") {
      candles = await fetchSoSoValueKlines(symbol, 42); // 42 days → ~1000 hourly bars
      if (!candles || candles.length < 100) {
        candles = null; // fall through to SoDEX
      } else {
        dataSourceLabel = "SoSoValue (1d → 1h synthetic)";
      }
    }

    if (!candles) {
      try {
        candles = await adapter.getCandles(symbol, "1h", 1000);
        dataSourceLabel = "SoDEX testnet";
      } catch {
        const { generateSyntheticCandles } = await import("@/lib/dex/sodex-adapter");
        candles = generateSyntheticCandles(symbol, 1000);
        dataSourceLabel = "Synthetic (fallback)";
      }
    }

    if (!candles || candles.length < 100) {
      return NextResponse.json({ error: "Insufficient candle data" }, { status: 400 });
    }

    const backtester = new Backtester({
      initialCapital: 10000,
      leverage,
      takerFee: 0.0005,
      makerFee: 0.0002,
      slippage: 0.0003,
      fundingRate: 0.0001,
      maxPositionPct: 0.3,
      commission: 0.001,
    });

    const result = backtester.run(candles, "swarm");

    return NextResponse.json({
      ...result,
      dataSource: dataSourceLabel,
      candlesUsed: candles.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
