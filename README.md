# SoVibe

> Cyberpunk perpetual trading terminal powered by SoSoValue sentiment + SoDEX testnet.

[![Stack](https://img.shields.io/badge/stack-Next.js_16_|_React_19_|_Tailwind_v4_|_TypeScript-black?style=flat-square)](https://nextjs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

SoVibe is a **trading terminal** for SoDEX perpetuals. It fuses SoSoValue's news sentiment engine with a 5-strategy trading swarm, manual execution with stop-loss / take-profit, and real-time position monitoring — all inside a cyberpunk terminal UI.

Built for the **SoSoValue Buildathon**.

---

## Features

| Module | Description |
|--------|-------------|
| **Manual Trade** | Market/limit orders with auto-calculated SL/TP, leverage slider, and real-time orderbook |
| **Bot Swarm** | 5 strategy engines (TrendFollowing, MeanReversion, Momentum, SRBounce, VolumeBreakout) with consensus voting |
| **SoSoValue Sentiment** | Real-time news sentiment scoring per symbol, blended into bot confidence |
| **Position Monitor** | Live PnL, liquidation price estimation, one-click close |
| **Backtest** | Historical backtest on 1,000 candles with swarm strategy |
| **Security** | Rate limiting, input validation, circuit breaker, duplicate detection |
| **Cyberpunk UI** | CRT scanlines, terminal typography, neon accents, responsive grid |

---

## Quick Start

```bash
# 1. Clone
git clone <repo-url>
cd sovibe/web

# 2. Install
npm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local — add your SoSoValue API key and SoDEX settings

# 4. Run dev server
npm run dev
# Open http://localhost:3000
```

### Environment Variables

```bash
# Required
DEX_PROVIDER=sodex
DEX_TESTNET=true
SOSO_API_KEY=your_sosovalue_api_key

# Optional
NEXT_PUBLIC_WC_PROJECT_ID=       # WalletConnect (deprecated, only MetaMask used)
SYMBOLS=SOL-USD,ETH-USD,BTC-USD
SCAN_INTERVAL=60
MAX_POSITION_PCT=20
MAX_DAILY_LOSS_PCT=5
MAX_LEVERAGE=25
INITIAL_PORTFOLIO=1000
TRAILING_STOP_PCT=2
PARTIAL_PROFIT_PCT=50
BREAK_EVEN_TRIGGER=1
MAX_HOLD_BARS=48
MIN_CONFIDENCE=0.55
```

---

## Architecture

```
web/
├── app/
│   ├── page.tsx              # Dashboard (wallet + markets + news + signals)
│   ├── trade/page.tsx        # Manual trade execution
│   ├── positions/page.tsx    # Position monitor + close
│   ├── bots/page.tsx         # Bot control + signal cards
│   ├── backtest/page.tsx     # Backtest UI
│   └── api/                  # API routes
│       ├── trade/            # Build market order
│       ├── bot/
│       │   ├── cycle/        # Run one analysis cycle
│       │   ├── execute/      # Execute signal → market order
│       │   └── signals/      # Read pending signals
│       ├── positions/
│       │   ├── close/        # Close position builder
│       │   └── sl-tp/        # Stop-loss / take-profit builder
│       └── wallet/
│           └── balance/      # On-chain balance + positions
├── components/
│   ├── TerminalLayout.tsx    # Sidebar + CRT effects
│   ├── WalletProvider.tsx    # wagmi provider (MetaMask only)
│   └── ToastProvider.tsx     # Auto-dismissing notifications
├── lib/
│   ├── dex/
│   │   ├── sodex-adapter.ts  # Native SoDEX adapter
│   │   ├── types.ts          # Generic DEX interface
│   │   └── index.ts          # Factory
│   ├── engine/               # Trading engine (JS modules)
│   │   ├── market.js         # DEX-agnostic market wrapper
│   │   ├── signals.js        # 5 strategies + synthesizer
│   │   ├── indicators.js     # Technical indicators
│   │   ├── funding.js        # Funding rate analysis
│   │   ├── risk.js           # Risk management
│   │   └── backtest.js       # Backtest engine
│   ├── sentiment-engine.ts   # SoSoValue news sentiment
│   ├── signal-store.ts       # Server-side signal persistence
│   ├── security.ts           # Security auditor
│   ├── data-store.ts         # In-memory state storage
│   └── use-sodex-tx.ts       # EIP712 signing hook
└── .env.local
```

### DEX Adapter Pattern

All API routes import from `lib/dex/index.ts`:

```typescript
import { getAdapter, initDex } from "@/lib/dex";
const adapter = getAdapter();
const action = await adapter.buildMarketOrder("BTC-USD", "buy", 0.01, { wallet: address });
```

The adapter returns an `UnsignedAction` — the frontend signs it via `useSodexTx()` and POSTs to SoDEX `/exchange`.

---

## EIP712 Signing Flow

SoDEX uses EIP-712 typed data signatures with a `0x01` prefix for perps:

```
Domain:    { name: "futures", version: "1", chainId: 138565, verifyingContract: 0x0 }
Types:     ExchangeAction[{payloadHash: bytes32}, {nonce: uint64}]
Message:   { payloadHash: keccak256(json(payload)), nonce: Date.now() }
Signature: 0x01 + normalized(sig)  // v: 27/28 → 0/1
```

The signed payload is sent to `https://testnet-gw.sodex.dev/api/v1/perps/exchange` as JSON:

```json
{
  "type": "newOrder",
  "params": { "accountID": 54208, "symbolID": 1, "orders": [...] },
  "nonce": 1777905087221,
  "signature": "0x01...",
  "signatureChainID": 138565
}
```

**Important:** MetaMask must be on chain `138565` (SoDEX Testnet) when signing. Add it manually:

- Network Name: `SoDEX Testnet`
- RPC URL: `https://testnet-gw.sodex.dev/api/v1/perps` *(or official RPC if available)*
- Chain ID: `138565`
- Currency: `ETH`

*(Note: SoDEX testnet currently has no public JSON-RPC endpoint discoverable via standard tools. The official web frontend may use an internal RPC or a custom signing flow.)*

---

## Bot Strategy Swarm

| Engine | Signal Type | Best In | Weight |
|--------|-------------|---------|--------|
| **TrendFollowing** | EMA cross + RSI filter | Trending markets | 1.0x |
| **MeanReversion** | Bollinger + RSI extremes | Range-bound | 1.0x |
| **Momentum** | MACD hist + volume | Breakouts | 1.0x |
| **SR_Bounce** | Support/Resistance + RSI | Reversals | 1.0x |
| **VolBreakout** | Volume spike + direction | High volatility | 1.0x |

**Consensus Logic:**
- Long/short votes counted across all 5 strategies
- Signal strength weighted by confidence
- Funding rate analysis adds a 6th vote
- SoSoValue sentiment acts as tie-breaker
- Final signal requires `confidence >= minConfidence` and `longVotes != shortVotes`

---

## Security

- **Input validation** — all user inputs pass `SecurityAuditor` with regex + bounds checks
- **Rate limiting** — per-IP rate limits on all mutation endpoints
- **Circuit breaker** — daily volume cap prevents runaway trades
- **Duplicate detection** — prevents double-submission of the same order ID
- **Sanity checks** — max leverage, min notional, position size limits enforced per-symbol
- **No private keys in repo** — `.gitignore` excludes `.env.local`, `scripts/*.mjs`, and `data/`

### ⚠️ Never Commit Secrets

This repository deliberately excludes:
- `.env.local` — contains API keys
- `scripts/*.mjs` — test scripts that may reference private keys via env vars
- `data/` — runtime state that may include wallet data
- `.next/` — build output

If you accidentally committed a private key:
1. **Regenerate the key immediately** — even if you remove it from git history, it may be cached
2. Rotate any API keys or credentials that were exposed
3. Use `git filter-repo` or BFG to purge from history if needed

---

## API Integration

### SoSoValue

Fetches news sentiment via `SOSO_API_KEY`:

```
GET /v1/news?symbol=BTC&limit=20
```

Returns articles scored `-1.0` (bearish) to `+1.0` (bullish) with confidence `0.0–1.0`.

### SoDEX Testnet

- **Markets:** `GET /api/v1/perps/markets/symbols`
- **Account:** `GET /api/v1/perps/accounts/{address}/state`
- **Trade:** `POST /api/v1/perps/exchange` (signed)
- **Tickers:** `GET /api/v1/perps/markets/tickers?symbol={symbol}`

---

## Known Issues

1. **SoDEX Testnet Chain** — Chain ID `138565` is not listed on chainlist.org and has no discoverable public JSON-RPC endpoint. MetaMask may reject `wallet_switchEthereumChain` unless the RPC URL is valid. The official SoDEX frontend may use an internal/proxy RPC.
2. **Klines Unavailable** — SoDEX testnet does not provide historical candle data. The app falls back to synthetic candles with realistic trend patterns when real data is empty.
3. **Account Initialization** — New wallets without prior SoDEX interaction have `accountID: 0` and cannot trade until they interact with the official frontend or faucet.

---

## Development

```bash
# Lint
npm run lint

# Build
npm run build

# Test SoDEX signing (CLI)
TEST_PKEY=0x... node scripts/test-sodex-e2e.mjs
```

---

## License

MIT © SoVibe Team

---

> *"Trade the vibe. Not the noise."*
