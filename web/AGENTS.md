# Phoenix Terminal v3 — Agent Guide

## Project Overview

Cyberpunk trading terminal for perpetuals. **Web-only product** — no CLI bot. The entire trading experience happens in the browser. Stack: Next.js 16 + React 19 + Tailwind v4 + TypeScript + Solana Wallet Adapter + DEX Adapter Pattern.

## Directory Structure

```
web/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Dashboard (wallet + markets + bot status)
│   ├── trade/page.tsx            # Manual trade execution with SL/TP
│   ├── positions/page.tsx        # On-chain position monitor
│   ├── bots/page.tsx             # Bot control + signals + auto-execute
│   ├── backtest/page.tsx         # Backtest UI
│   ├── api/                      # API routes (route.ts)
│   │   ├── bot/
│   │   │   ├── toggle/route.ts   # Start/stop bot
│   │   │   ├── cycle/route.ts    # Runs one analysis cycle
│   │   │   ├── execute/route.ts  # Builds market order via DEX adapter
│   │   │   ├── config/route.ts   # Saves bot config
│   │   │   └── status/route.ts   # Reads bot state
│   │   ├── market/route.ts       # Market data (price, orderbook)
│   │   ├── markets/route.ts      # All market limits
│   │   ├── trade/route.ts        # Manual trade order builder
│   │   ├── wallet/balance/route.ts # On-chain balance + positions
│   │   ├── positions/sl-tp/route.ts # Stop-loss / take-profit builder
│   │   └── backtest/route.ts
│   ├── globals.css               # Cyberpunk design system
│   ├── layout.tsx                # Terminal layout
│   └── providers.tsx             # Wallet context provider
├── components/
│   ├── TerminalLayout.tsx        # Sidebar + CRT effects + nav
│   └── WalletProvider.tsx        # Solana wallet adapters
├── lib/
│   ├── dex/                      # DEX-agnostic adapter layer
│   │   ├── types.ts              # Generic DEX interface
│   │   ├── index.ts              # Factory + getAdapter()
│   │   ├── phoenix-adapter.ts    # Phoenix Rise SDK implementation
│   │   └── sodex-adapter.ts      # Sodex testnet stub
│   ├── security.ts               # Security auditor module
│   ├── data-store.ts             # Vercel-compatible state storage
│   ├── phoenix-tx.ts             # Instruction serialization (Solana)
│   ├── use-phoenix-tx.ts         # Wallet signing hook
│   └── engine/                   # Trading engine (JS modules)
│       ├── market.js             # Thin wrapper over DEX adapter
│       ├── indicators.js         # Technical indicators
│       ├── signals.js            # 5 strategies + synthesizer + consensus
│       ├── funding.js            # Funding rate analysis
│       ├── risk.js               # Risk management
│       └── backtest.js           # Backtest engine
```

## DEX Adapter Architecture

All API routes and the engine import from `lib/dex/index.ts` instead of direct SDK calls.

```typescript
import { getAdapter, initDex } from "@/lib/dex";

await initDex();
const adapter = getAdapter();
const candles = await adapter.getCandles("SOL", "1h", 100);
const order = await adapter.buildMarketOrder("SOL", "long", 1.5, { wallet });
```

### Adding a New DEX

1. Create `lib/dex/my-dex-adapter.ts` implementing `DexAdapter` from `types.ts`
2. Register in `lib/dex/index.ts`: `registry["my-dex"] = myDexAdapter`
3. Set `DEX_PROVIDER=my-dex` in `.env.local`

### Environment Variables

```bash
# Required
DEX_PROVIDER=phoenix        # or sodex

# Optional
DEX_TESTNET=false           # true for testnet endpoints
NEXT_PUBLIC_RPC_URL=https://api.mainnet-beta.solana.com
PHOENIX_API_URL=https://perp-api.phoenix.trade
SODEX_API_URL=https://api.testnet.sodex.trade
```

## Bot Execution Flow

```
User clicks [START BOT]
  → POST /api/bot/toggle (writes bot-state)
Browser starts interval timer
  → POST /api/bot/cycle every N seconds
Server runs analysis (imports engine modules)
  → Fetches candles via DEX adapter, runs 5 strategies, synthesizes
  → Checks on-chain positions via adapter (no duplicate signals)
  → Returns signals + logs in response body
Browser displays signals in UI
User clicks [EXECUTE] (or auto-execute if enabled)
  → Phase 1: POST /api/bot/execute → adapter.buildMarketOrder() → wallet signs → on-chain
  → Phase 2: POST /api/positions/sl-tp → adapter.buildStopLoss/buildTakeProfit → wallet signs → on-chain
```

## SL/TP Architecture

Most DEXes require **two separate transactions**:
1. **Market order** — opens the position
2. **Conditional orders** — attaches SL/TP

The generic adapter supports:
- `buildStopLoss()` + `buildTakeProfit()` (universal)
- `buildPositionConditionalOrder()` (optional, for DEXes that support single-instruction SL+TP)

## Design System (Cyberpunk Terminal)

### Colors
- `--cyan: #00f0ff` — Primary accent
- `--green: #00ff41` — Success / long
- `--red: #ff0040` — Error / short
- `--magenta: #ff00ff` — Secondary accent
- `--yellow: #f0e800` — Warning
- `--bg: #050505` — Background
- `--terminal-bg: #08080c` — Card background

### Typography
- Font: `JetBrains Mono` or `Courier New` fallback
- Use `font-mono` class everywhere
- Uppercase labels with `tracking-wider` or `tracking-[0.15em]`

### Components
- `.terminal-card` — Main container with top glow line
- `.terminal-header` — Section header with `>` prefix
- `.terminal-border` — Border with corner accents
- `.btn-terminal` — Ghost button with hover glow
- `.terminal-input` — Dark input with cyan focus
- `.terminal-table` — Data table with minimal borders

### Effects
- `.crt-overlay` — Fixed CRT scanline overlay (z-9999)
- `.scanline` — Animated scanning line (z-9998)
- `.terminal-flicker` — Subtle screen flicker animation
- `.grid-bg` — 40px grid background

### Hydration Safety
- Always add `suppressHydrationWarning` to `<html>` and `<body>` in `layout.tsx`

## API Route Conventions

### Bot Routes
- `POST /api/bot/toggle` — Flips `running` flag, saves config
- `POST /api/bot/cycle` — Runs one analysis cycle, returns signals/logs in body
- `POST /api/bot/execute` — Builds market order via active DEX adapter
- `GET /api/bot/status` — Reads bot state
- `POST /api/bot/config` — Saves/reads bot config

### SL/TP Route
- `POST /api/positions/sl-tp` — Builds stop-loss / take-profit instructions via adapter

### Data Directory
- Runtime data stored in `../data/` (relative to `web/`)
- Files: `bot-state.json`, `bot-config.json`, `risk-state.json`
- Bot logs and signals are **client-side only** (localStorage/React state)

### Security Requirements
- ALL user inputs must pass `defaultAuditor.auditOrder()`
- Rate limiting on all mutation endpoints
- Circuit breaker for daily volume
- Duplicate detection

## Wallet Integration

### Solana Wallet Adapter
- Configured in `components/WalletProvider.tsx`
- Supports: Phantom, Solflare, Coinbase, Bitget, Trust, WalletConnect
- Use `useWallet()` hook in client components

### DEX Adapter Transaction Flow
```
Server calls adapter.buildMarketOrder() → returns SerializedInstruction[]
Frontend deserializes via phoenix-tx.ts → wallet.signTransaction() → connection.sendRawTransaction()
```

If migrating to a non-Solana DEX:
1. Create a new transaction serializer (e.g., `evm-tx.ts`)
2. Update `SerializedInstruction` format in `lib/dex/types.ts`
3. Replace `WalletProvider.tsx` with chain-appropriate provider (wagmi, etc.)

## State Management

- No global state library — React hooks + API polling
- Bot state: `data/bot-state.json` (running, cycle)
- Bot config: `data/bot-config.json`
- Signals: **client-side only** — React state, replaced per cycle, not persisted
- Bot logs: **client-side only** — localStorage (last 50 entries)
- Trade history: **on-chain** — fetched from active DEX adapter

## Coding Conventions

1. **All text in monospace** — Use `font-mono` for consistency
2. **Color tokens only** — Never hardcode colors, use CSS variables
3. **Uppercase labels** — Section headers, button labels in uppercase
4. **Bracket buttons** — Action buttons use `[ LABEL ]` format
5. **Terminal prefixes** — Use `>` for prompts, `▲▼` for direction
6. **Animate-in** — Use `.animate-in` class for page transitions
7. **Error handling** — Always catch API errors, show terminal-style error messages
8. **No CLI** — Everything is web-only. No spawned processes, no env private keys.
9. **DEX-agnostic** — Never import Phoenix (or any DEX SDK) directly in API routes. Always go through `lib/dex`.

## Key Files

| File | Purpose |
|------|---------|
| `web/app/globals.css` | Cyberpunk design system |
| `web/components/TerminalLayout.tsx` | App shell with CRT effects |
| `web/lib/security.ts` | Security audit module |
| `web/lib/data-store.ts` | Vercel-compatible state storage |
| `web/lib/dex/types.ts` | Generic DEX interface |
| `web/lib/dex/index.ts` | DEX factory + config |
| `web/lib/dex/phoenix-adapter.ts` | Phoenix SDK implementation |
| `web/lib/dex/sodex-adapter.ts` | Sodex testnet stub |
| `web/lib/phoenix-tx.ts` | Instruction serialization |
| `web/lib/engine/market.js` | DEX-agnostic market wrapper |
| `web/lib/engine/signals.js` | 5-strategy swarm engine + consensus |
| `web/app/api/bot/cycle/route.ts` | Bot analysis cycle |
| `web/app/api/bot/execute/route.ts` | Market order builder |
| `web/app/api/positions/sl-tp/route.ts` | SL/TP conditional order builder |
| `web/app/api/wallet/balance/route.ts` | On-chain balance + positions |
