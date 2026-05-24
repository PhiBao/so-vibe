# SoVibe — AI-Augmented Perpetual Trading Terminal

> **SoVibe** combines a 7-strategy swarm, DGrid AI intelligence, and deep SoSoValue data to generate explained, executable trading signals on SoDEX testnet.

Built for the **SoSoValue Buildathon — May 2026**.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Target Users](#2-target-users)
3. [Architecture](#3-architecture)
4. [The 7-Strategy Swarm](#4-the-7-strategy-swarm)
5. [Vibe Score v2](#5-vibe-score-v2)
6. [APIs & Data Sources](#6-apis--data-sources)
7. [Setup Instructions](#7-setup-instructions)
8. [Go-to-Market (GTM)](#8-go-to-market-gtm)
9. [Current Implementation](#9-current-implementation)
10. [Roadmap](#10-roadmap)
11. [Project Structure](#11-project-structure)
12. [Key Technical Decisions](#12-key-technical-decisions)

---

## 1. Project Overview

SoVibe turns raw market data + ETF flows + macro context + LLM-analyzed news into executable trades. Every signal includes reasoning. Every signal can be signed on-chain with MetaMask.

### What It Does

1. **7-Strategy Swarm** — 5 technical strategies + DGrid AI sentiment + SoSoValue ETF flow analysis, all voting independently.
2. **Vibe Score v2** — Blends Tech (30%), LLM Sentiment (20%), ETF Flow (15%), Funding (15%), Macro (10%), Market Context (10%) with configurable weights.
3. **LLM Reasoning** — DGrid AI (`gpt-4o-mini`) explains every signal in human-readable text with risk factors.
4. **Strategy Builder** — Toggle strategies ON/OFF and adjust weight sliders. Customize the swarm's personality.
5. **AutoHedge Sizing** — Scales position up 1.5x on full consensus, down 0.5x when signals conflict.
6. **One-Click Execution** — EIP712-signed trades on SoDEX via `eth_signTypedData_v4`.
7. **SL/TP Automation** — Stop-loss and take-profit attached immediately after fill.
8. **Dual-Source Backtesting** — SoDEX testnet 1h candles + SoSoValue 1d klines cross-reference.

### Key Features

| Feature | Status |
|---------|--------|
| SoDEX testnet market orders (EIP712) | Live |
| Stop-loss / Take-profit conditional orders | Live |
| Spot/Perp balance transfer | Live |
| DGrid AI news sentiment (LLM) | Live |
| SoSoValue ETF flow analysis | Live |
| SoSoValue macro event detection | Live |
| SoSoValue market snapshots + cycle position | Live |
| 7-strategy swarm with LLM reasoning | Live |
| Strategy Builder (toggle + weight per strategy) | Live |
| Vibe Score v2 with normalized dynamic weights | Live |
| AutoHedge position sizing | Live |
| Backtest engine (SoDEX + SoSoValue dual source) | Live |
| News feed with currency/tag/category filters | Live |
| Cyberpunk terminal UI | Live |

---

## 2. Target Users

### Primary: Active DeFi Traders
- Trade perpetuals regularly on DEXes
- Want AI-augmented signals, not just chart patterns
- Comfortable with self-custody wallets (MetaMask)
- Want to understand *why* a signal was generated

### Secondary: Strategy Hackers
- Want a hackable, open-source trading engine
- Want to toggle strategies and tune weights
- Want to backtest before deploying capital
- Want to share strategy configs with others

### Tertiary: Copy-Traders (Wave 3)
- Want to discover profitable on-chain wallets
- Want one-click trade mirroring with proportional sizing
- Value transparency and provable track records

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────┐
│              Next.js 16 (App Router)                 │
│  ┌─────────┐ ┌────────┐ ┌────────┐ ┌──────────┐      │
│  │Dashboard│ │ Trade  │ │ Bots   │ │ Backtest │      │
│  └─────────┘ └────────┘ └────────┘ └──────────┘      │
│  ┌────────┐ ┌────────┐ ┌────────┐                    │
│  │Positions│ │ News   │ │Strategy│                   │
│  └────────┘ └────────┘ └────────┘                    │
├──────────────────────────────────────────────────────┤
│                API Routes (Next.js)                  │
│  /api/bot/*  /api/trade  /api/market/*  /api/news    │
│  /api/positions/*  /api/wallet/*  /api/backtest      │
├──────────────────────────────────────────────────────┤
│              DEX Adapter Layer                       │
│           lib/dex/sodex-adapter.ts                   │
│    EIP712 signing · Order builders · Transfers       │
├──────────────────────────────────────────────────────┤
│              Intelligence Engine                     │
│  signals.js  backtest.js  llm-agent.ts  indicators   │
│  funding.js  market.js   etf-flow.js                 │
├──────────────┬───────────────────────────────────────┤
│  SoSoValue   │  DGrid AI            SoDEX Testnet    │
│  (9 modules) │  (200+ LLMs)         (chain 138565)   │
└──────────────┴───────────────────────────────────────┘
```

---

## 4. The 7-Strategy Swarm

Every 60s cycle, the engine runs 7 independent strategies. Each votes independently. No single strategy can force a trade.

| # | Strategy | Source | Signal | Best In |
|---|----------|--------|--------|---------|
| 1 | **Trend Following** | EMA 9/21/50 cross + RSI filter + ATR | Directional | Trending markets |
| 2 | **Mean Reversion** | Bollinger Bands + RSI extremes + volume | Contrarian | Range-bound |
| 3 | **Momentum** | MACD histogram cross + volume surge | Directional | Breakouts |
| 4 | **S/R Bounce** | Support/Resistance detection + RSI | Contrarian | Reversals |
| 5 | **Volume Breakout** | Volume spike >2x avg + EMA alignment | Directional | High volatility |
| 6 | **DGrid AI Sentiment** | LLM analyzes SoSoValue news → score + narratives | Macro | News-driven |
| 7 | **ETF Flow** | SoSoValue ETF net inflow/outflow + trend | Macro | Institutional flow |

### DGrid AI Sentiment (Strategy 6)
- Replaced the old keyword-matching sentiment engine ("surge" = bullish, "crash" = bearish)
- Sends currency-matched SoSoValue news headlines to `gpt-4o-mini` via DGrid Gateway
- Returns: `{ score: -1..1, confidence: 0..1, reasoning, keyNarratives[] }`
- Falls back to keyword matching if `DGRID_API_KEY` not configured

### ETF Flow (Strategy 7)
- Pulls real-time ETF net inflow/outflow from SoSoValue (`/etfs/summary-history`)
- Supports BTC, ETH, SOL, and 7 other assets
- Signal amplifies with consecutive flow days: 3+ days → 1.15x, 5+ days → 1.3x
- Net inflows → bullish (institutions buying); net outflows → bearish (redemptions)

### Strategy Builder
Located at `/bots`:
- **ON/OFF toggle** per strategy — disabled strategies are skipped entirely
- **Weight slider** 0-100% per strategy — normalized to always sum to 1.0
- **Config card export** — copy JSON to share your strategy setup

---

## 5. Vibe Score v2

The Vibe Score blends 6 weighted components. All weights are dynamically normalized from Strategy Builder config — they always sum to 1.0 regardless of user settings.

| Component | Default Weight | Source |
|-----------|---------------|--------|
| Technical Consensus | 30% | Weighted average of 5 technical strategies |
| DGrid AI Sentiment | 20% | LLM-scored news sentiment |
| ETF Flow | 15% | SoSoValue ETF net inflow/outflow |
| Funding Rate Bias | 15% | Positive funding → short bias |
| Macro Context | 10% | FOMC/CPI/NFP proximity detection |
| Market Structure | 10% | Cycle position, ATH distance |

**Full consensus** triggers when tech, sentiment, ETF, and funding all agree. This activates the 1.5x AutoHedge size multiplier.

### AutoHedge Position Sizer

| Condition | Multiplier | Behavior |
|-----------|-----------|----------|
| Full consensus | **1.5x** | Max conviction |
| Strong alignment | **1.25x** | Moderate boost |
| Neutral | **1.0x** | Base size |
| Mild conflict | **0.75x** | Reduce |
| Strong conflict | **0.50x** | Hedge mode |

---

## 6. APIs & Data Sources

### SoDEX (Primary DEX)
- **Testnet**: `https://testnet-gw.sodex.dev`
- **Auth**: EIP712 typed data signatures
- **Routes**: Markets, candles, orderbook, order submission, account state, spot/perp transfers
- **Chain ID**: 138565

### SoSoValue (Data Layer)
- **Endpoint**: `https://openapi.sosovalue.com/openapi/v1`
- **Auth**: `x-soso-api-key` header
- **Modules Used** (9 of 9):

| Module | Key Endpoints | Usage |
|--------|--------------|-------|
| Feeds/News | `/news`, `/news/hot`, `/news/search` | Sentiment input + news page |
| ETF | `/etfs/summary-history` | ETF flow strategy |
| Currency | `/currencies/{id}/market-snapshot` | Cycle position, ATH distance |
| Macro | `/macro/events` | FOMC/CPI/NFP detection |
| Indices | `/indices` | Market breadth context |
| Crypto Stocks | `/crypto-stocks` | Cross-market correlation |
| Fundraising | `/fundraising/projects` | Ecosystem health |
| Analysis Charts | `/analyses` | SoSoValue chart data |

### DGrid AI (Intelligence Layer)
- **Endpoint**: `https://api.dgrid.ai/v1`
- **Auth**: `DGRID_API_KEY` header (OpenAI-compatible)
- **Model**: `openai/gpt-4o-mini`
- **Functions**: News sentiment analysis, market regime classification, signal reasoning
- **Cost**: ~$0.001 per bot cycle

---

## 7. Setup Instructions

### Prerequisites
- Node.js 20+
- MetaMask browser extension
- SoDEX testnet configured in MetaMask (chain 138565)

### Install
```bash
cd web
npm install
```

### Environment
Create `web/.env`:
```bash
DEX_PROVIDER=sodex
DEX_TESTNET=true
SOSO_API_KEY=your-sosovalue-api-key
DGRID_API_KEY=your-dgrid-api-key
NEXT_PUBLIC_RPC_URL=https://testnet-v2.valuechain.xyz/
```

### Run
```bash
npm run dev
```

Open `http://localhost:3000`. Connect MetaMask. Fund with testnet USDC. Start the bot.

---

## 8. Go-to-Market (GTM)

### Phase 1: Hackathon Launch (Current)
- Public demo at SoSoValue Buildathon
- Strategy Builder as the differentiator — configurable, not black-box
- Content: "How we built an AI trading terminal on SoDEX"

### Phase 2: Copy-Trading (Wave 3)
- **Discovery**: On-chain SoDEX wallet leaderboard
- **Mirroring**: One-click copy with proportional position sizing
- **Viral loop**: Every copied wallet is a growth channel. "Copy my trades on SoVibe."
- **Referral**: Fee rebates for copier referrals

### Monetization
- **Free**: 5 signals/day, basic strategies
- **Pro** ($29/mo): Unlimited signals, custom strategy weights, API access
- **Institutional**: White-label, custom risk parameters

---

## 9. Current Implementation

### What's Live (Wave 2)

| Module | Status |
|--------|--------|
| SoDEX Adapter (EIP712, all order types) | Complete |
| 7-Strategy Swarm (5 tech + LLM + ETF) | Complete |
| DGrid AI Integration (sentiment + reasoning) | Complete |
| SoSoValue ETF Flow Strategy | Complete |
| SoSoValue Macro Event Detection | Complete |
| SoSoValue Market Snapshots | Complete |
| Strategy Builder (toggle + weight) | Complete |
| Vibe Score v2 (normalized dynamic weights) | Complete |
| AutoHedge Position Sizing | Complete |
| Trade Execution + SL/TP | Complete |
| Dual-Source Backtest (SoDEX + SoSoValue) | Complete |
| News Feed (currency/category/tag filtered) | Complete |
| Cyberpunk Terminal UI | Complete |

---

## 10. Roadmap

### Wave 3: Copy-Trading Terminal (Next)

| Feature | Description |
|---------|-------------|
| Wallet Discovery | Scan SoDEX on-chain for profitable wallets |
| Trade Mirroring | One-click proportional position copying |
| Wallet Profiles | Public PnL, win rate, strategy type |
| Strategy Cards | Shareable bot config via URL/JSON |
| Referral Program | Fee rebates for copier referrals |
| Leaderboard | Top wallets by Sharpe, consistency |

---

## 11. Project Structure

```
web/
├── app/
│   ├── api/
│   │   ├── bot/              # Bot cycle, execute, signals, status, toggle
│   │   ├── market/           # Market data (price, orderbook)
│   │   ├── markets/          # All market limits
│   │   ├── news/             # Enriched SoSoValue news (symbol, category, tags)
│   │   ├── positions/        # Close position, SL/TP builder
│   │   ├── status/           # System status
│   │   ├── trade/            # Manual trade order builder
│   │   ├── wallet/           # Balance, deposit, withdraw
│   │   └── backtest/         # Backtest (SoDEX + SoSoValue dual source)
│   ├── backtest/             # Backtest UI
│   ├── bots/                 # Bot control + strategy builder + execution
│   ├── news/                 # News feed with symbol filter, AI badges
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
│   │   ├── indicators.js     # Technical indicators (RSI, MACD, BB, EMA, ATR)
│   │   ├── funding.js        # Funding rate + liquidation analysis
│   │   ├── market.js         # Market data wrapper
│   │   ├── llm-agent.ts      # DGrid AI client (sentiment, regime, reasoning)
│   │   └── strategies/
│   │       └── etf-flow.js   # ETF flow strategy module
│   ├── sosovalue/
│   │   ├── etf.ts            # SoSoValue ETF data + signal analysis
│   │   ├── market.ts         # Market snapshot + cycle position
│   │   └── macro.ts          # Macro events (FOMC, CPI, NFP detection)
│   ├── sosovalue.ts          # SoSoValue API client (30+ endpoints, 9 modules)
│   ├── sentiment-engine.ts   # LLM-powered news sentiment (DGrid) + fallback
│   ├── signal-store.ts       # Server-side signal persistence
│   ├── use-sodex-tx.ts       # EIP712 signing hook (perps + spot domains)
│   ├── security.ts           # Security auditor
│   └── data-store.ts         # State storage
```

---

## 12. Key Technical Decisions

1. **EIP712 over API keys** — SoDEX uses EIP712 typed data for auth. Signatures via `eth_signTypedData_v4`. Prefixes: `0x01` (perps), `0x02` (spot).

2. **DGrid AI via OpenAI SDK** — OpenAI-compatible means zero integration friction. Model switched by changing a config string. All LLM functions have fallback paths.

3. **SoSoValue as data backbone** — 9 API modules drive everything: ETF flows for institutional signal, macro events for timing, market snapshots for cycle context.

4. **Normalized dynamic weights** — Strategy Builder weights always normalize to 1.0 regardless of user input. Can't crash, can't overflow.

5. **Field-order sensitive hashing** — SoDEX Go server re-marshals JSON. Field order must match struct exactly.

6. **Client-side bot state** — Config and logs in `localStorage`. Server is stateless and Vercel-compatible.

7. **Spot domain separation** — Spot transfers use separate EIP712 domain (`name: "spot"`) from perps (`name: "futures"`).

---

*Built for the SoSoValue Buildathon — May 2026*
