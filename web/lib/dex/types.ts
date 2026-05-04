// SoDEX Native DEX Types — EVM-compatible, EIP712 signing

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  mid?: number;
}

export interface MarketInfo {
  symbol: string;
  symbolID: number;
  maxLeverage: number;
  tickSize: number;
  takerFee: number;
  makerFee: number;
  isolatedOnly?: boolean;
  quantityPrecision?: number;
  stepSize?: number;
  minQuantity?: number;
  maxQuantity?: number;
  minNotional?: number;
  maxNotional?: number;
  status?: string;
}

export interface Position {
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice?: number;
  collateral?: number;
  unrealizedPnl?: number;
  leverage?: number;
}

export interface TraderState {
  collateral: number;
  positions: Position[];
}

export interface FundingRate {
  rate: number;
  timestamp: number;
}

export type OrderSide = "buy" | "sell" | "long" | "short";

// ─── SoDEX EIP712 Signing Payload ──────────────────────────

export interface SodexOrderPayload {
  type: "newOrder";
  params: {
    accountID: number;
    symbolID: number;
    orders: SodexOrderItem[];
  };
}

export interface SodexOrderItem {
  clOrdID: string;
  modifier: number;
  side: number; // 1 = buy, 2 = sell
  type: number; // 1 = limit, 2 = market, 3 = stopLoss, 4 = takeProfit
  timeInForce: number; // 1 = GTC, 2 = IOC, 3 = FOK
  price?: string;
  quantity?: string;
  funds?: string;
  stopPrice?: string;
  stopType?: number;
  triggerType?: number;
  reduceOnly: boolean;
  positionSide: number; // 1 = long, 2 = short
}

export interface SodexCancelPayload {
  type: "cancelOrder";
  params: {
    accountID: number;
    symbolID: number;
    orders: { clOrdID: string }[];
  };
}

export interface SodexUpdateLeveragePayload {
  type: "updateLeverage";
  params: {
    accountID: number;
    symbolID: number;
    leverage: string;
  };
}

export interface SodexUpdateMarginPayload {
  type: "updateMargin";
  params: {
    accountID: number;
    symbolID: number;
    amount: string;
    type: number; // 1 = add, 2 = remove
  };
}

export interface SodexAddAPIKeyPayload {
  type: "addAPIKey";
  params: {
    chainID: string;
    accountID: number;
    name: string;
    keyType: number;
    publicKey: string;
    expiresAt: number;
  };
}

export type SodexActionPayload =
  | SodexOrderPayload
  | SodexCancelPayload
  | SodexUpdateLeveragePayload
  | SodexUpdateMarginPayload
  | SodexAddAPIKeyPayload;

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
}

export interface EIP712Message {
  payloadHash: `0x${string}`;
  nonce: number;
}

export interface UnsignedAction {
  payload: SodexActionPayload;
  payloadHash: `0x${string}`;
  domain: EIP712Domain;
  message: EIP712Message;
  endpoint: string; // e.g. "/trade/orders"
  params: Record<string, unknown>; // body to send (params only)
}

export interface SignedAction {
  type: string;
  params: Record<string, unknown>;
  signature: `0x${string}`;
  nonce: number;
  endpoint: string;
  signatureChainID: number;
}

// ─── DEX Adapter Interface ─────────────────────────────────

export interface DexAdapter {
  readonly name: string;
  readonly chain: string;
  readonly baseUrl: string;

  init(): Promise<void>;

  // Market data
  getMarkets(): Promise<MarketInfo[]>;
  getMarket(symbol: string): Promise<MarketInfo | null>;
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
  getOrderbook(symbol: string): Promise<Orderbook>;
  getFills(symbol: string): Promise<unknown[]>;
  getFundingRate(symbol: string): Promise<FundingRate | null>;
  getExchangeInfo(): Promise<unknown>;

  // Trader state
  getTraderState(address: string): Promise<TraderState>;

  // Price helpers
  getCurrentPrice(symbol: string): Promise<number | null>;

  // Order building (returns unsigned payload for EIP712 signing)
  buildMarketOrder(
    symbol: string,
    side: OrderSide,
    size: number,
    options?: { wallet?: string; leverage?: number; accountID?: number; price?: number }
  ): Promise<UnsignedAction>;

  buildLimitOrder(
    symbol: string,
    side: OrderSide,
    price: number,
    size: number,
    options?: { wallet?: string; accountID?: number }
  ): Promise<UnsignedAction>;

  buildStopLoss(
    symbol: string,
    side: OrderSide,
    triggerPrice: number,
    options?: { wallet?: string; accountID?: number; executionPrice?: number; size?: number }
  ): Promise<UnsignedAction>;

  buildTakeProfit(
    symbol: string,
    side: OrderSide,
    triggerPrice: number,
    options?: { wallet?: string; accountID?: number; executionPrice?: number; size?: number }
  ): Promise<UnsignedAction>;

  buildClosePosition(
    symbol: string,
    side: OrderSide,
    size: number,
    options?: { wallet?: string; accountID?: number }
  ): Promise<UnsignedAction>;
}

export interface DexConfig {
  provider: string;
  apiUrl?: string;
  rpcUrl?: string;
  testnet?: boolean;
  chainId?: number;
  extras?: Record<string, unknown>;
}
