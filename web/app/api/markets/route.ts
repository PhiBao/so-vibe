import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";

let marketCache: any = null;
let marketCacheTime = 0;

export async function GET() {
  try {
    const now = Date.now();
    if (!marketCache || now - marketCacheTime > 60000) {
      await initDex();
      const markets = await getAdapter().getMarkets();
      marketCache = markets;
      marketCacheTime = now;
    }

    const limits: Record<string, { maxLeverage: number; takerFee: number; makerFee: number; isolatedOnly: boolean }> = {};
    for (const m of marketCache || []) {
      if (m.symbol) {
        limits[m.symbol] = {
          maxLeverage: m.maxLeverage || 10,
          takerFee: m.takerFee || 0.00035,
          makerFee: m.makerFee || 0.00005,
          isolatedOnly: m.isolatedOnly || false,
        };
      }
    }

    return NextResponse.json({ markets: limits });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
