import "@/lib/config-server";
import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";
import { applyRequestNetwork } from "@/lib/request-network";

let marketCache: any = null;
let marketCacheTime = 0;
let marketCacheNetwork = "";

export async function GET(request: Request) {
  const network = applyRequestNetwork(request);
  try {
    const now = Date.now();
    if (!marketCache || now - marketCacheTime > 60000 || marketCacheNetwork !== network) {
      await initDex();
      const markets = await getAdapter().getMarkets();
      marketCache = markets;
      marketCacheTime = now;
      marketCacheNetwork = network;
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
