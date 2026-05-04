import { NextResponse } from "next/server";
import { initDex, getAdapter } from "@/lib/dex";
import * as soso from "@/lib/sosovalue";

export async function GET() {
  const results: Record<string, unknown> = {};

  // Test 1: SoDEX testnet market data
  try {
    await initDex();
    const adapter = getAdapter();
    const markets = await adapter.getMarkets();
    const candles = await adapter.getCandles("SOL", "1h", 10);
    const price = await adapter.getCurrentPrice("SOL");
    results.sodex = {
      ok: true,
      markets: markets.map((m) => m.symbol),
      candles: candles.length,
      solPrice: price,
    };
  } catch (err: unknown) {
    results.sodex = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Test 2: SoSoValue API
  try {
    const news = await soso.getNewsFeed(3);
    results.sosovalue = {
      ok: true,
      newsCount: Array.isArray(news) ? news.length : news?.data?.length || 0,
      sample: Array.isArray(news) && news.length > 0 ? news[0]?.title?.slice(0, 50) : null,
    };
  } catch (err: unknown) {
    results.sosovalue = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Test 3: Build a sample order payload (no signing)
  try {
    const adapter = getAdapter();
    const action = await adapter.buildMarketOrder("SOL", "long", 0.1, {
      wallet: "0x0000000000000000000000000000000000000000",
    });
    results.orderBuild = {
      ok: true,
      type: action.payload.type,
      payloadHash: action.payloadHash,
      nonce: action.message.nonce,
      domainChainId: action.domain.chainId,
    };
  } catch (err: unknown) {
    results.orderBuild = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json({
    timestamp: Date.now(),
    env: {
      provider: process.env.DEX_PROVIDER || "sodex",
      testnet: process.env.DEX_TESTNET || "true",
      sodexUrl: process.env.SODEX_API_URL || "https://testnet-gw.sodex.dev/api/v1/perps",
      sosoKeyPresent: !!process.env.SOSO_API_KEY,
    },
    results,
  });
}
