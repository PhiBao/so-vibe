import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { Backtester } from "@/lib/engine/backtest.js";

export async function POST(request: Request) {
  const body = await request.json();
  const { symbol, leverage } = body;

  if (!symbol || typeof leverage !== "number") {
    return NextResponse.json({ error: "Missing symbol or leverage" }, { status: 400 });
  }

  try {
    await initDex();
    const adapter = getAdapter();
    const candles = await adapter.getCandles(symbol, "1h", 1000);

    if (candles.length < 100) {
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

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
