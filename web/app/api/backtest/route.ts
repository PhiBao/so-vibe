import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { Backtester, runParameterSweep } from "@/lib/engine/backtest.js";
import { getCachedSentiment } from "@/lib/sentiment-engine";
import { getETFSignal } from "@/lib/sosovalue/etf";
import { getMacroSignal } from "@/lib/sosovalue/macro";
import { analyzeFunding } from "@/lib/engine/funding.js";
import { sanitizeError } from "@/lib/api-error";
import { applyRequestNetwork } from "@/lib/request-network";

const SOSO_BASE = "https://openapi.sosovalue.com/openapi/v1";
const API_KEY = process.env.SOSO_API_KEY || "";

const SYMBOL_TO_CURRENCY_ID: Record<string, string> = {
  SOL: "1673723677362319871",
  ETH: "1673723677362319870",
  BTC: "1673723677362319867",
};

async function fetchSoSoValueDaily(symbol: string, limit = 200): Promise<any[]> {
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
  if (!Array.isArray(list)) return [];

  return list.map((d: any) => ({
    timestamp: typeof d.timestamp === "number" ? d.timestamp : parseInt(d.timestamp),
    open: parseFloat(d.open),
    high: parseFloat(d.high),
    low: parseFloat(d.low),
    close: parseFloat(d.close),
    volume: parseFloat(d.volume),
  }));
}

function getStrategyEnabled(strategyConfig: Record<string, any> | undefined, key: string) {
  if (!strategyConfig) return true;
  const cfg = strategyConfig[key];
  return !cfg || cfg.enabled !== false;
}

export async function POST(request: Request) {
  applyRequestNetwork(request);
  const body = await request.json();
  const {
    symbol,
    leverage = 2,
    dataSource = "sodex",
    slippageBps = 3,
    confidenceThreshold = 0.55,
    strategyConfig = {},
    maxPositionPct = 0.3,
    parameterSweep = false,
  } = body;

  if (!symbol || typeof leverage !== "number") {
    return NextResponse.json({ error: "Missing symbol or leverage" }, { status: 400 });
  }

  try {
    await initDex();
    const adapter = getAdapter();
    let candles: any[] = [];
    let dataSourceLabel = "";
    let barIntervalHours = 1;

    if (dataSource === "sodex") {
      candles = await adapter.getCandles(symbol, "1h", 1000);
      dataSourceLabel = "SoDEX 1h";
      barIntervalHours = 1;
    } else if (dataSource === "sosovalue") {
      candles = await fetchSoSoValueDaily(symbol, 200);
      dataSourceLabel = "SoSoValue 1d";
      barIntervalHours = 24;
    } else if (dataSource === "combined") {
      // Run both and return both results
      const [sodexCandles, soSoCandles] = await Promise.all([
        adapter.getCandles(symbol, "1h", 1000).catch(() => []),
        fetchSoSoValueDaily(symbol, 200),
      ]);
      const runOne = (c: any[], label: string, intervalHours: number) => {
        if (!c || c.length < 100) return null;
        const bt = new Backtester({
          leverage,
          slippageBps,
          confidenceThreshold,
          strategyConfig,
          maxPositionPct,
          barIntervalHours: intervalHours,
        });
        return { label, ...bt.run(c), candlesUsed: c.length };
      };
      return NextResponse.json({
        combined: true,
        results: [
          runOne(sodexCandles, "SoDEX 1h", 1),
          runOne(soSoCandles, "SoSoValue 1d", 24),
        ].filter(Boolean),
      });
    }

    if (!candles || candles.length < 100) {
      return NextResponse.json({ error: `Insufficient real data from ${dataSourceLabel}` }, { status: 400 });
    }

    // Gather current full-swarm signals (static across the backtest)
    const baseSym = symbol.split("-")[0];
    const sentiment = getStrategyEnabled(strategyConfig, "sosovalue_sentiment")
      ? (await getCachedSentiment([baseSym]))[baseSym] || null
      : null;
    const etfFlow = getStrategyEnabled(strategyConfig, "etf_flow")
      ? (await getETFSignal(baseSym).catch(() => null))
      : null;
    const fundingRate = await adapter.getFundingRate(symbol).catch(() => null);
    const funding = fundingRate ? analyzeFunding([fundingRate], candles[candles.length - 1].close) : null;
    const macroSignal = await getMacroSignal().catch(() => ({ signal: 0, confidence: 0 }));

    const baseConfig = {
      leverage,
      slippageBps,
      confidenceThreshold,
      strategyConfig,
      maxPositionPct,
      barIntervalHours,
      sentiment,
      etfFlow,
      funding,
      macroSignal,
    };

    const backtester = new Backtester(baseConfig);
    const result = backtester.run(candles);

    let sweep = null;
    if (parameterSweep) {
      sweep = runParameterSweep(candles, baseConfig);
    }

    return NextResponse.json({
      ...result,
      dataSource: dataSourceLabel,
      candlesUsed: candles.length,
      parameterSweep: sweep,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
