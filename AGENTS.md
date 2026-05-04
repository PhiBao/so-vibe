# Phoenix Terminal v3 — Agent Guide

## Project Overview

Cyberpunk trading terminal for perpetuals. **DEX-agnostic** — currently supports Phoenix (Solana mainnet) and Sodex (testnet). The entire trading experience happens in the browser.

## Stack
- **Frontend**: Next.js 16 (App Router), React 19, Tailwind v4, TypeScript
- **Web3**: Solana Wallet Adapter, DEX Adapter Pattern (`lib/dex/`)
- **Security**: Custom auditor based on nemesis-auditor + pashov patterns

## Directory Structure

```
/
├── web/                    # Next.js terminal
│   ├── app/                # Pages + API routes
│   ├── components/         # TerminalLayout, WalletProvider
│   └── lib/                # Security, engine, tx helpers
│       ├── dex/            # DEX-agnostic adapter layer
│       │   ├── types.ts    # Generic DEX interface
│       │   ├── index.ts    # Factory + config
│       │   ├── phoenix-adapter.ts
│       │   └── sodex-adapter.ts
│       └── engine/         # Trading engine (JS modules)
└── data/                   # Runtime state (gitignored)
```

## Quick Commands

```bash
cd web && npm run dev     # localhost:3000
```

## DEX Configuration

Switch DEX via environment variable:

```bash
DEX_PROVIDER=phoenix        # or sodex
DEX_TESTNET=false           # true for testnet endpoints
PHOENIX_API_URL=https://perp-api.phoenix.trade
SODEX_API_URL=https://api.testnet.sodex.trade
```

All API routes and the engine use `lib/dex/index.ts` (`getAdapter() / initDex()`) instead of direct Phoenix SDK calls.

## Design System

See `web/AGENTS.md` for detailed cyberpunk terminal design system, component conventions, coding rules, and architecture.

## Security Checklist

- [x] All inputs validated via `SecurityAuditor`
- [x] Rate limiting on all mutation endpoints
- [x] Circuit breaker for daily volume
- [x] Duplicate order detection
- [x] Solana address format validation
- [x] Price anomaly detection
