# CLAUDE.md

This file provides guidance to Claude when working with code in this repository.

## Keeping This File Updated

When making changes to this project, always update the relevant sections of this file to reflect:
- New scripts added to `scripts/`
- New environment variables added to `.env.local`
- Changes to the data flow or architecture
- New dependencies added to `package.json` or `scripts/requirements.txt`
- New LaunchAgents or scheduled tasks

---

## Commands

```bash
npm run dev      # Start development server (Next.js on port 3000)
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

There are no tests in this project.

---

## Running the Python Scripts

All Python scripts must be run using the project's virtual environment, not the system Python.

**Schwab OAuth (run once, then every 7 days):**
```bash
.venv/bin/python scripts/schwab_auth.py
```

**Google Sheets sync (run manually to test):**
```bash
.venv/bin/python scripts/sync_to_sheets.py
```

**Install the LaunchAgent (runs sync automatically at 4:15 PM ET on weekdays):**
```bash
chmod +x scripts/install_launchagent.sh
./scripts/install_launchagent.sh
```

**Uninstall the LaunchAgent:**
```bash
./scripts/install_launchagent.sh uninstall
```

**Install / update Python dependencies:**
```bash
.venv/bin/pip install -r scripts/requirements.txt
```

> Never use `python` or `pip` directly — always prefix with `.venv/bin/` to ensure the correct environment is used.

---

## Architecture

This is a **Next.js 14** app (App Router) that aggregates investment portfolio data from two brokerage sources — Schwab (stocks) and Coinbase (crypto) — and visualizes them in a single dashboard. A separate Python script (`scripts/sync_to_sheets.py`) pushes the same data to a Google Sheet daily so that family members with read-only access can track the portfolio without needing brokerage credentials.

### Data Flow — Web App

```
Browser → usePortfolioData (React Query) → GET /api/portfolio → SchwabAPIClient / CoinbaseAPIClient
```

1. `hooks/usePortfolioData.ts` — React Query hook that fetches `/api/portfolio`, filters by source, and computes summary stats. Refetches every 5 minutes.
2. `app/api/portfolio/route.ts` — The single API route. Reads `USE_MOCK_SCHWAB` / `USE_MOCK_COINBASE` env flags to decide whether to call real APIs or return mock JSON. Merges positions from both sources into a unified `Position[]` array.
3. `lib/api/schwab.ts` — `SchwabAPIClient` class. Reads all credentials from the macOS keychain (service `portfolio-viz-schwab`). Gets short-lived access tokens via OAuth2 refresh, caching them in the keychain.
4. `lib/api/coinbase.ts` — `CoinbaseAPIClient` class. Uses `coinbase-advanced-node` with CDP API keys. Fetches accounts, spot prices from the public Coinbase v2 API, and transaction history to calculate cost basis.

### Data Flow — Google Sheets Sync

```
LaunchAgent (4:15 PM ET, weekdays) → sync_to_sheets.py → Schwab API + Coinbase API → Google Sheets API → US_portfolio sheet
```

`scripts/sync_to_sheets.py` runs as a standalone Python script. It reads Schwab credentials from the macOS keychain (same service as the web app), reads Coinbase credentials from `.env.local`, fetches all positions, and overwrites the `US_portfolio` Google Sheet via a service account.

### Shared Types

All cross-layer data uses `lib/types.ts`:
- `Position` — the normalized shape for a holding from either source (`symbol`, `name`, `quantity`, `price`, `marketValue`, `costBasis`, `gainLoss`, `gainLossPct`, `source`)
- `SourceFilter` — `"All" | "Schwab" | "Coinbase"`
- `PortfolioSummary` — aggregated totals

### Mock Data

`lib/mockData/schwab.json` and `lib/mockData/coinbase.json` are static `Position[]` arrays. Set `USE_MOCK_SCHWAB=true` or `USE_MOCK_COINBASE=true` in `.env.local` to use them (defaults in `.env.local.example`).

---

## Schwab OAuth Setup (one-time bootstrap + refresh every 7 days)

All Schwab credentials live in the macOS keychain under service `portfolio-viz-schwab`:

| Account key     | Value                                                | Written by   |
|-----------------|------------------------------------------------------|--------------|
| `app_key`       | Schwab developer app key                             | Python setup |
| `app_secret`    | Schwab developer app secret                          | Python setup |
| `access_token`  | Bearer token (~30 min lifespan)                      | Python + TS  |
| `refresh_token` | Refresh token (7-day lifespan)                       | Python       |
| `token_expiry`  | Unix ms timestamp (string) when access token expires | Python + TS  |

**First-time setup** (run once to bootstrap credentials and exchange tokens):
```bash
.venv/bin/python scripts/schwab_auth.py
```

The script will:
1. Prompt for `app_key` and `app_secret` if not already in the keychain (stored permanently)
2. Open a browser to Schwab's OAuth authorization page
3. Capture the redirect callback automatically via a local HTTPS server on port 3001
4. Write `access_token`, `refresh_token`, and `token_expiry` to the keychain

**Every 7 days** — re-run the same script. Only the browser auth step is repeated; credentials are read from the keychain automatically.

**Verify keychain entries:**
```bash
security find-generic-password -a access_token -s portfolio-viz-schwab
```

> **Note:** The callback URL registered in the Schwab Developer Portal must be `https://127.0.0.1:3001/callback` (HTTPS). `schwabdev` uses a self-signed cert stored in `~/.schwabdev/`.

---

## Google Cloud / Sheets Setup

The sync script authenticates with Google Sheets via a **service account** — a bot credential that writes to the sheet without any interactive OAuth flow.

### One-Time Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and select your Firebase/GCP project.
2. Enable the **Google Sheets API**: search for it in the top bar → click Enable.
3. Go to **IAM & Admin → Service Accounts** → Create Service Account (e.g. `portfolio-sync`).
4. On the service account's **Keys** tab → Add Key → Create new key → JSON → download the file.
5. Rename and move the file to `scripts/google-service-account.json` (already gitignored).
6. Open the downloaded JSON, copy the `client_email` value.
7. Open the `US_portfolio` Google Sheet → Share → paste the `client_email` → give it **Editor** access.

### Service Account File

Must be present at `scripts/google-service-account.json`. This file is gitignored and must never be committed. If lost, generate a new key from Google Cloud Console (step 4 above).

---

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in:

| Variable           | Description                                                    |
|--------------------|----------------------------------------------------------------|
| `SCHWAB_CALLBACK_URL` | Optional override; defaults to `https://127.0.0.1:3001/callback` |
| `COINBASE_API_KEY` | CDP key name (`organizations/…/apiKeys/…`)                    |
| `COINBASE_API_SECRET` | EC private key in PEM format (use `\n` for newlines)        |
| `USE_MOCK_SCHWAB`  | `"true"` to use mock data instead of real Schwab API          |
| `USE_MOCK_COINBASE`| `"true"` to use mock data instead of real Coinbase API        |
| `GOOGLE_SHEET_ID`  | The ID from the `US_portfolio` sheet URL                      |

Schwab credentials (`app_key`, `app_secret`, `access_token`, `refresh_token`, `token_expiry`) are **not** in `.env.local` — they live in the macOS keychain.

---

## Troubleshooting

### Schwab API returns 401
The refresh token has expired (7-day limit). Re-run the auth script:
```bash
.venv/bin/python scripts/schwab_auth.py
```

### Schwab API returns 400 / invalid_grant
Same cause as above — expired or malformed refresh token. Re-run the auth script.

### Coinbase API returns 401
Likely a JWT issue. Check that:
- `COINBASE_API_KEY` and `COINBASE_API_SECRET` are correctly set in `.env.local`
- The private key uses literal `\n` characters in the file (not actual newlines)
- The CDP API key has not been revoked in the [Coinbase Developer Portal](https://portal.cdp.coinbase.com/)

### sync_to_sheets.py: "Service account file not found"
The file `scripts/google-service-account.json` is missing. Download a new key from Google Cloud Console → IAM & Admin → Service Accounts → Keys tab.

### sync_to_sheets.py: "The caller does not have permission"
The service account email has not been granted Editor access to the sheet. Open `US_portfolio` in Google Sheets → Share → add the `client_email` from the service account JSON with Editor access.

### sync_to_sheets.py: "GOOGLE_SHEET_ID not set"
Add `GOOGLE_SHEET_ID=<your-sheet-id>` to `.env.local`. The sheet ID is the long string in the sheet's URL between `/d/` and `/edit`.

### LaunchAgent not firing
Check if it's loaded:
```bash
launchctl list | grep portfolio-viz
```
If missing, reinstall:
```bash
./scripts/install_launchagent.sh
```
Check logs for errors:
```bash
cat logs/sync-sheets.error.log
```

### Missing Python dependency
```bash
.venv/bin/pip install -r scripts/requirements.txt
```

### schwab_auth.py: browser doesn't open / callback not captured
Ensure port 3001 is free:
```bash
lsof -i :3001
```
If something is using it, kill that process and retry. The callback server requires port 3001 specifically.

---

## UI Components

- `components/PortfolioChart.tsx` — Recharts pie chart showing allocation by position and by source
- `components/PortfolioTable.tsx` — Sortable table of all positions
- `components/SourceSelector.tsx` — Toggle to filter by All / Schwab / Coinbase
- `components/ui/` — Shadcn-style primitives (Card, Button, Table, Alert) built on Radix UI
- `components/theme-provider.tsx` — `next-themes` dark mode wrapper
