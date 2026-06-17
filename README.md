# SoVibe — AI-Augmented Perpetual Trading Terminal

> **SoVibe** combines a 7-strategy swarm, DGrid AI intelligence, deep SoSoValue data, and copy-trading to generate explained, executable signals on SoDEX testnet and mainnet.

Built for the **SoSoValue Buildathon — May 2026**.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Target Users](#2-target-users)
3. [Architecture](#3-architecture)
4. [The 7-Strategy Swarm](#4-the-7-strategy-swarm)
5. [Vibe Score v2](#5-vibe-score-v2)
6. [Copy-Trading](#6-copy-trading)
7. [APIs & Data Sources](#7-apis--data-sources)
8. [Setup Instructions](#8-setup-instructions)
9. [Go-to-Market (GTM)](#9-go-to-market-gtm)
10. [Current Implementation](#10-current-implementation)
11. [Roadmap](#11-roadmap)
12. [Project Structure](#12-project-structure)
13. [Key Technical Decisions](#13-key-technical-decisions)

---

## 1. Project Overview

SoVibe turns raw market data + ETF flows + macro context + LLM-analyzed news into executable trades. Every signal includes reasoning. Every signal can be signed on-chain. You can also copy any wallet on SoDEX.

### What It Does

1. **7-Strategy Swarm** — 5 technical strategies + DGrid AI sentiment + SoSoValue ETF flow analysis, all voting independently.
2. **Vibe Score v2** — Blends Tech, LLM Sentiment, ETF Flow, Funding, Macro, Market Context with configurable normalized weights.
3. **LLM Reasoning** — DGrid AI (`gpt-4o-mini`) explains every signal with risk factors.
4. **Strategy Builder** — Toggle strategies ON/OFF, adjust weight sliders. Export config as JSON or shareable URL.
5. **Copy-Trading** — Analyze any SoDEX wallet: Win rate, Sharpe, Profit Factor. One-click proportional mirroring.
6. **AutoHedge Sizing** — Scales position 1.5x on full consensus, 0.5x on conflict.
7. **One-Click Execution** — EIP712-signed trades via `eth_signTypedData_v4`.
8. **Dual-Source Backtesting** — SoDEX 1h candles + SoSoValue 1d klines cross-reference.

### Key Features

| Feature | Status |
|---------|--------|
| 7-strategy swarm with LLM reasoning | Live |
| DGrid AI news sentiment + regime classification | Live |
| SoSoValue ETF flow analysis | Live |
| SoSoValue macro event detection | Live |
| Strategy Builder (toggle + weight per strategy) | Live |
| Strategy config sharing (JSON + URL cards) | Live |
| Wallet analyzer (metrics + strategy classification) | Live |
| Copy-trading (one-click proportional mirroring) | Live |
| SoDEX EIP712 market orders | Live |
| SL/TP automation | Live |
| Dual-source backtest with real data only, slippage modeling, parameter sweep | Live |
| Live PnL + Signal Accuracy from on-chain fills | Live |
| Copy-trading leaderboard with curated wallet discovery | Live |
| Encrypted local auto-trading bot keys | Live |
| Testnet / mainnet network switch | Live |
| Full SoSoValue news with currency/tag/category filters | Live |
| Cyberpunk terminal UI | Live |

---

## 2. Target Users

### Primary: Active DeFi Traders
- Trade perpetuals regularly on DEXes
- Want AI-augmented signals, not just chart patterns
- Comfortable with MetaMask self-custody

### Secondary: Copy-Traders
- Want to discover profitable wallets and mirror their trades
- Value transparent, verifiable track records on-chain
- Want proportional position sizing

### Tertiary: Strategy Hackers
- Want to toggle strategies, tune weights, share configs
- Want to backtest before deploying capital

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────┐
│              Next.js 16 (App Router)                 │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐    │
│  │Dashboard│ │ Trade  │ │ Bots   │ │ Wallet   │    │
│  └────────┘ └────────┘ └────────┘ └──────────┘    │
│  ┌────────┐ ┌────────┐ ┌──────────┐                 │
│  │Positions│ │ News   │ │ Backtest │                 │
│  └────────┘ └────────┘ └──────────┘                 │
├──────────────────────────────────────────────────────┤
│                API Routes (Next.js)                  │
│  /api/bot/*  /api/trade  /api/wallet/*  /api/news   │
│  /api/positions/*  /api/backtest  /api/config       │
├──────────────────────────────────────────────────────┤
│              DEX Adapter Layer                       │
│           lib/dex/sodex-adapter.ts                   │
│    EIP712 signing · Orders · Transfers · Profiles    │
├──────────────────────────────────────────────────────┤
│              Intelligence Engine                     │
│  signals.js  backtest.js  llm-agent.ts  indicators   │
│  funding.js  market.js   etf-flow.js                 │
├──────────────┬───────────────────────────────────────┤
│  SoSoValue   │  DGrid AI            SoDEX Network    │
│  (9 modules) │  (200+ LLMs)         (testnet/mainnet)│
└──────────────┴───────────────────────────────────────┘
```

---

## 4. The 7-Strategy Swarm

| # | Strategy | Source | Best In |
|---|----------|--------|---------|
| 1 | **Trend Following** | EMA 9/21/50 cross + RSI + ATR | Trending markets |
| 2 | **Mean Reversion** | Bollinger Bands + RSI extremes | Range-bound |
| 3 | **Momentum** | MACD histogram cross + volume | Breakouts |
| 4 | **S/R Bounce** | Support/Resistance + RSI | Reversals |
| 5 | **Volume Breakout** | Volume spike >2x avg + EMA | High volatility |
| 6 | **DGrid AI Sentiment** | LLM analyzes SoSoValue news | News-driven |
| 7 | **ETF Flow** | SoSoValue ETF net inflow/outflow | Institutional flow |

All 7 strategies vote independently. Strategy Builder at `/bots` lets you toggle any strategy ON/OFF and adjust its weight.

---

## 5. Vibe Score v2

| Component | Default Weight | Source |
|-----------|---------------|--------|
| Technical Consensus | 30% | 5 technical strategies |
| DGrid AI Sentiment | 20% | LLM-scored news |
| ETF Flow | 15% | SoSoValue ETF data |
| Funding Rate Bias | 15% | SoDEX funding rate |
| Macro Context | 10% | FOMC/CPI/NFP detection |
| Market Structure | 10% | Cycle position, ATH distance |

Weights auto-normalize from Strategy Builder config — always sum to 1.0, never crash.

---

## 6. Copy-Trading

### Wallet Analyzer (`/wallet`)
Paste any SoDEX wallet address to see:
- **Performance**: Win Rate, Profit Factor, Sharpe, Max Drawdown, Total Return
- **Strategy Classification**: Automatically classified as scalper, day trader, swing trader, momentum, carry trader
- **Current Positions**: What they're holding right now
- **Activity**: Total trades, avg hold time, funding earned/paid, last active

### One-Click Copy
- **Proportional sizing**: Your allocation / their equity * their position size
- **Batch execution**: All positions copied in sequence with nonce staggering
- **Same EIP712 pipeline**: Reuses existing market order + signing flow

---

## 7. APIs & Data Sources

### SoDEX (Primary DEX)
- **Testnet**: `https://testnet-gw.sodex.dev` · Chain ID `138565`
- **Mainnet**: `https://mainnet-gw.sodex.dev` · Chain ID `286623`
- **Auth**: EIP712 typed data signatures
- **Network switch**: Header dropdown persists choice in `web/.runtime-config.json`

### SoSoValue (Data Layer) — 9 modules

| Module | Used For |
|--------|----------|
| Feeds/News | LLM sentiment input, news page |
| ETF | ETF flow strategy |
| Currency | Cycle position, ATH distance |
| Macro | FOMC/CPI/NFP detection |
| Indices | Market breadth |
| Crypto Stocks | Cross-market correlation |
| Fundraising | Ecosystem health |
| Analysis Charts | SoSoValue charts |

### DGrid AI (Intelligence Layer)
- **Model**: `openai/gpt-4o-mini` via `https://api.dgrid.ai/v1`
- **Functions**: News sentiment analysis, market regime classification, signal reasoning
- **Cost**: ~$0.001 per bot cycle

---

## 8. Setup Instructions

### Prerequisites
- Node.js 20+, MetaMask, SoDEX testnet or mainnet in wallet (chain 138565 or 286623)

### Install
```bash
cd web
npm install
```

### Environment
```bash
DEX_PROVIDER=sodex
DEX_NETWORK=testnet          # testnet | mainnet
SOSO_API_KEY=your-sosovalue-api-key
DGRID_API_KEY=your-dgrid-api-key
NEXT_PUBLIC_RPC_URL=https://testnet-v2.valuechain.xyz/   # or mainnet RPC
```

### Run
```bash
npm run dev   # localhost:3000
```

---

## 9. Go-to-Market (GTM)

### Phase 1: Hackathon Launch (Current)
- Demo at SoSoValue Buildathon
- Strategy Builder as differentiator
- Copy-trading as viral hook

### Phase 2: Growth
- **Wallet profiles** → shareable links → discovery loop
- **Strategy cards** → import by URL → adoption loop
- **Referral program** → fee rebates for copier referrals

### Monetization
- **Free**: 5 signals/day, basic strategies, limited copy-trades
- **Pro** ($29/mo): Unlimited signals, custom weights, full copy-trading, API access

---

## 10. Current Implementation

| Module | Status |
|--------|--------|
| SoDEX Adapter (EIP712, all order types, wallet profiles) | Complete |
| 7-Strategy Swarm + Strategy Builder | Complete |
| DGrid AI Integration | Complete |
| SoSoValue Deep Integration (9 modules) | Complete |
| Vibe Score v2 + AutoHedge | Complete |
| Copy-Trading (profile analysis + mirroring) | Complete |
| Strategy Config Card Sharing (JSON + URL) | Complete |
| Dual-Source Backtest | Complete |
| News Feed (filtered, enriched) | Complete |
| Cyberpunk Terminal UI | Complete |

---

## 11. Roadmap

### Done — Wave 3
- [x] Mainnet / testnet network switch with runtime persistence
- [x] Encrypted local auto-trading bot keys (PBKDF2 + AES-GCM)
- [x] Copy-trading leaderboard with curated wallet ranking
- [x] Wallet profile reuse across profile and leaderboard APIs
- [x] Multi-timeframe signal aggregation (15m / 1h / 4h / 1d)
- [x] Robust real-data-only backtest with slippage modeling, false-positive analysis, parameter sweep
- [x] Live PnL + Signal Accuracy computed from on-chain fills
- [x] Dashboard PnL widget with equity-curve sparkline
- [x] Live strategy performance scorecard + file-based PnL
- [x] Hardened security: client-side bot signing, sanitized API errors

### Done — Wave 2
- [x] DGrid AI intelligence layer
- [x] SoSoValue deep integration (ETF, macro, market snapshots)
- [x] Strategy Builder with toggle + weight
- [x] LLM reasoning + explainability
- [x] Dual-source backtest
- [x] Config card sharing
- [x] Copy-trading

### Next / Research
- **Walk-forward analysis** — split historical data into in-sample training and out-of-sample validation periods to measure signal decay.
- **Adaptive strategy weights** — let the bot rebalance swarm weights based on recent live performance per strategy.
- **On-chain fill slippage model** — build a per-symbol slippage estimator from actual executed fills rather than static bps assumptions.
- **Monte-Carlo simulation** — run thousands of randomized equity-path simulations on top of backtest trades to estimate tail-risk probabilities.
- **Referral + copy-trading incentives** — on-chain referral codes and follower fee rebates.

---

## 12. Project Structure

```
web/
├── app/
│   ├── api/
│   │   ├── bot/              # Bot cycle, auto-execute, execute, signals, status, toggle, PnL, fills, register-key
│   │   ├── config/           # Runtime network config persistence
│   │   ├── market/           # Market data
│   │   ├── markets/          # All market limits
│   │   ├── news/             # Enriched SoSoValue news
│   │   ├── positions/        # Close position, SL/TP
│   │   ├── wallet/           # Balance, deposit, withdraw, profile, copy, leaderboard
│   │   └── backtest/         # Real-data backtest
│   ├── backtest/             # Backtest UI
│   ├── bots/                 # Bot control + strategy builder
│   ├── news/                 # News feed with filters
│   ├── positions/            # Position monitor
│   ├── settings/             # Network + encrypted bot key settings
│   ├── trade/                # Manual trade execution
│   ├── wallet/               # Wallet analyzer + leaderboard
│   ├── globals.css           # Cyberpunk design system
│   ├── layout.tsx            # Terminal layout wrapper
│   ├── page.tsx              # Dashboard
│   └── providers.tsx         # Wallet context
├── components/
│   ├── TerminalLayout.tsx    # Sidebar + nav + wallet panel
│   ├── NetworkSwitch.tsx     # TESTNET/MAINNET dropdown
│   ├── PnLWidget.tsx         # Dashboard live PnL + equity curve
│   ├── ToastProvider.tsx     # Toast notifications
│   └── WalletProvider.tsx    # Wagmi provider
├── lib/
│   ├── dex/
│   │   ├── types.ts          # DEX types + wallet profile types
│   │   ├── index.ts          # Factory + config
│   │   └── sodex-adapter.ts  # SoDEX adapter + wallet methods
│   ├── engine/
│   │   ├── signals.js        # 7-strategy swarm + Vibe Score v2
│   │   ├── backtest.js       # Backtest engine (real data, slippage, parameter sweep)
│   │   ├── indicators.js     # Technical indicators
│   │   ├── funding.js        # Funding rate analysis
│   │   ├── market.js         # Market data wrapper
│   │   ├── llm-agent.ts      # DGrid AI client
│   │   ├── pnl-tracker.ts    # File-based closed-trade PnL persistence
│   │   └── strategies/
│   │       └── etf-flow.js   # ETF flow strategy
│   ├── sosovalue/
│   │   ├── etf.ts            # SoSoValue ETF data
│   │   ├── market.ts         # Market snapshot + cycle position
│   │   └── macro.ts          # Macro events
│   ├── sosovalue.ts          # SoSoValue API client (30+ endpoints)
│   ├── sentiment-engine.ts   # LLM-powered sentiment
│   ├── signal-store.ts       # Signal persistence
│   ├── use-sodex-tx.ts       # EIP712 signing hook
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

---

## 13. Key Technical Decisions

1. **EIP712 over API keys** — SoDEX uses typed data signatures. `0x01` perps, `0x02` spot prefix.
2. **All wallet endpoints are public READ** — Copy-trading requires no auth to analyze any wallet.
3. **DGrid via OpenAI SDK** — Zero integration friction. Models switch via config string.
4. **Normalized dynamic weights** — Strategy Builder weights always sum to 1.0.
5. **Field-order sensitive hashing** — Go server re-marshals JSON. Field order must match.
6. **Client-side bot state** — Config/logs in `localStorage`. Server stateless.
7. **Spot/perp domain separation** — `name: "spot"` vs `name: "futures"`.

---

*Built for the SoSoValue Buildathon — May 2026*
