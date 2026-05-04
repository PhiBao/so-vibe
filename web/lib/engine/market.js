/**
 * Market Engine — SoDEX Native Wrapper
 */

import { getAdapter, initDex } from "@/lib/dex";

// ─── Initialization ────────────────────────────────────────

export async function initMarket() {
  return initDex();
}

// Backward compat
export async function initPhoenix() {
  return initDex();
}

// ─── Market Data ───────────────────────────────────────────

export async function getMarkets() {
  return getAdapter().getMarkets();
}

export async function getMarket(symbol) {
  return getAdapter().getMarket(symbol);
}

export async function getCandles(symbol, interval = "1h", limit = 100) {
  return getAdapter().getCandles(symbol, interval, limit);
}

export async function getOrderbook(symbol) {
  return getAdapter().getOrderbook(symbol);
}

export async function getFills(symbol) {
  return getAdapter().getFills(symbol);
}

export async function getFundingRate(symbol) {
  return getAdapter().getFundingRate(symbol);
}

export async function getTraderState(authority) {
  return getAdapter().getTraderState(authority);
}

export async function getExchangeInfo() {
  return getAdapter().getExchangeInfo();
}

// ─── Market Limits (with caching) ──────────────────────────

let marketCache = null;
let marketCacheTime = 0;

async function refreshMarketCache() {
  const now = Date.now();
  if (!marketCache || now - marketCacheTime > 60000) {
    marketCache = await getAdapter().getMarkets();
    marketCacheTime = now;
  }
  return marketCache;
}

export async function getMarketMaxLeverage(symbol) {
  const markets = await refreshMarketCache();
  const market = markets.find((m) => m.symbol === symbol);
  return market?.maxLeverage || 20;
}

export async function getAllMarketLimits() {
  const markets = await refreshMarketCache();
  const limits = {};
  for (const m of markets || []) {
    if (m.symbol) {
      limits[m.symbol] = {
        maxLeverage: m.maxLeverage || 20,
        tickSize: m.tickSize,
        takerFee: m.takerFee,
        makerFee: m.makerFee,
        isolatedOnly: m.isolatedOnly || false,
      };
    }
  }
  return limits;
}

// ─── Price Helpers ─────────────────────────────────────────

export async function getCurrentPrice(symbol) {
  return getAdapter().getCurrentPrice(symbol);
}

export async function getMidPrice(symbol) {
  const book = await getAdapter().getOrderbook(symbol);
  if (!book?.bids?.[0] || !book?.asks?.[0]) return null;
  return (book.bids[0].price + book.asks[0].price) / 2;
}

// ─── Order Building ────────────────────────────────────────

export async function buildLimitOrder(symbol, side, priceUsd, baseUnits) {
  return getAdapter().buildLimitOrder(symbol, side, priceUsd, baseUnits);
}

export async function buildMarketOrder(symbol, side, baseUnits) {
  return getAdapter().buildMarketOrder(symbol, side, baseUnits);
}

export async function buildStopLossOrder(symbol, authority, side, triggerPrice, isTakeProfit) {
  if (isTakeProfit) {
    return getAdapter().buildTakeProfit(symbol, side, triggerPrice, { wallet: authority });
  }
  return getAdapter().buildStopLoss(symbol, side, triggerPrice, { wallet: authority });
}

export async function buildPositionConditionalOrder(symbol, authority, side, stopLoss, takeProfit) {
  const adapter = getAdapter();
  if (adapter.buildPositionConditionalOrder) {
    return adapter.buildPositionConditionalOrder(symbol, side, stopLoss, takeProfit, { wallet: authority });
  }
  // Fallback: build SL and TP separately
  const results = await Promise.all([
    stopLoss ? adapter.buildStopLoss(symbol, side, stopLoss, { wallet: authority }) : null,
    takeProfit ? adapter.buildTakeProfit(symbol, side, takeProfit, { wallet: authority }) : null,
  ]);
  const instructions = results
    .filter((r) => r !== null)
    .flatMap((r) => r.instructions);
  return { instructions, meta: { symbol, side, stopLoss, takeProfit, type: "conditional" } };
}
