# Portfolio Viz

A personal investment dashboard that aggregates positions from **Schwab** (stocks) and **Coinbase** (crypto) into a single view. Built with Next.js 14, it displays real-time portfolio data with allocation charts, a sortable positions table, and source filtering.

A companion Python script syncs portfolio data to a Google Sheet on a daily schedule, so authorized viewers can track the portfolio without needing brokerage credentials.

## Tech Stack

- **Next.js 14** (App Router) + TypeScript
- **Tailwind CSS** + Radix UI primitives
- **React Query** for data fetching (5-minute auto-refresh)
- **Recharts** for pie chart visualizations
- **macOS Keychain** for Schwab credential storage
- **Python** scripts for OAuth setup and Google Sheets sync

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+ (for scripts)
- macOS (required for Keychain-based Schwab auth)

### Install Dependencies

```bash
npm install

python -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
```

### Configure Environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in your Coinbase CDP API key/secret and Google Sheet ID. See `.env.local.example` for all available variables.

Schwab credentials are stored in the macOS Keychain — not in `.env.local`. See [Schwab OAuth Setup](#schwab-oauth-setup) below.

### Run the Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To start with mock data (no API keys needed), set `USE_MOCK_SCHWAB=true` and `USE_MOCK_COINBASE=true` in `.env.local`.

## Schwab OAuth Setup

Schwab credentials are stored in the macOS Keychain under the service `portfolio-viz-schwab`.

**First-time setup** (prompts for app key/secret, runs OAuth flow, stores tokens):

```bash
.venv/bin/python scripts/schwab_auth.py
```

**Every 7 days** — re-run the same script to renew the refresh token.

The callback URL registered in the Schwab Developer Portal must be `https://127.0.0.1:3001/callback`.

## Google Sheets Sync

A standalone Python script fetches positions from both brokerages and writes them to a Google Sheet.

### Setup

1. Create a Google Cloud service account with Sheets API access.
2. Download the JSON key to `scripts/google-service-account.json` (gitignored).
3. Share the target Google Sheet with the service account's `client_email` as an Editor.
4. Set `GOOGLE_SHEET_ID` in `.env.local`.

### Run Manually

```bash
.venv/bin/python scripts/sync_to_sheets.py
```

### Automate with LaunchAgent

Installs a macOS LaunchAgent that runs the sync at 4:15 PM ET every weekday:

```bash
chmod +x scripts/install_launchagent.sh
./scripts/install_launchagent.sh
```

Uninstall with `./scripts/install_launchagent.sh uninstall`.

## Project Structure

```
app/
  api/portfolio/route.ts   # Single API route — merges Schwab + Coinbase positions
  page.tsx                 # Dashboard page
components/
  PortfolioChart.tsx       # Recharts pie chart (allocation by position & source)
  PortfolioTable.tsx       # Sortable positions table
  SourceSelector.tsx       # Filter toggle: All / Schwab / Coinbase
  ui/                      # Shadcn-style primitives (Card, Button, Table, Alert)
hooks/
  usePortfolioData.ts      # React Query hook with filtering & summary stats
lib/
  api/schwab.ts            # Schwab API client (Keychain-backed OAuth)
  api/coinbase.ts          # Coinbase API client (CDP keys)
  types.ts                 # Shared types: Position, SourceFilter, PortfolioSummary
  mockData/                # Static mock positions for development
scripts/
  schwab_auth.py           # Schwab OAuth setup (stores tokens in Keychain)
  sync_to_sheets.py        # Portfolio → Google Sheets sync
  install_launchagent.sh   # Install/uninstall the sync LaunchAgent
  requirements.txt         # Python dependencies
```
