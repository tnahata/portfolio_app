#!/usr/bin/env python3
"""
Portfolio → Google Sheets sync script.

Reads live positions from Schwab (via macOS Keychain + OAuth) and Coinbase
(via CDP API keys in .env.local), then overwrites the US_portfolio Google Sheet.

Run manually:
    .venv/bin/python scripts/sync_to_sheets.py

Installed as a LaunchAgent to run automatically at 4:15 PM ET on weekdays.
See scripts/install_launchagent.sh to install/uninstall.
"""

import base64
import os
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
	import jwt
	import keyring
	import requests
	from cryptography.hazmat.primitives.serialization import load_pem_private_key
	from dotenv import load_dotenv
	from google.oauth2 import service_account
	from googleapiclient.discovery import build
except ImportError as e:
	print(f"Missing dependency: {e}")
	print("Run: .venv/bin/pip install -r scripts/requirements.txt")
	sys.exit(1)

# ─── Config ────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env.local")

KEYCHAIN_SERVICE = "portfolio-viz-schwab"
SHEET_ID = os.getenv("GOOGLE_SHEET_ID", "")
SERVICE_ACCOUNT_FILE = Path(__file__).parent / "google-service-account.json"
SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

FIAT_CURRENCIES = {"USD", "EUR", "GBP", "CAD", "USDC", "USDT"}
CRYPTO_NAMES = {
	"BTC": "Bitcoin",
	"ETH": "Ethereum",
	"DOGE": "Dogecoin",
	"SOL": "Solana",
	"ADA": "Cardano",
	"DOT": "Polkadot",
	"MATIC": "Polygon",
	"LINK": "Chainlink",
}

# ─── Keychain helpers ──────────────────────────────────────────────────────────

def keychain_read(account: str) -> str | None:
	return keyring.get_password(KEYCHAIN_SERVICE, account)


def keychain_write(account: str, value: str) -> None:
	keyring.set_password(KEYCHAIN_SERVICE, account, value)


# ─── Schwab ────────────────────────────────────────────────────────────────────

def get_schwab_access_token() -> str:
	expiry = keychain_read("token_expiry")
	access_token = keychain_read("access_token")

	if access_token and expiry and int(time.time() * 1000) < int(expiry) - 60_000:
		return access_token

	app_key = keychain_read("app_key")
	app_secret = keychain_read("app_secret")
	refresh_token = keychain_read("refresh_token")

	if not all([app_key, app_secret, refresh_token]):
		raise RuntimeError(
			"Schwab credentials missing from keychain. Run: .venv/bin/python scripts/schwab_auth.py"
		)

	credentials = base64.b64encode(f"{app_key}:{app_secret}".encode()).decode()
	resp = requests.post(
		"https://api.schwabapi.com/v1/oauth/token",
		headers={
			"Authorization": f"Basic {credentials}",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		data={"grant_type": "refresh_token", "refresh_token": refresh_token},
		timeout=30,
	)
	resp.raise_for_status()

	data = resp.json()
	new_expiry = str(int(time.time() * 1000) + data["expires_in"] * 1000)
	keychain_write("access_token", data["access_token"])
	keychain_write("token_expiry", new_expiry)

	return data["access_token"]


def fetch_schwab_positions() -> list[dict]:
	token = get_schwab_access_token()
	resp = requests.get(
		"https://api.schwabapi.com/trader/v1/accounts?fields=positions",
		headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
		timeout=30,
	)
	resp.raise_for_status()

	positions = []
	for account in resp.json():
		raw_positions = account.get("securitiesAccount", {}).get("positions", [])
		for pos in raw_positions:
			inst = pos.get("instrument", {})
			qty = pos.get("longQuantity", 0)
			market_value = pos.get("marketValue", 0)
			avg_price = pos.get("averagePrice", 0)
			cost_basis = avg_price * qty
			price = market_value / qty if qty > 0 else 0
			gain_loss = market_value - cost_basis
			gain_loss_pct = (gain_loss / cost_basis * 100) if cost_basis > 0 else 0

			positions.append({
				"symbol": inst.get("symbol", ""),
				"name": inst.get("description", inst.get("symbol", "")),
				"quantity": qty,
				"price": price,
				"market_value": market_value,
				"cost_basis": cost_basis,
				"gain_loss": gain_loss,
				"gain_loss_pct": gain_loss_pct,
				"source": "Schwab",
			})

	return positions


# ─── Coinbase ──────────────────────────────────────────────────────────────────

def make_coinbase_jwt(api_key: str, api_secret: str, method: str, path: str) -> str:
	private_key_pem = api_secret.replace("\\n", "\n")
	private_key = load_pem_private_key(private_key_pem.encode(), password=None)

	payload = {
		"sub": api_key,
		"iss": "cdp",
		"nbf": int(time.time()),
		"exp": int(time.time()) + 120,
		"uri": f"{method} api.coinbase.com{path}",
	}
	return jwt.encode(
		payload,
		private_key,
		algorithm="ES256",
		headers={"kid": api_key, "nonce": secrets.token_hex(16)},
	)


def get_coinbase_spot_price(currency: str) -> float:
	resp = requests.get(
		f"https://api.coinbase.com/v2/prices/{currency}-USD/spot",
		timeout=10,
	)
	if resp.ok:
		return float(resp.json()["data"]["amount"])
	return 0.0


def get_coinbase_cost_basis(
	account_id: str, api_key: str, api_secret: str
) -> float:
	path = f"/v2/accounts/{account_id}/transactions"
	token = make_coinbase_jwt(api_key, api_secret, "GET", path)
	resp = requests.get(
		f"https://api.coinbase.com{path}",
		headers={"Authorization": f"Bearer {token}"},
		timeout=30,
	)
	if not resp.ok:
		return 0.0

	txs = list(reversed(resp.json().get("data", [])))
	total_cost = 0.0
	total_qty = 0.0

	for tx in txs:
		amount = abs(float(tx.get("amount", {}).get("amount", 0)))
		native = abs(float(tx.get("native_amount", {}).get("amount", 0)))
		tx_type = str(tx.get("type", "")).lower()

		if amount == 0:
			continue

		if "buy" in tx_type or "receive" in tx_type:
			total_qty += amount
			total_cost += native
		elif "sell" in tx_type or "send" in tx_type:
			if total_qty > 0:
				ratio = amount / total_qty
				total_cost *= 1 - ratio
				total_qty -= amount

	return total_cost


def fetch_coinbase_positions() -> list[dict]:
	api_key = os.getenv("COINBASE_API_KEY", "")
	api_secret = os.getenv("COINBASE_API_SECRET", "")

	if not api_key or not api_secret:
		raise RuntimeError("COINBASE_API_KEY / COINBASE_API_SECRET not set in .env.local")

	path = "/api/v3/brokerage/accounts"
	token = make_coinbase_jwt(api_key, api_secret, "GET", path)
	resp = requests.get(
		f"https://api.coinbase.com{path}",
		headers={"Authorization": f"Bearer {token}"},
		timeout=30,
	)
	resp.raise_for_status()

	positions = []
	for account in resp.json().get("accounts", []):
		currency = account.get("currency", "")
		balance = float(account.get("available_balance", {}).get("value", 0))

		if balance <= 0.00000001 or currency in FIAT_CURRENCIES:
			continue

		price = get_coinbase_spot_price(currency)
		if price == 0:
			continue

		market_value = balance * price
		cost_basis = get_coinbase_cost_basis(account["uuid"], api_key, api_secret)
		gain_loss = market_value - cost_basis
		gain_loss_pct = (gain_loss / cost_basis * 100) if cost_basis > 0 else 0

		positions.append({
			"symbol": currency,
			"name": CRYPTO_NAMES.get(currency, account.get("name", currency)),
			"quantity": balance,
			"price": price,
			"market_value": market_value,
			"cost_basis": cost_basis,
			"gain_loss": gain_loss,
			"gain_loss_pct": gain_loss_pct,
			"source": "Coinbase",
		})

	return positions


# ─── Google Sheets ─────────────────────────────────────────────────────────────

def write_to_sheet(positions: list[dict]) -> None:
	if not SERVICE_ACCOUNT_FILE.exists():
		raise RuntimeError(
			f"Service account file not found: {SERVICE_ACCOUNT_FILE}\n"
			"Drop your Google service account JSON at scripts/google-service-account.json"
		)

	if not SHEET_ID:
		raise RuntimeError("GOOGLE_SHEET_ID not set in .env.local")

	creds = service_account.Credentials.from_service_account_file(
		str(SERVICE_ACCOUNT_FILE), scopes=SHEETS_SCOPES
	)
	service = build("sheets", "v4", credentials=creds, cache_discovery=False)
	sheet = service.spreadsheets()

	et = timezone(timedelta(hours=-4))
	now_str = datetime.now(et).strftime("%Y-%m-%d %H:%M ET")

	headers = [
		"Last Updated", "Source", "Symbol", "Name",
		"Quantity", "Price ($)", "Market Value ($)",
		"Cost Basis ($)", "Gain/Loss ($)", "Gain/Loss (%)",
	]

	rows = [headers]
	for i, pos in enumerate(positions):
		rows.append([
			now_str if i == 0 else "",
			pos["source"],
			pos["symbol"],
			pos["name"],
			round(pos["quantity"], 6),
			round(pos["price"], 4),
			round(pos["market_value"], 2),
			round(pos["cost_basis"], 2),
			round(pos["gain_loss"], 2),
			round(pos["gain_loss_pct"], 2),
		])

	sheet.values().clear(spreadsheetId=SHEET_ID, range="Sheet1").execute()
	sheet.values().update(
		spreadsheetId=SHEET_ID,
		range="Sheet1!A1",
		valueInputOption="USER_ENTERED",
		body={"values": rows},
	).execute()

	print(f"✓ Wrote {len(positions)} positions to Google Sheet at {now_str}")


# ─── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
	print(f"[{datetime.now().isoformat()}] Starting portfolio sync...")

	print("Fetching Schwab positions...")
	schwab_positions = fetch_schwab_positions()
	print(f"  → {len(schwab_positions)} positions")

	print("Fetching Coinbase positions...")
	coinbase_positions = fetch_coinbase_positions()
	print(f"  → {len(coinbase_positions)} positions")

	all_positions = schwab_positions + coinbase_positions
	write_to_sheet(all_positions)

	print(f"[{datetime.now().isoformat()}] Done. {len(all_positions)} total positions synced.")


if __name__ == "__main__":
	main()
