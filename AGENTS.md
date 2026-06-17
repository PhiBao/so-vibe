# SoVibe — Agent Guide (Wave 3)

## Project Overview

SoVibe is an **AI-augmented perpetual trading terminal** for the SoSoValue ecosystem. It runs a **7-strategy swarm** (5 technical + DGrid AI sentiment + ETF flow analysis) combined with real-time SoSoValue data to generate actionable, explained trading signals on **SoDEX testnet or mainnet**.

Every signal includes LLM reasoning. Every signal can be signed and submitted on-chain via MetaMask. Wave 3 adds encrypted local auto-trading bot keys, a copy-trading leaderboard, mainnet support, and hardened security defaults.

> For demo and talking points see `DEMO.md`. For release notes see `CHANGELOG.md`.

## Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind v4, TypeScript
- **AI/LLM**: DGrid AI (OpenAI-compatible gateway, `gpt-4o-mini`) for sentiment, regime classification, signal reasoning
- **Data**: SoSoValue API (9 modules: news, ETF, market snapshots, macro events, indices, crypto stocks, fundraising, analysis charts, currency data)
- **Web3**: Wagmi + Viem, MetaMask (`injected()` only)
- **DEX**: SoDEX testnet (chainId 138565) and mainnet (chainId 286623) via native adapter
- **Security**: Custom `SecurityAuditor` with rate limiting, circuit breakers, duplicate detection; encrypted local bot-key storage

## Directory Structure

```
web/
├── app/
│   ├── api/
│   │   ├── bot/              # Bot cycle, auto-execute, execute, signals, status, toggle, PnL
│   │   ├── config/           # Runtime network config persistence
│   │   ├── market/           # Market data (price, orderbook)
│   │   ├── markets/          # All market limits
│   │   ├── news/             # Enriched SoSoValue news (symbol-filtered, tags, categories)
│   │   ├── positions/        # Close position, SL/TP builder
│   │   ├── status/           # System status
│   │   ├── trade/            # Manual trade order builder
│   │   ├── wallet/           # Balance, deposit, withdraw, profile, copy, leaderboard
│   │   └── backtest/         # Backtest with SoDEX + SoSoValue dual data source
│   ├── backtest/             # Backtest UI
│   ├── bots/                 # Bot control + signal execution + strategy builder
│   ├── news/                 # News feed with symbol filter, AI sentiment badges
│   ├── positions/            # Position monitor
│   ├── settings/             # Network + encrypted bot key settings
│   ├── trade/                # Manual trade execution
│   ├── wallet/               # Wallet analyzer + leaderboard
│   ├── globals.css           # Cyberpunk design system
│   ├── layout.tsx            # Terminal layout wrapper
│   ├── page.tsx              # Dashboard with intelligence overlay
│   └── providers.tsx         # Wallet context
├── components/
│   ├── TerminalLayout.tsx    # Sidebar + nav + wallet panel
│   ├── NetworkSwitch.tsx     # TESTNET/MAINNET dropdown
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
│   │   ├── pnl-tracker.ts    # File-based closed-trade PnL persistence
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
│   ├── data-store.ts         # State storage
│   ├── config.ts             # Client-safe network config
│   ├── config-server.ts      # Server-side runtime config loader
│   ├── api-error.ts          # API error sanitizer
│   ├── encrypted-store.ts    # Password-encrypted browser keystore for bot keys
│   ├── bot-signer-client.ts  # Client-side EIP712 bot signer
│   ├── leaderboard-wallets.ts# Curated wallet list for leaderboard
│   └── wallet-profile.ts     # Shared wallet analytics builder
```

## Quick Commands

```bash
cd web && npm run dev     # localhost:3000
cd web && npm run build   # production build
```

## Environment

Create `web/.env` (or `.env.local`) for defaults, or configure at runtime via `/settings`:

```bash
DEX_PROVIDER=sodex
DEX_TESTNET=true
SOSO_API_KEY=your-sosovalue-api-key
DGRID_API_KEY=your-dgrid-api-key
NEXT_PUBLIC_RPC_URL=https://testnet-v2.valuechain.xyz/

# Optional: seed the copy-trading leaderboard
# LEADERBOARD_WALLETS=0x...,0x...
```

Runtime network choice is persisted in `web/.runtime-config.json` and selected via the header dropdown. Bot keys are configured by the user in the browser, encrypted with a user password, and stored in `localStorage`; the plaintext private key is kept in memory only while unlocked.

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
- **Domain separation**: perps uses `name: "futures"`, spot uses `name: "spot"` (chainId 138565 on testnet, 286623 on mainnet)
- **Signature prefix**: `0x01` for perps orders, `0x02` for spot orders
- **Field-order sensitive hashing**: Go server re-marshals JSON; fields must match struct order exactly
- **Trailing zero stripping**: `formatQuantity()` strips trailing zeros
- **REST paths**: perps orders use `/api/v1/perps/trade/orders`; spot transfers use `/api/v1/spot/accounts/transfers`; perps transfers use `/api/v1/perps/accounts/transfers`

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

Real data only:
- **SoDEX 1h candles** — real on-chain data
- **SoSoValue 1d klines** — native daily bars (no synthetic expansion)
- **Combined mode** — run both and compare side-by-side

Inputs: full swarm (technical strategies + sentiment + ETF flow + funding + macro), Strategy Builder weights, configurable slippage (0–15 bps), confidence threshold.

Metrics: Total Return, Sharpe, Sortino, Max Drawdown, Win Rate, Profit Factor, Avg Win/Loss, Final Capital, Expectancy, False-Positive Rate, Avg Bars to TP/SL, Max Consecutive Losses, Exit-Reason Breakdown. Optional confidence×leverage parameter sweep sorted by Sharpe.

## Live PnL

Computed only from on-chain closed fills:
- `/api/bot/fills` returns closed position history
- `/api/bot/record-fills` persists new closed trades to `.pnl-trades.json`
- Dashboard `PnLWidget` shows Net PnL, Win Rate, Sharpe, Max Drawdown, equity-curve sparkline, recent trades
- `/bots` `SignalAccuracyPanel` shows hit rate and avg slippage from real fills

## Security Checklist

- [x] All inputs validated via `SecurityAuditor`
- [x] Rate limiting on all mutation endpoints
- [x] Circuit breaker for daily volume
- [x] Duplicate order detection
- [x] Price anomaly detection
- [x] EIP712 domain validation
- [x] Bot private keys encrypted at rest (PBKDF2 + AES-GCM)
- [x] Server-side bot signer removed; no `BOT_PRIVATE_KEY` in env
- [x] Internal API errors sanitized before returning to client

## Critical Rules

1. **Never change field order** in SoDEX request bodies — hash verification will fail.
2. **Always stagger nonces** by ≥100ms when sending multiple signed instructions (SL/TP batching).
3. **Spot↔perp transfers**: spot→perp uses `/api/v1/spot/accounts/transfers` (`name: "spot"` domain, `type: 3`); perp→spot uses `/api/v1/perps/accounts/transfers` (`name: "futures"` domain, `type: 5`).
4. **Master-wallet signed requests omit `X-API-Key`**; API-key signed requests include `X-API-Key: <api-key-name>`. The request body is the params object only (no `type` wrapper).
5. **Quantity precision**: BTC-USD `5`, ETH-USD `4`, SOL-USD `3` — use `formatQuantity(symbol, qty)`.
6. **LLM calls are additive, not essential** — all LLM functions have fallback paths. The bot works without DGRID_API_KEY (falls back to keyword sentiment).
7. **Do not put credentials in `NEXT_PUBLIC_RPC_URL`** — it is inlined into the client bundle. Use a credential-free public RPC or a server-side relay.
8. **No WalletConnect** — MetaMask (`injected()`) only.

## Wave 3 Roadmap

- [x] Copy-trading leaderboard (on-chain SoDEX wallet discovery)
- [x] One-click trade mirroring with proportional position sizing
- [x] Strategy config cards — shareable URLs for bot settings
- [x] Wallet profiles with PnL/win rate analytics
- [ ] Referral program for growth
