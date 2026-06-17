# Changelog — SoVibe

---

## Wave 3 — 2026-06-17 · Mainnet, Encrypted Bot Keys, Leaderboard

### Added
- **Mainnet / testnet network switch**
  - Runtime network config persisted in `web/.runtime-config.json`
  - Header dropdown selects TESTNET or MAINNET; no auto-switch, no modal
  - Server API routes read the runtime config at import time
  - Wagmi registers both SoDEX testnet (138565) and mainnet (286623) chains
- **Encrypted auto-trading bot keys**
  - `lib/encrypted-store.ts` uses PBKDF2 + AES-GCM with a user password
  - Private key stored encrypted in `localStorage`; plaintext kept in memory only while unlocked
  - `/settings` page for saving, unlocking, locking, and clearing bot keys
  - `lib/bot-signer-client.ts` signs EIP712 orders locally in the browser
  - `/api/bot/auto-execute` returns unsigned actions for client-side signing
  - `/api/bot/register-key` builds the on-chain `addAPIKey` registration action
- **Copy-trading leaderboard**
  - `/wallet/leaderboard` ranks curated SoDEX wallets by Sharpe, return, win rate, profit factor, or trade count
  - `LEADERBOARD_WALLETS` env var seeds the list
  - Each row links directly to `/wallet?address=...` for analyze & copy
- **Wallet profile reuse**
  - `lib/wallet-profile.ts` shares analytics logic between profile and leaderboard APIs
- **Multi-timeframe analysis**
  - Bot cycle aggregates signals across 15m, 1h, 4h, and 1d timeframes
  - Weighted consensus (15m=1x, 1h=2x, 4h=3x, 1d=4x) with bonus when 3+ TFs agree
- **Robust backtest + live PnL**
  - Backtest engine uses real SoDEX 1h candles or SoSoValue daily klines
  - File-based PnL persistence (`lib/engine/pnl-tracker.ts`)
  - Closed trades recorded on execution; per-strategy breakdown
- **Strategy performance scorecard**
  - `/bots` displays live Net PnL, Win Rate, Profit Factor, Sharpe, Max Drawdown, Avg Win/Loss
  - Per-strategy trade counts, win rates, and realized PnL
- **Settings page**
  - `/settings` configures network and encrypted bot keys with step-by-step UX
- **Security hardening**
  - No server-side bot signer; all bot signing happens client-side with encrypted local keys
  - Added `lib/api-error.ts` sanitizer; 500 errors return generic messages
  - Sanitized error responses in `/api/bot/auto-execute`, `/api/bot/execute`, `/api/trade`, `/api/wallet/profile`
  - Removed production debug logs in `use-sodex-tx.ts`
  - Documented `NEXT_PUBLIC_RPC_URL` credential risk

### Fixed
- SoDEX REST v1 endpoint paths:
  - Perps orders: `/api/v1/perps/trade/orders`
  - Perps transfers: `/api/v1/perps/accounts/transfers`
  - Spot transfers: `/api/v1/spot/accounts/transfers`
- SoDEX request body format: params object only; no `type` wrapper
- Master-wallet signed requests omit `X-API-Key`; API-key signed requests include `X-API-Key: <name>`
- SoDEX EIP712 domain now follows the action's own domain (`futures` or `spot`)
- Mainnet chain ID corrected to `286623` (`0x45f9f`)
- Mainnet RPC and explorer URLs corrected
- PnL tracker uses file-based persistence

### Changed
- `AGENTS.md` updated with Wave 3 architecture, security rules, and roadmap status
- `.env.example` cleaned up; removed unused `SODEX_API_URL` and `BOT_PRIVATE_KEY`
- `.gitignore` ignores `.runtime-config.json` and `.pnl-trades.json`

---

## Wave 2 — May 2026 · SoSoValue Buildathon · SoDEX testnet · DGrid AI · SoSoValue API

### New Modules (10 files)

lib/engine/llm-agent.ts — DGrid AI client wrapping OpenAI SDK pointed at api.dgrid.ai/v1. Three functions: analyzeNewsSentiment (LLM scores news headlines, extracts key narratives), classifyMarketRegime (classifies market as trending/ranging/volatile, suggests strategy weights), explainSignal (generates human-readable reasoning + risk factors). Uses gpt-4o-mini. All functions fall back gracefully when DGRID_API_KEY unset.

lib/sosovalue/etf.ts — ETF flow data client. Fetches net inflow/outflow from /etfs/summary-history for BTC, ETH, SOL + 7 others. Computes trading signal with consecutive-day bonus (3+ days 1.15x, 5+ days 1.3x). Provides getETFSignal() convenience wrapper.

lib/sosovalue/market.ts — Market snapshot + cycle position. Fetches ATH, cycle low, FDV, marketcap rank, supply data via /currencies/{id}/market-snapshot. Computes ATH distance % and cycle position %.

lib/sosovalue/macro.ts — Macro event detection. Fetches calendar from /macro/events. Detects high-impact events (FOMC, CPI, NFP) within 48h window. Returns pre-macro uncertainty signal (-0.15 bias, 0.3 confidence).

lib/engine/strategies/etf-flow.js — Standalone ETF flow strategy module. Consecutive-day amplification, trend detection. Signal range [-1.0, 1.0].

app/api/wallet/profile/route.ts — Wallet analyzer API. Accepts ?address= param. Pulls trade history, position history, funding history via public SoDEX endpoints (no auth). Computes win rate, profit factor, Sharpe, max drawdown, total return, avg win/loss, best/worst trade, avg hold time. Classifies strategy type: scalper (<60m avg hold), day trader (<8h), swing trader (8h+), momentum, carry trader (more funding earned than paid). Returns strategy confidence score.

app/api/wallet/copy/route.ts — Copy-trade execution API. POST body {targetAddress, wallet, allocation}. Fetches target's current positions, builds proportional market orders (copySize = allocation/targetEquity × positionSize). Returns UnsignedAction array for EIP712 signing via MetaMask.

app/wallet/page.tsx — Wallet analyzer UI. Address search bar with demo presets. Profile card shows strategy badge (colored by type), 4-up metrics grid (win rate, profit factor, Sharpe, max DD), detail row with 10 stats. Current positions list with side colors. Copy-trade panel with allocation input and one-click execute button using existing sendInstructions hook.

lib/dex/sodex-adapter.ts additions — Three new export functions: getWalletTrades(address), getWalletPosHistory(address), getWalletFundings(address). All are public unauthenticated GET endpoints on SoDEX REST API.

lib/dex/types.ts additions — WalletTrade, WalletPosition, WalletFunding, WalletProfile interfaces for copy-trading data.

Dependency: Added openai package for DGrid compatibility.

---

## Upgraded Modules (10 files)

lib/engine/signals.js — Now 7 strategies (was 6). Added ETFFlow() as 8th swarm member. synthesizeSignals() accepts etfFlow, macroSignal, strategyWeights options. computeVibeScore() recalibrated to v2: Tech 30%, LLM Sentiment 20%, ETF Flow 15%, Funding 15%, Macro 10%, Market 10%. Added normalizeWeights() helper — strategy weights always sum to 1.0 regardless of user input. Dynamic weight override support from Strategy Builder config.

lib/sentiment-engine.ts — Complete rewrite. Primary path: LLM-powered via DGrid analyzeNewsSentiment() with per-currency SoSoValue news filtering. Fallback path: legacy keyword matching. Returns enriched data with reasoning and keyNarratives[] from LLM.

lib/sosovalue.ts — Expanded from 2 endpoints to 30+ across all 9 SoSoValue modules: Feeds (7 endpoints), Currency (7), ETF (4), Indices (4), Crypto Stocks (5), Macro (1), Fundraising (2), Analysis (2). Cache revalidation tuned per endpoint.

app/api/bot/cycle/route.ts — Accepts and respects strategyConfig from client (ON/OFF toggles + weights). Skips disabled strategies entirely. Fetches ETF flow data and macro events each cycle. Calls explainSignal() for LLM reasoning on actionable signals. Signal objects enriched with reasoning, riskFactors, etfFlow, macroAlert, vibeScore. Passes strategyWeights to synthesizeSignals for dynamic Vibe Score.

app/api/news/route.ts — Complete rewrite. Supports symbol filtering (?symbol=BTC), category filtering (?category=2), keyword search (?search=ETF), type options (feed/hot/featured). Detects X/Twitter posts by URL (x.com/twitter.com). Computes quick sentiment from tags + title keywords (bullish/bearish/neutral). Adds sourceType, isXPost, content_preview, sentiment, quote_info to response. Cache key includes all filter params.

app/api/backtest/route.ts — Dual data source support. SoSoValue 1d klines fetched via /currencies/{id}/klines, expanded from daily into 24 synthetic hourly bars. Three-tier fallback: SoSoValue → SoDEX → Synthetic candles. Response includes dataSource label and candlesUsed count.

app/bots/page.tsx — Strategy Builder replaces static table. Per-strategy ON/OFF pill toggle + 0-100% weight slider. Disabled strategies dimmed. Active count in header. Config card export with [COPY JSON] and [COPY SHARE LINK] buttons. Share links encode strategy config as base64 URL param, auto-load on page mount. All text sizes bumped 2-3px for readability.

app/backtest/page.tsx — Data source toggle (SoDEX 1h / SoSoValue 1d). Larger stat cards and typography.

app/news/page.tsx — Complete rewrite. Source type detection: X posts get 🐦 X POST magenta badge. Sentiment-driven left border (green/red/dim). ▲ BULLISH / ▼ BEARISH / ◆ NEUTRAL badge with matching colors. Content preview shown under short titles. Quoted tweet block with attribution. All text bumped 2-3px (title 13px, badges 10px, meta 10px). Matched currency and tag chips larger. Better spacing with divider lines.

app/page.tsx — Dashboard pending signals show ETF flow badges, AI narrative chips, macro alerts, LLM reasoning. Larger typography throughout. Updated tagline.

components/TerminalLayout.tsx — Added ◆ wallet nav item to sidebar.

lib/signal-store.ts — Signal interface extended with reasoning, riskFactors, vibeScore, etfFlow, macroAlert, details.

Environment — Added DGRID_API_KEY to .env.

---

## Feature Summary

7-Strategy Swarm — 5 technical (Trend Following, Mean Reversion, Momentum, S/R Bounce, Volume Breakout) + DGrid AI Sentiment (LLM) + ETF Flow (SoSoValue). All vote independently. Strategy Builder allows toggling any strategy ON/OFF and adjusting weights 0-100%.

Vibe Score v2 — Tech 30%, LLM Sentiment 20%, ETF Flow 15%, Funding 15%, Macro 10%, Market 10%. Weights dynamically normalized from Strategy Builder config — always sum to 1.0. Full consensus triggers when tech, sentiment, ETF, and funding all agree.

DGrid AI Integration — Three functions on gpt-4o-mini: news sentiment analysis with narrative extraction, market regime classification with strategy weight recommendations, signal reasoning with risk factors. ~4 LLM calls per cycle, ~$0.001/cycle. All have graceful fallbacks when API key unset.

SoSoValue Deep Integration — 9 API modules used. ETF flows for institutional sentiment signal. Market snapshots for cycle position and ATH distance. Macro events for FOMC/CPI/NFP detection. Full news feed with per-currency, per-category filtering and X post detection.

Strategy Builder — ON/OFF toggles and weight sliders per strategy. Config persists via localStorage and sent to bot cycle API. Shareable via JSON copy or base64 URL link. Links auto-load config on page mount.

Copy-Trading — Analyze any SoDEX wallet by address (public endpoints, no auth). Computes full performance profile: win rate, profit factor, Sharpe, max drawdown, total return, avg win/loss, best/worst trade, avg hold time, funding earned/paid. Auto-classifies strategy type with confidence score. One-click proportional position mirroring via existing EIP712 pipeline.

Backtest Dual-Source — SoDEX testnet 1h candles + SoSoValue 1d klines expanded to 24 synthetic hourly bars. Three-tier fallback ensures backtest always runs. Metrics: total return, Sharpe, Sortino, max drawdown, win rate, profit factor.

News Feed — Symbol-filtered, category-filtered, searchable. X post detection with source badge. Quick sentiment scoring from tags and keywords. Engagement metrics. Blue verified checkmark. Quoted tweet display.

Readability — All pending signals, news feed, backtest stats, and bot control text bumped 2-3px across dashboard, bots page, and news page.

---

## Wave 1 Baseline

Next.js 16 App Router with cyberpunk terminal UI. Wagmi + Viem MetaMask integration. SoDEX EIP712 adapter (chain 138565). 5 technical strategies + keyword sentiment. Vibe Score v1 (50/30/20). AutoHedge position sizing. SL/TP automation. Spot/perp transfers. Backtest engine with synthetic fallback. News feed from SoSoValue /news/hot.
