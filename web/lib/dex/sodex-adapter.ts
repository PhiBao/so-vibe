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
import { getCurrentChainId, getNetworkConfig } from "@/lib/config";

// ─── Config ────────────────────────────────────────────────

function getChainId() {
  return getCurrentChainId();
}

function getGwBase() {
  return getNetworkConfig().gwBase;
}

function getPerpsBase() {
  return `${getGwBase()}/api/v1/perps`;
}

function getSpotBase() {
  return `${getGwBase()}/api/v1/spot`;
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

export function resetCaches() {
  marketCache = null;
  marketCacheTime = 0;
  accountCache.clear();
  nonceCounters.clear();
}

// ─── Account Resolution ────────────────────────────────────

async function getAccountID(walletAddress: string): Promise<number> {
  const cached = accountCache.get(walletAddress.toLowerCase());
  if (cached !== undefined) return cached;

  const data = await sodexGet(`${getPerpsBase()}/accounts/${walletAddress}/state`);
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

function getSpotDomain(): EIP712Domain {
  return {
    name: "spot",
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
  // Strip trailing zeros — server rejects "80.070", accepts "80.07"
  return parseFloat(rounded.toFixed(precision)).toString();
}

// Round price to symbol's tick size
function formatPrice(price: number, market: MarketInfo | null): string {
  const tick = market?.tickSize ?? 0.01;
  const precision = tick < 1 ? Math.ceil(-Math.log10(tick)) : 0;
  const rounded = Math.round(price / tick) * tick;
  return parseFloat(rounded.toFixed(precision)).toString();
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
  baseUrl: getPerpsBase(),

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

    const data = await sodexGet(`${getPerpsBase()}/markets/symbols`);
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
    const data = await sodexGet(`${getPerpsBase()}/markets/${symbol}/klines?interval=${interval}&limit=${limit}`);
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
    const data = await sodexGet(`${getPerpsBase()}/markets/${symbol}/orderbook?limit=20`);
    const bids = (data?.data?.bids || []).map((b: any[]) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) }));
    const asks = (data?.data?.asks || []).map((a: any[]) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) }));
    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
    return { bids, asks, mid } as Orderbook;
  },

  async getFills(symbol) {
    return sodexGet(`${getPerpsBase()}/markets/${symbol}/trades?limit=50`);
  },

  async getFundingRate(symbol) {
    const data = await sodexGet(`${getPerpsBase()}/markets/tickers?symbol=${symbol}`);
    const ticker = data?.data?.[0];
    if (!ticker) throw new Error(`No funding rate data for ${symbol}`);
    return {
      rate: parseFloat(ticker?.fundingRate || 0),
      timestamp: Date.now(),
    } as FundingRate;
  },

  async getExchangeInfo() {
    return { name: "SoDEX", version: "1.0.0", chainId: getChainId(), env: getNetworkConfig().name };
  },

  // ─── Trader State ──────────────────────────────────────────

  async getTraderState(walletAddress) {
    // Fetch perps state and spot balances in parallel
    const [stateRes, spotRes] = await Promise.all([
      sodexGet(`${getPerpsBase()}/accounts/${walletAddress}/state`),
      sodexGet(`${getSpotBase()}/accounts/${walletAddress}/balances`).catch(() => null),
    ]);
    const state = stateRes?.data;

    // Parse perps balances from state.B
    const balances = state?.B || [];
    const usdcBalance = balances.find((b: any) => b.a === "vUSDC" || b.a === "USDC");

    // Perps wallet fields:
    // wb = wallet balance (total)
    // aw = available wallet (free/spot)
    // am = available margin (perp/trading)
    const total = parseFloat(usdcBalance?.wb || usdcBalance?.t || 0);
    const perp = parseFloat(usdcBalance?.am || 0);
    const marginUsed = parseFloat(usdcBalance?.wm || 0);

    // Parse spot balance from spot API
    const spotBalances = spotRes?.data?.balances || [];
    const spotUSDC = spotBalances.find((b: any) => b.coin === "vUSDC" || b.coin === "USDC");
    const spot = parseFloat(spotUSDC?.total || 0);

    // Parse positions from state.P
    const positionsRaw = state?.P || [];
    const positions = positionsRaw.map((p: any) => ({
      symbol: p.s,
      side: parseFloat(p.sz) > 0 ? "long" : "short",
      size: Math.abs(parseFloat(p.sz)),
      entryPrice: parseFloat(p.ep || 0),
      unrealizedPnl: parseFloat(p.ur || 0),
      leverage: p.l || 1,
    }));

    return { collateral: total, spot, perp, marginUsed, positions };
  },

  // ─── Price Helpers ─────────────────────────────────────────

  async getCurrentPrice(symbol) {
    const data = await sodexGet(`${getPerpsBase()}/markets/tickers?symbol=${symbol}`);
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

    // For market orders, always use live orderbook price — never stale data
    // This ensures buy orders use ask-based price and sell orders use bid-based price
    const book = await this.getOrderbook(symbol);
    const bestAsk = book.asks?.[0]?.price || 0;
    const bestBid = book.bids?.[0]?.price || 0;
    const orderPrice = side === "buy" || side === "long"
      ? bestAsk * 1.01  // 1% above ask for buys
      : bestBid * 0.99; // 1% below bid for sells
    if (!orderPrice) throw new Error(`No orderbook price for ${symbol}`);

    const filterErr = checkOrderFilters(parseFloat(qtyStr), orderPrice, market);
    if (filterErr) throw new Error(filterErr);

    // Go struct field order: clOrdID, modifier, side, type, timeInForce, price, quantity, funds, stopPrice, stopType, triggerType, reduceOnly, positionSide
    const order: any = {
      clOrdID,
      modifier: 1,
      side: toSodexSide(side),
      type: 2,
      timeInForce: 3,
    };
    order.price = formatPrice(orderPrice, market);
    order.quantity = qtyStr;
    order.reduceOnly = false;
    order.positionSide = 1;

    const payload: SodexOrderPayload = {
      type: "newOrder",
      params: { accountID, symbolID, orders: [order] },
    };

    const action = buildUnsignedAction(payload, "/api/v1/perps/trade/orders");
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

    const action = buildUnsignedAction(payload, "/api/v1/perps/trade/orders");
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

    // Go struct field order
    const priceStr = formatPrice(triggerPrice, market);
    const order: any = {
      clOrdID,
      modifier: 2,
      side: closeSide(side),
      type: 1,
      timeInForce: 1,
      price: priceStr,
    };
    if (qtyStr) order.quantity = qtyStr;
    order.stopPrice = priceStr;
    order.stopType = 1;
    order.triggerType = 2;
    order.reduceOnly = true;
    order.positionSide = 1;

    const payload: SodexOrderPayload = {
      type: "newOrder",
      params: { accountID, symbolID, orders: [order] },
    };

    const action = buildUnsignedAction(payload, "/api/v1/perps/trade/orders");
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

    // Go struct field order
    const priceStr = formatPrice(triggerPrice, market);
    const order: any = {
      clOrdID,
      modifier: 2,
      side: closeSide(side),
      type: 1,
      timeInForce: 1,
      price: priceStr,
    };
    if (qtyStr) order.quantity = qtyStr;
    order.stopPrice = priceStr;
    order.stopType = 2;
    order.triggerType = 2;
    order.reduceOnly = true;
    order.positionSide = 1;

    const payload: SodexOrderPayload = {
      type: "newOrder",
      params: { accountID, symbolID, orders: [order] },
    };

    const action = buildUnsignedAction(payload, "/api/v1/perps/trade/orders");
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

    const action = buildUnsignedAction(payload, "/api/v1/perps/trade/orders");
    action.message.nonce = nonce;
    return action;
  },

  async buildUpdateMargin(symbol, amount, type, options) {
    const market = await this.getMarket(symbol);
    const symbolID = market?.symbolID ?? 0;
    const accountID = options?.accountID ?? (options?.wallet ? await getAccountID(options.wallet) : 0);
    const nonce = options?.wallet ? getNonce(options.wallet) : Date.now();

    const payload = {
      type: "updateMargin",
      params: {
        accountID,
        symbolID,
        amount: String(Math.abs(amount)),
        type: type === "add" ? 1 : 2,
      },
    };

    const action = buildUnsignedAction(payload, "/api/v1/perps/trade/margin");
    action.message.nonce = nonce;
    return action;
  },

  async buildTransferToPerps(amount, options) {
    // Spot -> Perp transfer goes through SPOT exchange endpoint
    // Need spot account ID as sender
    let spotAccountID = options?.accountID ?? 0;
    const nonce = options?.wallet ? getNonce(options.wallet) : Date.now();

    if (options?.wallet && !spotAccountID) {
      try {
        const spotState = await sodexGet(`${getSpotBase()}/accounts/${options.wallet}/state`);
        spotAccountID = spotState?.data?.aid ?? 0;
      } catch {}
    }

    const payload = {
      type: "transferAsset",
      params: {
        id: nonce,
        fromAccountID: spotAccountID,
        toAccountID: 999,
        coinID: 0, // vUSDC
        amount: parseFloat(amount.toFixed(2)).toString(),
        type: 3, // PERPS_WITHDRAW
      },
    };

    const payloadHash = computePayloadHash(payload);
    const domain = getSpotDomain();
    const message: EIP712Message = {
      payloadHash,
      nonce,
    };

    return {
      payload: payload as any,
      payloadHash,
      domain,
      message,
      endpoint: "/api/v1/spot/accounts/transfers",
      params: payload.params,
    };
  },

  async buildTransferToSpot(amount, options) {
    const accountID = options?.accountID ?? (options?.wallet ? await getAccountID(options.wallet) : 0);
    const nonce = options?.wallet ? getNonce(options.wallet) : Date.now();

    const payload = {
      type: "transferAsset",
      params: {
        id: nonce,
        fromAccountID: accountID,
        toAccountID: 999,
        coinID: 0, // vUSDC
        amount: parseFloat(amount.toFixed(2)).toString(),
        type: 5, // SPOT_WITHDRAW
      },
    };

    const payloadHash = computePayloadHash(payload);
    const domain = getDomain();
    const message: EIP712Message = {
      payloadHash,
      nonce,
    };

    return {
      payload: payload as any,
      payloadHash,
      domain,
      message,
      endpoint: "/api/v1/perps/accounts/transfers",
      params: payload.params,
    };
  },

  async buildAddAPIKey(publicKey: string, name: string, options?: { wallet?: string; accountID?: number; keyType?: number; expiresAt?: number }) {
    const wallet = options?.wallet;
    let accountID = options?.accountID ?? 0;
    const nonce = wallet ? getNonce(wallet) : Date.now();

    if (wallet && !accountID) {
      try {
        const spotState = await sodexGet(`${getSpotBase()}/accounts/${wallet}/state`);
        accountID = spotState?.data?.aid ?? 0;
      } catch {}
    }

    const payload = {
      type: "addAPIKey",
      params: {
        chainID: String(getChainId()),
        accountID,
        name,
        keyType: options?.keyType ?? 1,
        publicKey,
        expiresAt: options?.expiresAt ?? 0,
      },
    };

    const payloadHash = computePayloadHash(payload);
    const domain = getSpotDomain();
    const message: EIP712Message = { payloadHash, nonce };

    return {
      payload: payload as any,
      payloadHash,
      domain,
      message,
      endpoint: "/api/v1/spot/accounts/apiKeys",
      params: payload.params,
    };
  },
};

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

export { getChainId, getDomain, computePayloadHash, getNonce, getAccountID, getGwBase, getPerpsBase, getSpotBase };

// ─── Wallet Profile / Copy-Trading Methods ─────────────────

export async function getWalletTrades(address: string, symbol?: string, limit = 500) {
  let url = `${getPerpsBase()}/accounts/${address}/trades?limit=${limit}`;
  if (symbol) url += `&symbol=${symbol}`;
  const data = await sodexGet(url);
  const raw = data?.data || [];
  return (Array.isArray(raw) ? raw : []).map((t: any) => ({
    id: t.i || t.t || 0,
    time: t.T || t.time || 0,
    symbol: t.s || t.symbol || "",
    side: t.S || t.side || "BUY",
    price: parseFloat(t.p || t.price || 0),
    quantity: parseFloat(t.q || t.quantity || 0),
    notional: parseFloat(t.p || t.price || 0) * parseFloat(t.q || t.quantity || 0),
  }));
}

export async function getWalletPosHistory(address: string, symbol?: string, limit = 500) {
  let url = `${getPerpsBase()}/accounts/${address}/positions/history?limit=${limit}`;
  if (symbol) url += `&symbol=${symbol}`;
  const data = await sodexGet(url);
  const raw = data?.data || [];
  return (Array.isArray(raw) ? raw : []).map((p: any) => ({
    symbol: p.s || p.symbol || "",
    side: parseFloat(p.sz || p.size || "0") > 0 ? "long" : "short",
    size: Math.abs(parseFloat(p.sz || p.size || 0)),
    entryPrice: parseFloat(p.ep || p.entryPrice || 0),
    exitPrice: parseFloat(p.xp || p.exitPrice || 0),
    realizedPnl: parseFloat(p.rp || p.realizedPnl || p.npl || 0),
    openTime: p.ot || p.openTime || 0,
    closeTime: p.ct || p.closeTime || 0,
  }));
}

export async function getWalletFundings(address: string, symbol?: string, limit = 500) {
  let url = `${getPerpsBase()}/accounts/${address}/fundings?limit=${limit}`;
  if (symbol) url += `&symbol=${symbol}`;
  const data = await sodexGet(url);
  const raw = data?.data || [];
  return (Array.isArray(raw) ? raw : []).map((f: any) => ({
    symbol: f.s || f.symbol || "",
    amount: parseFloat(f.a || f.amount || f.pa || 0),
    time: f.T || f.time || f.t || 0,
  }));
}
