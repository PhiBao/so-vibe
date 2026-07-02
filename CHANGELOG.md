# Changelog — SoVibe

---

## Wave 3 — 2026-06-17 · Mainnet, Encrypted Bot Keys, Leaderboard, Strategy Validation

### New Modules (8 files)

lib/config.ts + lib/config-server.ts — Client-safe and server-side runtime network config. Supports SoDEX testnet (chain 138565) and mainnet (chain 286623). Runtime choice persisted in `web/.runtime-config.json` and selected via the header network dropdown.

components/NetworkSwitch.tsx — Header TESTNET/MAINNET dropdown. No auto-switch, no modal. Calls `/api/config` to persist the choice server-side and reloads the page so API routes pick up the new config.

lib/encrypted-store.ts + lib/bot-signer-client.ts — Password-encrypted browser keystore for auto-trading bot keys. PBKDF2 + AES-GCM. Private key encrypted in `localStorage`; plaintext kept in memory only while unlocked. Client-side EIP712 signing for bot orders.

app/api/bot/register-key/route.ts — Builds the unsigned `addAPIKey` on-chain registration action so the master wallet can authorize a new API key before auto-trading.

app/api/bot/auto-execute/route.ts — Returns unsigned market-order + SL/TP actions for client-side signing with the decrypted bot key.

app/api/bot/fills/route.ts + app/api/bot/record-fills/route.ts — Poll SoDEX closed position history for a wallet and record only new on-chain closed trades into `pnl-tracker.ts`. No click-time recording; metrics are computed from real fills.

app/wallet/leaderboard/page.tsx + app/api/wallet/leaderboard/route.ts + lib/leaderboard-wallets.ts — Copy-trading leaderboard. Ranks curated addresses by Sharpe, total return, win rate, profit factor, or trade count. `LEADERBOARD_WALLETS` env var seeds the list. Each row links to `/wallet?address=...` for analyze & copy.

lib/wallet-profile.ts — Shared wallet analytics builder extracted from the profile API so both `/api/wallet/profile` and `/api/wallet/leaderboard` use the same PnL/win-rate calculations.

lib/api-error.ts — API error sanitizer. Unexpected 500s log server-side and return a generic message; validation errors still expose the message.

### Upgraded Modules (8 files)

lib/engine/backtest.js — Rewritten for real-data-only validation. Removed synthetic 1d→1h candle expansion. Supports three data sources: SoDEX 1h, SoSoValue 1d native, and Combined side-by-side. Includes full swarm inputs (sentiment, ETF flow, funding, macro), configurable slippage (0–15 bps), confidence threshold, Strategy Builder weights, exit-reason tagging, false-positive rate, expectancy, avg bars to TP/SL, max consecutive losses, and a confidence×leverage parameter sweep sorted by Sharpe.

app/api/backtest/route.ts — Updated to serve real SoDEX 1h or SoSoValue 1d candles. Returns `Insufficient real data` if the chosen source lacks bars instead of fabricating data. Runs the parameter sweep when requested.

app/backtest/page.tsx — New UI for data-source dropdown, slippage slider, confidence slider, parameter-sweep checkbox, false-positive/expectancy/exit-reason metrics, and a combined-results view.

lib/engine/pnl-tracker.ts — Extended ClosedTrade with `expectedPrice` and `slippageBps`. Computes hit rate, Sharpe, max drawdown, Calmar, expectancy, avg win/loss, best/worst trade, and per-strategy breakdown from closed trades.

components/PnLWidget.tsx + app/page.tsx — Dashboard live PnL widget. Syncs on-chain fills every 30s, shows Net PnL, Win Rate, Sharpe, Max DD, equity-curve sparkline, and recent closed trades.

app/bots/page.tsx — Added SignalAccuracyPanel showing live hit rate, avg slippage, net PnL, and Sharpe from on-chain fills. Added tooltips and banners for AUTO mode bot-key setup.

app/settings/page.tsx — Step-by-step UX for network info, API key registration, encrypted key save/unlock/lock/clear. Removed duplicate network switch buttons in favor of the header dropdown.

lib/dex/sodex-adapter.ts — Fixed SoDEX REST v1 paths (`/api/v1/perps/trade/orders`, `/api/v1/perps/accounts/transfers`, `/api/v1/spot/accounts/transfers`). Request body is now params-only. Domain follows the action's own domain (`futures` or `spot`). Added `buildAddAPIKey`.

### Feature Summary

Mainnet / Testnet Switch — Runtime network selection persisted via cookie (`sovibe-network`). Wagmi registers both chains. EIP712 domains stay in sync. Works on Vercel serverless — no file-based config needed.

Encrypted Auto-Trading Bot Keys — API key encrypted with a user password, decrypted only in memory, signs orders locally. No server-side signer. On-chain `addAPIKey` registration flow included.

Copy-Trading Leaderboard — Curated SoDEX wallet discovery ranked by verified on-chain metrics. One-click analyze and copy.

Multi-Timeframe Analysis — Bot cycle aggregates 15m/1h/4h/1d signals with weighted consensus and a +0.10 bonus when 3+ timeframes agree.

Robust Backtest — Real data only (SoDEX 1h or SoSoValue 1d). Full swarm inputs, configurable slippage, false-positive / exit-reason analysis, expectancy, parameter sweep. No synthetic candles.

Live PnL from On-Chain Fills — Closed positions polled from SoDEX and recorded in a local JSON file. Dashboard widget and bots-page Signal Accuracy panel show hit rate, slippage, Sharpe, drawdown, and equity curve.

Security Hardening. Server-side bot signer removed. Internal API errors sanitized. Production debug logs removed. `NEXT_PUBLIC_RPC_URL` credential risk documented.

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
