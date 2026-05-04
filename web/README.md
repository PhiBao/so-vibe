# 🔥 Phoenix Terminal v3

AI-powered multi-strategy trading terminal for Phoenix perpetuals on Solana. Connect your wallet, configure the swarm bot, and trade entirely through the browser.

## Quick Start

```bash
cd web
npm install --legacy-peer-deps

# Copy environment template
cp .env.example .env.local

# Start dev server
npm run dev
```

Open http://localhost:3000 and connect your Solana wallet.

> **Note:** Environment variables must be in `web/.env.local`. Next.js reads env from the project root (`web/`), not the repository root.

## Environment Setup

```bash
cp .env.example .env.local
```

Edit `web/.env.local`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_RPC_URL` | yes | mainnet-beta | Solana RPC endpoint (used by frontend + API) |
| `NEXT_PUBLIC_WC_PROJECT_ID` | no | — | WalletConnect project ID |
| `SYMBOLS` | no | SOL,ETH,BTC | Markets to scan |
| `SCAN_INTERVAL` | no | 60 | Seconds between bot cycles |
| `MIN_CONFIDENCE` | no | 0.55 | Min confidence to generate signal |
| `MAX_POSITION_PCT` | no | 5 | Max % of portfolio per trade |
| `MAX_LEVERAGE` | no | 20 | Max leverage (Phoenix limit) |

## Usage

1. **Connect wallet** — Click "[ CONNECT WALLET ]" in the sidebar
2. **Configure bot** — Go to **Bots**, select markets, set confidence & leverage
3. **Start bot** — Click "[ START BOT ]" to begin scanning
4. **Execute signals** — When signals appear, click "[ EXECUTE ]" to sign the trade
5. **Monitor positions** — Track PnL in **Positions** and **Dashboard**

## Project Structure

```
web/
├── app/              # Pages + API routes
│   ├── page.tsx      # Dashboard
│   ├── trade/        # Manual trading
│   ├── bots/         # Bot control + signals
│   ├── positions/    # Position monitor
│   ├── journal/      # Performance analytics
│   ├── backtest/     # Backtest UI
│   └── api/          # API routes
├── components/       # TerminalLayout, WalletProvider
├── lib/
│   ├── security.ts   # Security auditor
│   ├── bot-signals.ts # Signal queue manager
│   └── engine/       # Trading engine
│       ├── market.js # Phoenix SDK wrapper
│       ├── signals.js # 5 strategies
│       ├── risk.js   # Risk management
│       └── backtest.js # Backtest engine
```

## Disclaimer

This is experimental software. Trading crypto perpetuals involves **substantial risk of loss**. All transactions are signed by your wallet and executed on-chain. Use at your own risk. Never trade with funds you can't afford to lose.

## License

MIT
