# SoVibe — Agentic Perp Trading Terminal

> **SoVibe** is a AI-augmented perpetual trading terminal that combines a 6-strategy technical swarm with real-time SoSoValue news sentiment to generate actionable trading signals on SoDEX.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Target Users](#2-target-users)
3. [Core Logic & Architecture](#3-core-logic--architecture)
4. [APIs & Data Sources](#4-apis--data-sources)
5. [Setup Instructions](#5-setup-instructions)
6. [Go-to-Market (GTM)](#6-go-to-market-gtm)
7. [Vision](#7-vision)
8. [Current Implementation](#8-current-implementation)
9. [Roadmap: Next Two Waves](#9-roadmap-next-two-waves)
10. [Project Structure](#10-project-structure)
11. [Key Technical Decisions](#11-key-technical-decisions)

---

## 1. Project Overview

**SoVibe** turns raw market data + news sentiment into executable trades. No mock data. No dead buttons. Every signal can be signed and sent on-chain.

### What It Does

1. **6-Strategy Swarm Analysis** — Runs 5 technical strategies (Trend Following, Mean Reversion, Momentum, S/R Bounce, Volume Breakout) + SoSoValue sentiment on every market cycle.
2. **Vibe Score** — Blends technical consensus (50%), SoSoValue sentiment (30%), and funding rate bias (20%) into a single confidence metric.
3. **AutoHedge Sizing** — Scales position size up 1.5x on full consensus and down 0.5x when sentiment conflicts with technicals.
4. **One-Click Execution** — Builds EIP712-signed transactions for SoDEX and submits via `eth_signTypedData_v4`.
5. **SL/TP Automation** — Attaches stop-loss and take-profit conditional orders immediately after market orders settle.
6. **Spot/Perp Transfer** — Deposit and withdraw between spot and perpetual balances natively.
7. **Backtesting** — Tests the swarm on 1,000 hours of historical candles (real SoDEX data with synthetic fallback).

### Key Features

| Feature | Status |
|---------|--------|
| SoDEX testnet market orders (EIP712) | Live |
| Stop-loss / Take-profit conditional orders | Live |
| Position close (market order) | Live |
| Spot/Perp balance transfer | Live |
| Real-time SoSoValue news sentiment | Live |
| 6-strategy technical swarm | Live |
| Vibe Score consensus engine | Live |
| AutoHedge position sizing | Live |
| Dynamic market dropdown (all SoDEX pairs) | Live |
| Sidebar market ticker + wallet balances | Live |
| Backtest engine with synthetic fallback | Live |
| Toast notification system | Live |

---

## 2. Target Users

### Primary: Active DeFi Traders
- Trade perpetuals regularly on DEXes
- Want sentiment-aware signals, not just chart patterns
- Comfortable with self-custody wallets (MetaMask)
- Frustrated by CEX bias and want DEX-native execution

### Secondary: Quant/Sysop Developers
- Want a hackable, open-source trading engine
- Need DEX-agnostic adapter layer for multi-DEX bots
- Want to backtest strategies before deploying capital

### Tertiary: Crypto Researchers & Analysts
- Want to study correlation between news sentiment and price action
- Need clean, exportable signal data
- Want to validate swarm consensus vs. individual strategies

---

## 3. Core Logic & Architecture

```
┌─────────────────────────────────────────┐
│           Next.js 16 (App Router)       │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐   │
│  │Dashboard│ │ Trade   │ │  Bots    │   │
│  └─────────┘ └─────────┘ └──────────┘   │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐   │
│  │Positions│ │Backtest │ │  News    │   │
│  └─────────┘ └─────────┘ └──────────┘   │
├─────────────────────────────────────────┤
│           API Routes (Next.js)          │
│  /api/trade  /api/bot/*  /api/market/*  │
│  /api/positions/*  /api/backtest        │
│  /api/wallet/* (balance, deposit, wd)   │
├─────────────────────────────────────────┤
│         DEX Adapter Layer               │
│      lib/dex/sodex-adapter.ts           │
│  • EIP712 signing  • Order builders     │
│  • Transfer builders • Format helpers   │
├─────────────────────────────────────────┤
│         Trading Engine (JS)             │
│  signals.js  backtest.js  indicators.js │
│  sentiment-engine.ts  signal-store.ts   │
├─────────────────────────────────────────┤
│         SoDEX Testnet API               │
│ testnet-gw.sodex.dev/api/v1/(spot|perps)│
└─────────────────────────────────────────┘
```

### The 6-Strategy Swarm

Every market cycle, the engine runs **six independent strategies** on the latest 1h candle data. Each strategy outputs a signal in the range `[-1.0, 1.0]`, a confidence score `[0, 1]`, and optional stop-loss / take-profit levels. The strategies vote independently; no single strategy can force a trade.

| # | Strategy | Philosophy | Primary Indicators |
|---|----------|-----------|-------------------|
| 1 | **Trend Following** | *The trend is your friend* | EMA 9/21/50 cross, RSI filter, ATR-based SL |
| 2 | **Mean Reversion** | *Prices return to the mean* | Bollinger Bands, RSI extremes, volume confirmation |
| 3 | **Momentum** | *Follow the acceleration* | MACD histogram cross, volume surge, RSI continuation |
| 4 | **S/R Bounce** | *Key levels hold until they break* | Local support / resistance detection, distance + RSI filter |
| 5 | **Volume Breakout** | *Volume precedes price* | Volume spike >2x average, price change >0.5%, EMA alignment |
| 6 | **SoSoValue Sentiment** | *News moves markets* | SoSoValue news sentiment score & article volume |

#### 1. Trend Following (`trend_following`)
- **Logic**: Requires full EMA stack alignment (`EMA9 > EMA21 > EMA50` for long; inverse for short). A fresh EMA9/21 cross boosts the signal to max strength (`±1.0`). RSI must not be in overbought/oversold territory (<65 for long, >35 for short) to avoid chasing exhausted moves.
- **Stop Loss**: `1.5 × ATR` below entry (long) or above (short).
- **Signal Range**: `0.0 → 0.7` (aligned trend) or `1.0` (fresh cross).

#### 2. Mean Reversion (`mean_reversion`)
- **Logic**: Looks for price outside Bollinger Bands (`±2σ`) combined with RSI extremes (`<30` or `>70`). If volume spikes (>1.5× average) simultaneously, the signal strengthens to `±1.0`. Also detects middle-band bounces when price hugs the SMA20 with neutral RSI.
- **Stop Loss**: Just beyond the breached band (`lower − 1×ATR` for long, `upper + 1×ATR` for short).
- **Signal Range**: `0.0 → 0.8` (band breach) or `1.0` (volume confirmation).

#### 3. Momentum (`momentum`)
- **Logic**: MACD histogram cross is the trigger. Bullish when histogram flips positive with RSI < 65; bearish when histogram flips negative with RSI > 35. Volume >1.3× average amplifies confidence. Continuation mode activates when histogram extends in-trend with RSI in the 30-70 sweet spot.
- **Stop Loss**: `2 × ATR` — wider than trend-following because momentum trades are noisier.
- **Signal Range**: `0.0 → 0.9` (cross + volume) or `0.6` (cross alone).

#### 4. Support / Resistance Bounce (`sr_bounce`)
- **Logic**: Scans recent candles for local minima (supports) and maxima (resistances). If price sits within 1% of a support level and RSI < 40, it generates a long signal weighted by the level's historical strength. Inverse for resistance rejection. Automatically sets take-profit at the opposing level.
- **Stop Loss**: The support/resistance level itself (or 3% fallback if level is lost).
- **Signal Range**: `0.0 → 0.7` scaled by `level_strength × 0.1`.

#### 5. Volume Breakout (`volume_breakout`)
- **Logic**: Detects when volume exceeds 2× the 20-candle average and price moves >0.5% in the same candle. Direction is confirmed by EMA alignment (bullish if `EMA9 > EMA21`). Also detects volume divergence (price up, volume down → fade the move).
- **Stop Loss**: `1.5 × ATR`.
- **Signal Range**: `0.0 → 1.0` proportional to `volRatio × 0.3`.

#### 6. SoSoValue Sentiment (`sosovalue_sentiment`)
- **Logic**: Treats external news sentiment as a **peer voter** with equal weight, not a post-processing layer. The SoSoValue news API returns a `score` (-1 to 1) and `confidence` (0 to 1). If confidence < 0.2 or no articles exist, the strategy abstains (signal = 0). Otherwise it votes `score × min(1, confidence × 1.5)`.
- **No SL/TP**: Sentiment is a directional bias, not a technical level.
- **Signal Range**: `0.0 → ±1.0`.

### Swarm Synthesis (`synthesizeSignals`)

The swarm synthesizer collects all non-zero votes and computes a **weighted average** where each strategy's vote is weighted by its confidence:

```
finalSignal = Σ(signal_i × confidence_i) / Σ(confidence_i)
```

**Consensus rules:**
- **Agreement bonus**: If ≥3 strategies agree on direction, confidence gets a `+0.15` bonus.
- **Consensus filter**: The trade only fires if ≥2 strategies support the final direction, OR the weighted signal is very strong (`|signal| ≥ 0.6`), OR only 1 strategy is active (no opposition).
- **Action thresholds**: `finalSignal ≥ +0.25` → **LONG**; `finalSignal ≤ −0.25` → **SHORT**; otherwise **HOLD**.

### Vibe Score

The Vibe Score blends three macro inputs into a single sentiment metric used for position sizing and hedging:

| Component | Weight | Source |
|-----------|--------|--------|
| Technical consensus | 50% | Average of all 6 strategy signals |
| SoSoValue sentiment | 30% | News sentiment score |
| Funding rate bias | 20% | Positive funding = short bias (overleveraged longs), negative = long bias |

- `+1.0` = extreme bullish consensus across all three pillars.
- `−1.0` = extreme bearish consensus.
- `0` = neutral or conflicting.

**Full consensus**: When all three pillars agree on direction (`tech > 0.2`, `sentiment > 0.1`, `funding > 0` for long; inverse for short), the `fullConsensus` flag is set.

### AutoHedge Position Sizer

Position size is adjusted based on how well the **Vibe Score aligns** with the **dominant technical signal**:

| Condition | Size Multiplier | Behavior |
|-----------|-----------------|----------|
| Full consensus (all 3 agree) | **1.5×** | Max conviction — size up |
| Strong alignment (vibe × tech > 0.3) | **1.25×** | High confidence — moderate boost |
| Neutral / mild alignment | **1.0×** | Base size |
| Mild conflict (alignment < 0) | **0.75×** | Reduce exposure |
| Strong conflict (alignment < −0.2) | **0.5×** | Hedge mode — half size |

Confidence is also folded in: `sizeMultiplier *= (0.5 + confidence × 0.5)`, so low-confidence signals always trade smaller.

### Design System
- **Cyberpunk terminal** aesthetic — CRT scanlines, mono fonts, neon accents
- **Colors**: Cyan (`#00f0ff`), Green (`#00ff41`), Red (`#ff0040`)
- **Font**: JetBrains Mono
- All text is uppercase mono with bracket-style buttons `[ LABEL ]`

---

## 4. APIs & Data Sources

### SoDEX (Primary DEX)
- **Endpoint**: `https://testnet-gw.sodex.dev`
- **Routes Used**:
  - `GET /api/v1/perps/markets/symbols` — all trading pairs
  - `GET /api/v1/perps/markets/{symbol}/klines` — candle data
  - `GET /api/v1/perps/markets/{symbol}/orderbook` — L2 book
  - `GET /api/v1/perps/accounts/{address}/state` — balances + positions
  - `POST /api/v1/perps/exchange` — order submission (EIP712 signed)
  - `POST /api/v1/spot/exchange` — spot/perp transfers (EIP712 signed)
- **Auth**: EIP712 typed data signatures with `0x01` (perps) / `0x02` (spot) prefix

### SoSoValue (Sentiment & News)
- **Endpoint**: `https://openapi.sosovalue.com/openapi/v1`
- **Routes Used**:
  - `GET /news/hot` — hot crypto news feed
- **Auth**: `x-soso-api-key` header
- **Integration**: News articles are scored for sentiment per symbol proximity and headline tone, then fed as the 6th vote in the swarm

### Internal APIs
- `/api/bot/cycle` — runs one analysis cycle, returns signals
- `/api/bot/execute` — builds market order via adapter
- `/api/positions/sl-tp` — builds conditional orders
- `/api/backtest` — runs historical simulation
- `/api/wallet/balance` — fetches spot + perp balances
- `/api/wallet/deposit` — builds spot→perp transfer
- `/api/wallet/withdraw` — builds perp→spot transfer

---

## 5. Setup Instructions

### Prerequisites
- Node.js 20+
- npm or pnpm
- MetaMask browser extension

### Install
```bash
cd web
npm install
```

### Environment
Create `.env.local`:
```bash
DEX_PROVIDER=sodex
DEX_TESTNET=true
SOSO_API_KEY=your-sosovalue-api-key
NEXT_PUBLIC_RPC_URL=https://testnet-v2.valuechain.xyz/
```

### Run
```bash
npm run dev
```

Open `http://localhost:3000`, fund your SoDEX account with testnet USDC via the faucet link.

### Build
```bash
npm run build
```

---

## 6. Go-to-Market (GTM)

### Early Adopters
- **Limited beta** — invite 50 active DeFi traders via Twitter DM
- **Feedback loop** — collect UX feedback, fix edge cases
- **Content** — write threads on "How I built an AI trading bot in 48 hours"

### Growth
- **Public launch** — remove beta invite requirement
- **Referral program** — traders earn fee rebates for referrals
- **Integrations** — add support for additional DEXes (GMX, dYdX)
- **Analytics dashboard** — public leaderboards of bot performance

### Monetization
- **Free tier**: 5 signals/day, basic strategies
- **Pro tier** ($29/mo): unlimited signals, custom strategies, API access
- **Institutional**: white-label deployment, custom risk parameters

---

## 7. Vision

> **SoVibe will become the default intelligence layer for DEX-native perpetual trading.**

We believe that in 3 years, most active traders will not manually analyze charts. They will delegate to AI swarms that combine on-chain data, news sentiment, social signals, and macro trends into executable strategies.

SoVibe is the first step: a fully open-source, DEX-agnostic terminal where the user always keeps custody, always sees why a signal was generated, and can always override the AI.

**The end state:**
- Any trader can spin up a custom swarm in <5 minutes
- Any developer can add a new strategy or DEX adapter
- Any researcher can export signal data for analysis
- The terminal runs on any EVM chain with a perp DEX

---

## 8. Current Implementation

### What's Live

| Module | Status | Notes |
|--------|--------|-------|
| SoDEX Adapter | Complete | Full EIP712 signing, all order types, spot/perp transfers |
| 6-Strategy Swarm | Complete | 5 technical + SoSoValue sentiment |
| Vibe Score | Complete | Weighted consensus with AutoHedge sizing |
| Trade Execution | Complete | Market orders + SL/TP + position close |
| Deposit/Withdraw | Complete | Spot↔perp transfers via EIP712 |
| Backtest Engine | Complete | 1,000 candle simulation with fees |
| News Feed | Complete | SoSoValue hot news with sentiment badges |
| UI/UX | Complete | Cyberpunk terminal design system |

### What's Stubbed / Limited

| Module | Status | Limitation |
|--------|--------|------------|
| Limit Orders | UI ready | Backend builder exists, no UI route |
| On-chain PnL | Partial | Reads from SoDEX state, no historical tracking |
| Multi-timeframe | Not started | Only 1h candles currently |
| Portfolio Analytics | Not started | No Sharpe/drawdown tracking for live trades |

---

## 9. Roadmap: Next Two Waves

### Wave 2: LLM Intelligence Layer

We plan to integrate **GenLayer** (intelligence for crypto) to analyze in the swarm signal.

**What GenLayer adds:**
- **AI agent consensus** — Multiple LLM agents debate price direction and reach consensus
- **Explainability** — Every prediction includes reasoning trace ("why bullish?")

**Technical Architecture:**

```
┌─────────────────────────────────────────┐
│         GenLayer / Predictify           │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐   │
│  │Oracle A │ │Oracle B │ │Oracle C  │   │
│  │GPT-4o   │ │Claude   │ │Local LLM │   │
│  └─────────┘ └─────────┘ └──────────┘   │
│              ↓ Consensus                │
│         "Bullish ETH, 78% conf"         │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│           SoVibe Swarm Engine           │
│  Technical: 35% | Sentiment: 20%        │
│  Funding: 10% | LLM: 35%                │
│              ↓                          │
│         Vibe Score + Explanation        │
└─────────────────────────────────────────┘
```

**Value Proposition:**
- Traders get **human-readable reasoning** for every signal
- The swarm becomes **self-improving** — LLM learns which strategies work in which regimes

### Wave 3: Advanced Strategies

| Feature | Description |
|---------|-------------|
| Limit Order UI | Add limit order tab to trade page |
| Order History | Track all fills and cancellations per account |
| Realized PnL | Calculate realized PnL from closed positions |
| Multi-timeframe | Support 15m, 4h, 1d analysis |
| Custom Strategy Builder | UI to add/remove strategies from swarm |
| Strategy Backtesting | Backtest individual strategies, not just swarm |
| Portfolio Rebalancing | Auto-adjust position sizes across multiple markets |
| Social Signals | Add Twitter/X sentiment as 7th strategy vote |

---

## 10. Project Structure

```
web/
├── app/
│   ├── api/
│   │   ├── bot/              # Bot cycle, execute, signals, status, toggle
│   │   ├── market/           # Market data (price, orderbook)
│   │   ├── markets/          # All market limits
│   │   ├── news/             # SoSoValue news feed
│   │   ├── positions/        # Close position, SL/TP builder
│   │   ├── status/           # System status
│   │   ├── trade/            # Manual trade order builder
│   │   └── wallet/           # Balance, deposit, withdraw
│   ├── backtest/             # Backtest UI
│   ├── bots/                 # Bot control + signal execution
│   ├── news/                 # News feed page
│   ├── positions/            # Position monitor
│   ├── trade/                # Manual trade execution
│   ├── globals.css           # Cyberpunk design system
│   ├── layout.tsx            # Terminal layout wrapper
│   ├── page.tsx              # Dashboard
│   └── providers.tsx         # Wallet context
├── components/
│   ├── TerminalLayout.tsx    # Sidebar + nav + wallet
│   ├── ToastProvider.tsx     # Toast notification system
│   └── WalletProvider.tsx    # Wagmi provider
├── lib/
│   ├── dex/
│   │   ├── types.ts          # Generic DEX interface
│   │   ├── index.ts          # Factory + config
│   │   └── sodex-adapter.ts  # SoDEX native adapter
│   ├── engine/
│   │   ├── signals.js        # 6-strategy swarm + Vibe Score
│   │   ├── backtest.js       # Backtest engine
│   │   ├── indicators.js     # Technical indicators
│   │   ├── funding.js        # Funding rate analysis
│   │   └── market.js         # Market data wrapper
│   ├── sosovalue.ts          # SoSoValue API client
│   ├── sentiment-engine.ts   # News sentiment scoring
│   ├── signal-store.ts       # Server-side signal persistence
│   ├── use-sodex-tx.ts       # EIP712 signing hook
│   ├── security.ts           # Security auditor
│   └── data-store.ts         # State storage
```

---

## 11. Key Technical Decisions

1. **EIP712 over API keys** — SoDEX uses EIP712 typed data for auth. We sign with `eth_signTypedData_v4` and prefix signatures (`0x01` for perps, `0x02` for spot).

2. **Field-order sensitive hashing** — The Go server re-marshals the request body. Field order must match the Go struct exactly or hash verification fails.

3. **Trailing zero stripping** — `formatQuantity()` strips trailing zeros (`80.070` → `80.07`) because the server rejects them.

4. **Synthetic candle fallback** — Testnet klines are sparse. When real data is unavailable, we generate realistic synthetic candles for backtesting.

5. **Client-side bot state** — Bot logs and config live in `localStorage`, not the server. This keeps the server stateless and Vercel-compatible.

6. **Spot domain separation** — Spot transfers use a separate EIP712 domain (`name: "spot"`) from perps (`name: "futures"`).

---

*Built for the SoSoValue Buildathon — May 2026*
