# SoVibe — Agent Guide (Wave 2)

## Project Overview

SoVibe is an **AI-augmented perpetual trading terminal** for the SoSoValue ecosystem. It runs a **7-strategy swarm** (5 technical + DGrid AI sentiment + ETF flow analysis) combined with real-time SoSoValue data to generate actionable, explained trading signals on **SoDEX testnet**.

Every signal includes LLM reasoning. Every signal can be signed and submitted on-chain via MetaMask.

## Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind v4, TypeScript
- **AI/LLM**: DGrid AI (OpenAI-compatible gateway, `gpt-4o-mini`) for sentiment, regime classification, signal reasoning
- **Data**: SoSoValue API (9 modules: news, ETF, market snapshots, macro events, indices, crypto stocks, fundraising, analysis charts, currency data)
- **Web3**: Wagmi + Viem, MetaMask (`injected()` only)
- **DEX**: SoDEX testnet (EVM chainId 138565) via native adapter
- **Security**: Custom `SecurityAuditor` with rate limiting, circuit breakers, duplicate detection

## Directory Structure

```
web/
├── app/
│   ├── api/
│   │   ├── bot/              # Bot cycle, execute, signals, status, toggle
│   │   ├── market/           # Market data (price, orderbook)
│   │   ├── markets/          # All market limits
│   │   ├── news/             # Enriched SoSoValue news (symbol-filtered, tags, categories)
│   │   ├── positions/        # Close position, SL/TP builder
│   │   ├── status/           # System status
│   │   ├── trade/            # Manual trade order builder
│   │   ├── wallet/           # Balance, deposit, withdraw
│   │   └── backtest/         # Backtest with SoDEX + SoSoValue dual data source
│   ├── backtest/             # Backtest UI
│   ├── bots/                 # Bot control + signal execution + strategy builder
│   ├── news/                 # News feed with symbol filter, AI sentiment badges
│   ├── positions/            # Position monitor
│   ├── trade/                # Manual trade execution
│   ├── globals.css           # Cyberpunk design system
│   ├── layout.tsx            # Terminal layout wrapper
│   ├── page.tsx              # Dashboard with intelligence overlay
│   └── providers.tsx         # Wallet context
├── components/
│   ├── TerminalLayout.tsx    # Sidebar + nav + wallet panel
│   ├── ToastProvider.tsx     # Toast notification system
│   └── WalletProvider.tsx    # Wagmi provider
├── lib/
│   ├── dex/
│   │   ├── types.ts          # Generic DEX interface
│   │   ├── index.ts          # Factory + config
│   │   └── sodex-adapter.ts  # SoDEX native adapter (EIP712, orders, transfers)
│   ├── engine/
│   │   ├── signals.js        # 7-strategy swarm + Vibe Score v2 + AutoHedge
│   │   ├── backtest.js       # Backtest engine
│   │   ├── indicators.js     # Technical indicators (RSI, MACD, BB, EMA, ATR, etc.)
│   │   ├── funding.js        # Funding rate analysis
│   │   ├── market.js         # Market data wrapper
│   │   ├── llm-agent.ts      # DGrid AI client (news sentiment, regime, reasoning)
│   │   └── strategies/
│   │       └── etf-flow.js   # ETF flow strategy (8th swarm member)
│   ├── sosovalue/
│   │   ├── etf.ts            # SoSoValue ETF data + signal analysis
│   │   ├── market.ts         # Market snapshot + cycle position
│   │   └── macro.ts          # Macro events (FOMC, CPI, NFP detection)
│   ├── sosovalue.ts          # SoSoValue API client (30+ endpoints across 9 modules)
│   ├── sentiment-engine.ts   # LLM-powered news sentiment (DGrid) + keyword fallback
│   ├── signal-store.ts       # Server-side signal persistence
│   ├── use-sodex-tx.ts       # EIP712 signing hook (perps + spot domains)
│   ├── security.ts           # Security auditor
│   └── data-store.ts         # State storage
```

## Quick Commands

```bash
cd web && npm run dev     # localhost:3000
cd web && npm run build   # production build
```

## Environment

Create `web/.env` (or `.env.local`):

```bash
DEX_PROVIDER=sodex
DEX_TESTNET=true
SOSO_API_KEY=your-sosovalue-api-key
DGRID_API_KEY=your-dgrid-api-key
NEXT_PUBLIC_RPC_URL=https://testnet-v2.valuechain.xyz/
```

## The 7-Strategy Swarm (Wave 2)

| # | Strategy | Source | Weight in Vibe Score |
|---|----------|--------|---------------------|
| 1 | Trend Following | EMA 9/21/50 cross + RSI filter | 15% |
| 2 | Mean Reversion | Bollinger Bands + RSI extremes | 15% |
| 3 | Momentum | MACD histogram + volume | 15% |
| 4 | S/R Bounce | Support/Resistance levels + RSI | 15% |
| 5 | Volume Breakout | Volume spike + EMA alignment | 15% |
| 6 | **DGrid AI Sentiment** | LLM-powered news analysis via SoSoValue | 20% |
| 7 | **ETF Flow** | SoSoValue ETF net inflow/outflow data | 15% |

All strategies can be toggled ON/OFF and weight-adjusted from the **Strategy Builder** in `/bots`.

## Vibe Score v2

```
Tech Consensus (5 strats): 30%
DGrid LLM Sentiment:       20%
ETF Flow Analysis:         15%
Funding Rate Bias:         15%
Macro Context:             10%
Market Structure:          10%
```

Full consensus triggers when tech, sentiment, ETF, and funding all agree on direction.

## DEX Adapter

All trading logic routes through `lib/dex/index.ts` (`getAdapter()` / `initDex()`). Do **not** call SoDEX API directly from components.

The SoDEX adapter handles:
- **EIP712 signing** with `eth_signTypedData_v4`
- **Domain separation**: perps uses `name: "futures"`, spot uses `name: "spot"` (both chainId 138565)
- **Signature prefix**: `0x01` for perps orders, `0x02` for spot orders
- **Field-order sensitive hashing**: Go server re-marshals JSON; fields must match struct order exactly
- **Trailing zero stripping**: `formatQuantity()` strips trailing zeros

## DGrid AI Integration

DGrid AI provides OpenAI-compatible access to 200+ models. SoVibe uses `openai/gpt-4o-mini` for cost-efficiency:

| Function | Model | Purpose |
|----------|-------|---------|
| `analyzeNewsSentiment()` | gpt-4o-mini | Scores news sentiment, extracts key narratives |
| `classifyMarketRegime()` | gpt-4o-mini | Classifies market as trending/ranging/volatile, suggests strategy weights |
| `explainSignal()` | gpt-4o-mini | Generates human-readable signal reasoning + risk factors |

~4 LLM calls per bot cycle. ~$0.001/cycle.

## SoSoValue API Coverage

| Module | Status | Key Endpoints |
|--------|--------|--------------|
| Feeds/News | Full | `/news`, `/news/hot`, `/news/featured`, `/news/search`, currency-filtered, category-filtered |
| ETF | New | `/etfs/summary-history` — net inflow/outflow for BTC, ETH, SOL, etc. |
| Currency | New | `/currencies/{id}/market-snapshot` — ATH, cycle low, FDV, marketcap rank |
| Macro | New | `/macro/events` — FOMC, CPI, NFP detection |
| Indices | Available | `/indices` — SSIMAG7 and proprietary indices |
| Crypto Stocks | Available | `/crypto-stocks` — MSTR, COIN, etc. |
| Fundraising | Available | `/fundraising/projects` |
| Analysis Charts | Available | `/analyses` |

## Strategy Builder

Located at `/bots` → STRATEGY_BUILDER table. Features:
- **ON/OFF toggle** per strategy — disabled strategies are skipped entirely
- **Weight slider** per strategy — adjusts influence in the Vibe Score (0-100%)
- **Config card export** — copy JSON to share strategy setup with others

Config is persisted in `localStorage` and sent to the bot cycle API.

## Backtest Engine

Dual data source support:
- **SoDEX testnet 1h candles** — real on-chain data
- **SoSoValue 1d klines** — expands daily into 24 synthetic hourly bars for cross-reference

Metrics: Total Return, Sharpe, Sortino, Max Drawdown, Win Rate, Profit Factor, Avg Win/Loss, Final Capital.

## Security Checklist

- [x] All inputs validated via `SecurityAuditor`
- [x] Rate limiting on all mutation endpoints
- [x] Circuit breaker for daily volume
- [x] Duplicate order detection
- [x] Price anomaly detection
- [x] EIP712 domain validation

## Critical Rules

1. **Never change field order** in SoDEX request bodies — hash verification will fail.
2. **Always stagger nonces** by ≥100ms when sending multiple signed instructions (SL/TP batching).
3. **Spot↔perp transfers**: spot→perp uses `/api/v1/spot/exchange` (`name: "spot"` domain, `type: 3`); perp→spot uses `/api/v1/perps/exchange` (`name: "futures"` domain, `type: 5`).
4. **Quantity precision**: BTC-USD `5`, ETH-USD `4`, SOL-USD `3` — use `formatQuantity(symbol, qty)`.
5. **LLM calls are additive, not essential** — all LLM functions have fallback paths. The bot works without DGRID_API_KEY (falls back to keyword sentiment).
6. **No WalletConnect** — MetaMask (`injected()`) only.

## Wave 3 Roadmap

- Copy-trading leaderboard (on-chain SoDEX wallet discovery)
- One-click trade mirroring with proportional position sizing
- Strategy config cards — shareable URLs for bot settings
- Wallet profiles with PnL/win rate analytics
- Referral program for growth
