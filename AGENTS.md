# SoVibe — Agent Guide

## Project Overview

SoVibe is an **AI-augmented perpetual trading terminal** for the SoSoValue ecosystem. It runs a 6-strategy technical swarm combined with real-time SoSoValue news sentiment to generate actionable trading signals on **SoDEX testnet**.

The entire trading experience happens in the browser. Every signal can be signed and submitted on-chain via MetaMask.

## Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind v4, TypeScript
- **Web3**: Wagmi + Viem, MetaMask (`injected()` only)
- **DEX**: SoDEX testnet (EVM chainId 138565) via native adapter
- **Security**: Custom `SecurityAuditor` with rate limiting, circuit breakers, duplicate detection

## Directory Structure

```
web/
├── app/
│   ├── api/                # Next.js API routes (bot, trade, wallet, positions, backtest, news)
│   ├── backtest/           # Backtest UI page
│   ├── bots/               # Bot swarm control + signal execution
│   ├── news/               # SoSoValue news feed
│   ├── positions/          # Position monitor
│   ├── trade/              # Manual trade execution
│   ├── globals.css         # Cyberpunk design system
│   ├── layout.tsx          # Terminal layout wrapper
│   ├── page.tsx            # Dashboard
│   └── providers.tsx       # Wallet context
├── components/
│   ├── TerminalLayout.tsx  # Sidebar + nav + wallet panel
│   ├── ToastProvider.tsx   # Toast notification system
│   └── WalletProvider.tsx  # Wagmi provider
├── lib/
│   ├── dex/
│   │   ├── types.ts        # Generic DEX interface
│   │   ├── index.ts        # Factory + config
│   │   └── sodex-adapter.ts # SoDEX native adapter (EIP712, orders, transfers)
│   ├── engine/
│   │   ├── signals.js      # 6-strategy swarm + Vibe Score + AutoHedge
│   │   ├── backtest.js     # Backtest engine
│   │   ├── indicators.js   # Technical indicators (RSI, MACD, BB, EMA, ATR, etc.)
│   │   ├── funding.js      # Funding rate analysis
│   │   └── market.js       # Market data wrapper
│   ├── sosovalue.ts        # SoSoValue API client
│   ├── sentiment-engine.ts # News sentiment scoring
│   ├── signal-store.ts     # Server-side signal persistence
│   ├── use-sodex-tx.ts     # EIP712 signing hook (perps + spot domains)
│   ├── security.ts         # Security auditor
│   └── data-store.ts       # State storage
```

## Quick Commands

```bash
cd web && npm run dev     # localhost:3000
cd web && npm run build   # production build
```

## Environment

Create `web/.env.local`:

```bash
DEX_PROVIDER=sodex
DEX_TESTNET=true
SOSO_API_KEY=your-sosovalue-api-key
NEXT_PUBLIC_RPC_URL=https://testnet-v2.valuechain.xyz/
```

## DEX Adapter

All trading logic routes through `lib/dex/index.ts` (`getAdapter()` / `initDex()`). Do **not** call SoDEX API directly from components.

The SoDEX adapter handles:
- **EIP712 signing** with `eth_signTypedData_v4`
- **Domain separation**: perps uses `name: "futures"`, spot uses `name: "spot"` (both chainId 138565)
- **Signature prefix**: `0x01` for perps orders, `0x02` for spot orders (only `addAPIKey` uses spot prefix)
- **Field-order sensitive hashing**: Go server re-marshals JSON; fields must match struct order exactly
- **Trailing zero stripping**: `formatQuantity()` strips trailing zeros (`80.070` → `80.07`)

## Trading Engine

### Signal Range
- `[-1.0, 1.0]` where `1.0` = full long, `-1.0` = full short, `0.0` = flat/abstain

### Swarm Consensus
- Weighted average of all non-zero strategy votes, weighted by confidence
- Agreement bonus: `+0.15` if ≥3 strategies agree
- Action thresholds: `≥+0.25` LONG, `≤−0.25` SHORT, else HOLD
- Requires ≥2 supporting strategies OR `|signal| ≥ 0.6` OR single active strategy

### Vibe Score Weights
- 50% technical consensus
- 30% SoSoValue sentiment
- 20% funding rate bias

## Design System

See `web/AGENTS.md` for detailed cyberpunk terminal design system, component conventions, coding rules, and architecture.

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
5. **Sentiment is a peer strategy** — equal voting power, not a post-blend modifier.
6. **No WalletConnect** — MetaMask (`injected()`) only.
