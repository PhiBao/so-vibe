/**
 * SoDEX Native Adapter — EVM-compatible perpetual DEX
 *
 * Uses SoDEX REST API with EIP712 typed signatures.
 * All methods throw on API failure — no mock fallbacks.
 */

import { keccak256, toHex } from "viem";
import type {
  DexAdapter,
  Candle,
  Orderbook,
  MarketInfo,
  TraderState,
  FundingRate,
  UnsignedAction,
  OrderSide,
  SodexOrderPayload,
  EIP712Domain,
  EIP712Message,
} from "./types";

// ─── Config ────────────────────────────────────────────────

const GW_BASE = "https://testnet-gw.sodex.dev";
const PERPS_BASE = `${GW_BASE}/api/v1/perps`;
const FUTURES_BASE = `${GW_BASE}/futures/fapi/market/v1/public`;
const QUOTATION_BASE = `${GW_BASE}/pro/p/quotation`;
const TESTNET_CHAIN_ID = 138565;
const MAINNET_CHAIN_ID = 286623;

function getChainId() {
  return process.env.DEX_TESTNET === "true" || process.env.DEX_PROVIDER === "sodex"
    ? TESTNET_CHAIN_ID
    : MAINNET_CHAIN_ID;
}

// ─── HTTP Helpers ──────────────────────────────────────────

async function sodexGet(url: string, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      next: { revalidate: 5 },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`SoDEX GET ${url} failed: ${res.status} ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── State ─────────────────────────────────────────────────

let nonceCounters: Map<string, number> = new Map();
let marketCache: MarketInfo[] | null = null;
let marketCacheTime = 0;
let accountCache: Map<string, number> = new Map();

// ─── Account Resolution ────────────────────────────────────

async function getAccountID(walletAddress: string): Promise<number> {
  const cached = accountCache.get(walletAddress.toLowerCase());
  if (cached !== undefined) return cached;

  const data = await sodexGet(`${PERPS_BASE}/accounts/${walletAddress}/state`);
  const accountID = data?.data?.aid ?? data?.data?.uid ?? 0;
  if (accountID) {
    accountCache.set(walletAddress.toLowerCase(), accountID);
  }
  return accountID;
}

// ─── EIP712 Helpers ────────────────────────────────────────

function getDomain(): EIP712Domain {
  return {
    name: "futures",
    version: "1",
    chainId: getChainId(),
    verifyingContract: "0x0000000000000000000000000000000000000000",
  };
}

// Round quantity to symbol's valid precision and step size
function formatQuantity(qty: number, market: MarketInfo | null): string {
  const precision = market?.quantityPrecision ?? 4;
  const step = market?.stepSize ?? Math.pow(10, -precision);
  // Use integer math to avoid floating point errors
  const scale = Math.pow(10, precision + 4); // extra precision for step calc
  const stepInt = Math.round(step * scale);
  const qtyInt = Math.round(qty * scale);
  const roundedInt = Math.floor(qtyInt / stepInt) * stepInt;
  const rounded = roundedInt / scale;
  return rounded.toFixed(precision);
}

function checkOrderFilters(size: number, price: number, market: MarketInfo | null): string | null {
  if (!market) return null;
  const notional = size * price;
  if (market.minNotional && notional < market.minNotional) {
    return `min notional ${market.minNotional}, got ${notional.toFixed(2)}`;
  }
  if (market.maxNotional && notional > market.maxNotional) {
    return `max notional ${market.maxNotional}, got ${notional.toFixed(2)}`;
  }
  if (market.minQuantity && size < market.minQuantity) {
    return `min quantity ${market.minQuantity}, got ${size}`;
  }
  if (market.maxQuantity && size > market.maxQuantity) {
    return `max quantity ${market.maxQuantity}, got ${size}`;
  }
  if (market.status === "HALT") {
    return `symbol not active: ${market.status}`;
  }
  return null;
}

function computePayloadHash(payload: Record<string, unknown>): `0x${string}` {
  // Compact JSON, no whitespace — matches Go's json.Marshal
  const json = JSON.stringify(payload);
  return keccak256(toHex(json));
}

function getNonce(address: string): number {
  const key = address.toLowerCase();
  const existing = nonceCounters.get(key);
  const now = Date.now();
  const nonce = existing && existing > now ? existing + 1 : now;
  nonceCounters.set(key, nonce);
  return nonce;
}

function buildUnsignedAction(payload: any, endpoint: string): UnsignedAction {
  const payloadHash = computePayloadHash(payload);
  const domain = getDomain();
  const message: EIP712Message = {
    payloadHash,
    nonce: Date.now(),
  };
  return {
    payload: payload as any,
    payloadHash,
    domain,
    message,
    endpoint,
    params: payload.params,
  };
}

// ─── Side / Type Helpers ───────────────────────────────────

function toSodexSide(side: OrderSide): number {
  return side === "buy" || side === "long" ? 1 : 2;
}

function closeSide(side: OrderSide): number {
  return side === "buy" || side === "long" ? 2 : 1;
}

// ─── Adapter ───────────────────────────────────────────────

export const sodexAdapter: DexAdapter = {
  name: "sodex",
  chain: "evm",
  baseUrl: PERPS_BASE,

  async init() {
    // Verify markets load — throws if API is down
    await this.getMarkets();
  },

  // ─── Market Data ───────────────────────────────────────────

  async getMarkets() {
    const now = Date.now();
    if (marketCache && now - marketCacheTime < 30000) {
      return marketCache;
    }

    const data = await sodexGet(`${PERPS_BASE}/markets/symbols`);
    const markets = (data?.data || []).map((m: any): MarketInfo => ({
      symbol: m.name || m.symbol,
      symbolID: m.id || 0,
      maxLeverage: m.maxLeverage || 20,
      tickSize: parseFloat(m.tickSize) || 0.01,
      takerFee: parseFloat(m.takerFee) || 0.0005,
      makerFee: parseFloat(m.makerFee) || 0.0002,
      isolatedOnly: false,
      quantityPrecision: m.quantityPrecision,
      stepSize: parseFloat(m.stepSize) || undefined,
      minQuantity: parseFloat(m.minQuantity) || undefined,
      maxQuantity: parseFloat(m.maxQuantity) || undefined,
      minNotional: parseFloat(m.minNotional) || undefined,
      maxNotional: parseFloat(m.maxNotional) || undefined,
      status: m.status,
    }));

    marketCache = markets;
    marketCacheTime = now;
    return markets;
  },

  async getMarket(symbol) {
    const markets = await this.getMarkets();
    return markets.find((m) => m.symbol === symbol) || null;
  },

  async getCandles(symbol, interval, limit) {
    const data = await sodexGet(`${PERPS_BASE}/markets/${symbol}/klines?interval=${interval}&limit=${limit}`);
    const raw = data?.data || [];
    if (!raw.length) {
      throw new Error(`SoDEX klines empty for ${symbol}`);
    }
    return raw.map((c: any): Candle => ({
      timestamp: c.t || Date.now(),
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
      volume: parseFloat(c.v),
    }));
  },

  async getOrderbook(symbol) {
    const data = await sodexGet(`${PERPS_BASE}/markets/${symbol}/orderbook?limit=20`);
    return {
      bids: (data?.data?.bids || []).map((b: any[]) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) })),
      asks: (data?.data?.asks || []).map((a: any[]) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) })),
    } as Orderbook;
  },

  async getFills(symbol) {
    return sodexGet(`${PERPS_BASE}/markets/${symbol}/trades?limit=50`);
  },

  async getFundingRate(symbol) {
    const data = await sodexGet(`${PERPS_BASE}/markets/tickers?symbol=${symbol}`);
    const ticker = data?.data?.[0];
    if (!ticker) throw new Error(`No funding rate data for ${symbol}`);
    return {
      rate: parseFloat(ticker?.fundingRate || 0),
      timestamp: Date.now(),
    } as FundingRate;
  },

  async getExchangeInfo() {
    return { name: "SoDEX", version: "1.0.0", chainId: getChainId(), env: "testnet" };
  },

  // ─── Trader State ──────────────────────────────────────────

  async getTraderState(walletAddress) {
    const stateRes = await sodexGet(`${PERPS_BASE}/accounts/${walletAddress}/state`);
    const state = stateRes?.data;

    // Parse balances from state.B (array of balance objects)
    const balances = state?.B || [];
    const usdcBalance = balances.find((b: any) => b.a === "vUSDC" || b.a === "USDC");
    const collateral = parseFloat(usdcBalance?.wb || usdcBalance?.t || 0);

    // Parse positions from state.P (array of position objects)
    const positionsRaw = state?.P || [];
    const positions = positionsRaw.map((p: any) => ({
      symbol: p.s,
      side: parseFloat(p.sz) > 0 ? "long" : "short",
      size: Math.abs(parseFloat(p.sz)),
      entryPrice: parseFloat(p.ep || 0),
      unrealizedPnl: parseFloat(p.ur || 0),
      leverage: p.l || 1,
    }));

    return { collateral, positions };
  },

  // ─── Price Helpers ─────────────────────────────────────────

  async getCurrentPrice(symbol) {
    const data = await sodexGet(`${PERPS_BASE}/markets/tickers?symbol=${symbol}`);
    const ticker = data?.data?.[0];
    const price = parseFloat(ticker?.lastPx || 0);
    if (!price) throw new Error(`No price data for ${symbol}`);
    return price;
  },

  // ─── Order Building ────────────────────────────────────────

  async buildMarketOrder(symbol, side, size, options) {
    const market = await this.getMarket(symbol);
    if (!market) throw new Error(`Market not found: ${symbol}`);
    if (market.status === "HALT") throw new Error(`Market halted: ${symbol}`);

    const symbolID = market.symbolID;
    const accountID = options?.accountID ?? (options?.wallet ? await getAccountID(options.wallet) : 0);
    const nonce = options?.wallet ? getNonce(options.wallet) : Date.now();
    const clOrdID = `${accountID}-${nonce}`;

    const price = options?.price || 0;
    const qtyStr = formatQuantity(size, market);
    const filterErr = checkOrderFilters(parseFloat(qtyStr), price || market.tickSize, market);
    if (filterErr) throw new Error(filterErr);

    const order: any = {
      clOrdID,
      modifier: 1,
      side: toSodexSide(side),
      type: 2,
      timeInForce: 3,
      quantity: qtyStr,
      reduceOnly: false,
      positionSide: 1,
    };
    if (price > 0) order.price = String(price);

    const payload: SodexOrderPayload = {
      type: "newOrder",
      params: { accountID, symbolID, orders: [order] },
    };

    const action = buildUnsignedAction(payload, "/exchange");
    action.message.nonce = nonce;
    return action;
  },

  async buildLimitOrder(symbol, side, price, size, options) {
    const market = await this.getMarket(symbol);
    if (!market) throw new Error(`Market not found: ${symbol}`);
    if (market.status === "HALT") throw new Error(`Market halted: ${symbol}`);

    const symbolID = market.symbolID;
    const accountID = options?.accountID ?? (options?.wallet ? await getAccountID(options.wallet) : 0);
    const nonce = options?.wallet ? getNonce(options.wallet) : Date.now();
    const clOrdID = `${accountID}-${nonce}`;

    const qtyStr = formatQuantity(size, market);
    const filterErr = checkOrderFilters(parseFloat(qtyStr), price, market);
    if (filterErr) throw new Error(filterErr);

    const payload: SodexOrderPayload = {
      type: "newOrder",
      params: {
        accountID,
        symbolID,
        orders: [
          {
            clOrdID,
            modifier: 1,
            side: toSodexSide(side),
            type: 1,
            timeInForce: 1,
            price: String(price),
            quantity: qtyStr,
            reduceOnly: false,
            positionSide: 1,
          },
        ],
      },
    };

    const action = buildUnsignedAction(payload, "/exchange");
    action.message.nonce = nonce;
    return action;
  },

  async buildStopLoss(symbol, side, triggerPrice, options) {
    const market = await this.getMarket(symbol);
    if (!market) throw new Error(`Market not found: ${symbol}`);

    const symbolID = market.symbolID;
    const accountID = options?.accountID ?? (options?.wallet ? await getAccountID(options.wallet) : 0);
    const nonce = options?.wallet ? getNonce(options.wallet) : Date.now();
    const clOrdID = `${accountID}-${nonce}`;

    const size = options?.size || 0;
    const qtyStr = size > 0 ? formatQuantity(size, market) : undefined;

    const order: any = {
      clOrdID,
      modifier: 2,
      side: closeSide(side),
      type: 1,
      timeInForce: 1,
      price: String(triggerPrice),
      stopPrice: String(triggerPrice),
      stopType: 1,
      triggerType: 2,
      reduceOnly: true,
      positionSide: 1,
    };
    if (qtyStr) order.quantity = qtyStr;

    const payload: SodexOrderPayload = {
      type: "newOrder",
      params: { accountID, symbolID, orders: [order] },
    };

    const action = buildUnsignedAction(payload, "/exchange");
    action.message.nonce = nonce;
    return action;
  },

  async buildTakeProfit(symbol, side, triggerPrice, options) {
    const market = await this.getMarket(symbol);
    if (!market) throw new Error(`Market not found: ${symbol}`);

    const symbolID = market.symbolID;
    const accountID = options?.accountID ?? (options?.wallet ? await getAccountID(options.wallet) : 0);
    const nonce = options?.wallet ? getNonce(options.wallet) : Date.now();
    const clOrdID = `${accountID}-${nonce}`;

    const size = options?.size || 0;
    const qtyStr = size > 0 ? formatQuantity(size, market) : undefined;

    const order: any = {
      clOrdID,
      modifier: 2,
      side: closeSide(side),
      type: 1,
      timeInForce: 1,
      price: String(triggerPrice),
      stopPrice: String(triggerPrice),
      stopType: 2,
      triggerType: 2,
      reduceOnly: true,
      positionSide: 1,
    };
    if (qtyStr) order.quantity = qtyStr;

    const payload: SodexOrderPayload = {
      type: "newOrder",
      params: { accountID, symbolID, orders: [order] },
    };

    const action = buildUnsignedAction(payload, "/exchange");
    action.message.nonce = nonce;
    return action;
  },

  async buildClosePosition(symbol, side, size, options) {
    const market = await this.getMarket(symbol);
    if (!market) throw new Error(`Market not found: ${symbol}`);

    const symbolID = market.symbolID;
    const accountID = options?.accountID ?? (options?.wallet ? await getAccountID(options.wallet) : 0);
    const nonce = options?.wallet ? getNonce(options.wallet) : Date.now();
    const clOrdID = `${accountID}-${nonce}`;

    const qtyStr = formatQuantity(size, market);

    const payload: SodexOrderPayload = {
      type: "newOrder",
      params: {
        accountID,
        symbolID,
        orders: [
          {
            clOrdID,
            modifier: 1,
            side: closeSide(side),
            type: 2,
            timeInForce: 3,
            quantity: qtyStr,
            reduceOnly: true,
            positionSide: 1,
          },
        ],
      },
    };

    const action = buildUnsignedAction(payload, "/exchange");
    action.message.nonce = nonce;
    return action;
  },
};

// ─── API Key Management ────────────────────────────────────

export interface APIKeyInfo {
  name: string;
  publicKey: string;
  keyType: number;
  expiresAt: number;
}

/** Check if account has any registered API keys */
export async function hasAPIKey(walletAddress: string): Promise<boolean> {
  const data = await sodexGet(`${PERPS_BASE}/accounts/${walletAddress}/state`);
  const keys = data?.data?.apiKeys ?? data?.data?.K ?? [];
  return Array.isArray(keys) && keys.length > 0;
}

/** List registered API keys for an account */
export async function listAPIKeys(walletAddress: string): Promise<APIKeyInfo[]> {
  const data = await sodexGet(`${PERPS_BASE}/accounts/${walletAddress}/state`);
  const keys = data?.data?.apiKeys ?? data?.data?.K ?? [];
  return keys.map((k: any) => ({
    name: k.name ?? k.n ?? "",
    publicKey: k.publicKey ?? k.pk ?? "",
    keyType: k.keyType ?? k.kt ?? 0,
    expiresAt: k.expiresAt ?? k.ea ?? 0,
  }));
}

/** Build an addAPIKey unsigned action */
export async function buildAddAPIKey(walletAddress: string): Promise<UnsignedAction> {
  const accountID = await getAccountID(walletAddress);
  const nonce = getNonce(walletAddress);
  const expiresAt = nonce + 7 * 24 * 60 * 60 * 1000; // 7 days from nonce in ms

  const payload = {
    type: "addAPIKey",
    params: {
      accountID,
      name: "webkey",
      type: 1,
      publicKey: walletAddress,
      expiresAt,
    },
  };

  const action = buildUnsignedAction(payload, "/exchange");
  action.message.nonce = nonce;
  return action;
}

// ─── Additional Real API Helpers (not in DexAdapter interface) ─

/** Fetch aggregated tickers from SoDEX futures market API */
export async function getAggTickers() {
  const data = await sodexGet(`${FUTURES_BASE}/q/agg-tickers`);
  return data?.data || [];
}

/** Fetch quotation tickers from SoDEX pro API */
export async function getQuotationTickers() {
  const data = await sodexGet(`${QUOTATION_BASE}/tickers`);
  return data?.data || [];
}

// ─── Synthetic Candle Fallback (for testnet when klines are unavailable) ─

export function generateSyntheticCandles(symbol: string, limit: number): Candle[] {
  const basePrices: Record<string, number> = { "SOL-USD": 145, "ETH-USD": 3200, "BTC-USD": 64000 };
  let price = basePrices[symbol] || 100;
  const candles: Candle[] = [];
  const now = Date.now();

  const hourSeed = Math.floor(now / 3600_000);
  let seed = symbol.split("").reduce((s, c) => s + c.charCodeAt(0), 0) + hourSeed * 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  let trend = 0;
  let trendDur = 0;
  let trendStrength = 0;

  for (let i = limit; i > 0; i--) {
    if (trendDur <= 0) {
      const r = rand();
      trend = r < 0.4 ? -1 : r < 0.6 ? 0 : 1;
      trendDur = 8 + Math.floor(rand() * 15);
      trendStrength = 0.004 + rand() * 0.012;
    }
    trendDur--;

    const vol = price * 0.015;
    const drift = price * trendStrength * trend;
    const noise = (rand() - 0.5) * vol * 1.5;
    const open = price;
    let close = price + drift + noise;

    if (rand() < 0.10) {
      const dir = rand() < 0.5 ? -1 : 1;
      close += dir * vol * (1.5 + rand() * 2);
    }

    const high = Math.max(open, close) + rand() * vol * 0.5;
    const low = Math.min(open, close) - rand() * vol * 0.5;
    const volume = (rand() * 600 + 150) * (1 + Math.abs(trend) * 2 + (Math.abs(close - open) / price) * 50);

    candles.push({ timestamp: now - i * 3600_000, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

// ─── Utility Exports ───────────────────────────────────────

export { getChainId, getDomain, computePayloadHash, getNonce, getAccountID, PERPS_BASE, GW_BASE };
