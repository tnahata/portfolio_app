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
from datetime import date, datetime, timedelta, timezone
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
SCHWAB_TX_START = date(2020, 1, 1)  # fetch capital transactions from this date forward
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


def _schwab_year_windows():
	"""Yield (start_dt, end_dt) UTC pairs from SCHWAB_TX_START to today in 1-year windows.

	Schwab enforces a 1-year maximum date range per transactions request.
	"""
	today = datetime.now(timezone.utc).date()
	start = SCHWAB_TX_START
	while start <= today:
		raw_end = date(start.year + 1, start.month, start.day) - timedelta(days=1)
		end = min(raw_end, today)
		if start <= end:
			yield (
				datetime(start.year, start.month, start.day, tzinfo=timezone.utc),
				datetime(end.year, end.month, end.day, 23, 59, 59, tzinfo=timezone.utc),
			)
		start = date(start.year + 1, start.month, start.day)


def fetch_schwab_account_hashes(token: str) -> list[str]:
	"""Return all account hashValues needed for the transactions endpoint."""
	resp = requests.get(
		"https://api.schwabapi.com/trader/v1/accounts/accountNumbers",
		headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
		timeout=30,
	)
	resp.raise_for_status()
	return [item["hashValue"] for item in resp.json()]


def fetch_schwab_transactions(token: str) -> list[dict]:
	"""Return capital transactions from all Schwab accounts since SCHWAB_TX_START.

	Each entry: {"date": datetime (UTC-aware), "amount": float}
	Positive amount = capital deployed (buy). Negative = capital returned (sell).
	"""
	hashes = fetch_schwab_account_hashes(token)
	transactions = []

	for account_hash in hashes:
		for start_dt, end_dt in _schwab_year_windows():
			resp = requests.get(
				f"https://api.schwabapi.com/trader/v1/accounts/{account_hash}/transactions",
				headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
				params={
					"types": "TRADE",
					"startDate": start_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
					"endDate": end_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
				},
				timeout=30,
			)
			if not resp.ok:
				print(f"  Warning: Schwab transactions {account_hash[:8]}… {start_dt.year} → {resp.status_code}, skipping window")
				continue

			for tx in resp.json():
				raw_date = tx.get("tradeDate")
				net = tx.get("netAmount")
				if not raw_date or net is None:
					continue
				try:
					trade_dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
				except ValueError:
					continue
				# netAmount < 0 = cash left account (buy) → flip to positive capital deployed
				# netAmount > 0 = cash entered account (sell) → negative (capital returned)
				amount = -float(net)
				if amount != 0:
					transactions.append({"date": trade_dt, "amount": amount})

	return transactions


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


def fetch_coinbase_capital_transactions() -> list[dict]:
	"""Return all buy/receive (positive) and sell/send (negative) Coinbase transactions.

	Each entry: {"date": datetime (UTC-aware), "amount": float} in USD.
	Follows cursor pagination to retrieve full history.
	"""
	api_key = os.getenv("COINBASE_API_KEY", "")
	api_secret = os.getenv("COINBASE_API_SECRET", "")
	if not api_key or not api_secret:
		raise RuntimeError("COINBASE_API_KEY / COINBASE_API_SECRET not set in .env.local")

	# Get all non-fiat non-zero accounts
	list_path = "/api/v3/brokerage/accounts"
	list_token = make_coinbase_jwt(api_key, api_secret, "GET", list_path)
	resp = requests.get(
		f"https://api.coinbase.com{list_path}",
		headers={"Authorization": f"Bearer {list_token}"},
		timeout=30,
	)
	resp.raise_for_status()

	account_ids = [
		account["uuid"]
		for account in resp.json().get("accounts", [])
		if float(account.get("available_balance", {}).get("value", 0)) > 0.00000001
		and account.get("currency", "") not in FIAT_CURRENCIES
	]

	transactions = []
	for account_id in account_ids:
		path: str | None = f"/v2/accounts/{account_id}/transactions"
		while path:
			base_path = path.split("?")[0]  # JWT must sign base path, not query string
			token = make_coinbase_jwt(api_key, api_secret, "GET", base_path)
			resp = requests.get(
				f"https://api.coinbase.com{path}",
				headers={"Authorization": f"Bearer {token}"},
				timeout=30,
			)
			if not resp.ok:
				print(f"  Warning: Coinbase transactions for {account_id[:8]}… → {resp.status_code}, skipping")
				break

			data = resp.json()
			for tx in data.get("data", []):
				raw_date = tx.get("created_at", "")
				native = tx.get("native_amount", {}).get("amount", "0")
				tx_type = str(tx.get("type", "")).lower()
				try:
					tx_dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
					usd = float(native)
				except (ValueError, TypeError):
					continue

				if usd == 0:
					continue

				if "buy" in tx_type or "receive" in tx_type:
					transactions.append({"date": tx_dt, "amount": abs(usd)})
				elif "sell" in tx_type or "send" in tx_type:
					transactions.append({"date": tx_dt, "amount": -abs(usd)})

			path = data.get("pagination", {}).get("next_uri")

	return transactions


# ─── Cost of Capital ───────────────────────────────────────────────────────────

def calculate_cost_of_capital(transactions: list[dict], rate: float = 0.12) -> float:
	"""Compute simple interest on net invested capital across all transactions.

	For each transaction, interest = amount * rate * (days_held / 365).
	Positive amount (buy) accrues positive interest; negative (sell) reduces it.
	"""
	now = datetime.now(timezone.utc)
	total = 0.0
	for tx in transactions:
		days = (now - tx["date"]).days
		if days < 0:
			continue  # skip any future-dated transactions
		total += tx["amount"] * rate * (days / 365)
	return total


# ─── Google Sheets ─────────────────────────────────────────────────────────────

def write_to_sheet(positions: list[dict], cost_of_capital_usd: float) -> None:
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
		"Quantity", "Price ($)", "Price (₹)",
		"Present Value ($)", "Present Value (₹)",
		"Cost Basis ($)", "Cost Basis (₹)",
		"Gain/Loss ($)", "Gain/Loss (₹)",
		"Gain/Loss (%)",
	]

	fx = 'GOOGLEFINANCE("CURRENCY:USDINR")'

	rows = [headers]
	for i, pos in enumerate(positions):
		row_num = i + 2  # 1-indexed, header is row 1
		rows.append([
			now_str if i == 0 else "",
			pos["source"],
			pos["symbol"],
			pos["name"],
			round(pos["quantity"], 6),
			round(pos["price"], 4),
			f"=F{row_num}*{fx}",
			round(pos["market_value"], 2),
			f"=H{row_num}*{fx}",
			round(pos["cost_basis"], 2),
			f"=J{row_num}*{fx}",
			round(pos["gain_loss"], 2),
			f"=L{row_num}*{fx}",
			round(pos["gain_loss_pct"], 2),
		])

	# Total row
	last_data_row = len(positions) + 1  # header is row 1
	total_row_num = last_data_row + 1
	rows.append([
		"", "", "", "Total", "",
		"", "",
		f"=SUM(H2:H{last_data_row})",
		f"=SUM(I2:I{last_data_row})",
		f"=SUM(J2:J{last_data_row})",
		f"=SUM(K2:K{last_data_row})",
		f"=SUM(L2:L{last_data_row})",
		f"=SUM(M2:M{last_data_row})",
		f'=IF(J{total_row_num}=0,0,L{total_row_num}/J{total_row_num}*100)',
	])

	# Cost of Capital row
	coc_row = total_row_num + 1
	rows.append([
		"", "", "", "Cost of Capital (12% p.a.)", "",
		"", "",
		round(cost_of_capital_usd, 2),  # H: USD
		f"=H{coc_row}*{fx}",            # I: INR via GOOGLEFINANCE
		"", "", "", "", "",
	])

	sheet.values().clear(spreadsheetId=SHEET_ID, range="Sheet1").execute()
	sheet.values().update(
		spreadsheetId=SHEET_ID,
		range="Sheet1!A1",
		valueInputOption="USER_ENTERED",
		body={"values": rows},
	).execute()

	# Formatting requests
	num_cols = len(headers)
	total_rows = total_row_num  # includes header + data + total row
	total_row_idx = total_row_num - 1  # 0-indexed row for the total row
	coc_row_idx = coc_row - 1          # 0-indexed row for the CoC row

	border_style = {"style": "SOLID", "colorStyle": {"rgbColor": {"red": 0.8, "green": 0.8, "blue": 0.8}}}

	format_requests = [
		# Bold header row
		{"repeatCell": {
			"range": {"sheetId": 0, "startRowIndex": 0, "endRowIndex": 1,
					  "startColumnIndex": 0, "endColumnIndex": num_cols},
			"cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
			"fields": "userEnteredFormat.textFormat.bold",
		}},
		# Bold total row
		{"repeatCell": {
			"range": {"sheetId": 0, "startRowIndex": total_row_idx, "endRowIndex": total_row_idx + 1,
					  "startColumnIndex": 0, "endColumnIndex": num_cols},
			"cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
			"fields": "userEnteredFormat.textFormat.bold",
		}},
		# Bold CoC row
		{"repeatCell": {
			"range": {"sheetId": 0, "startRowIndex": coc_row_idx, "endRowIndex": coc_row_idx + 1,
					  "startColumnIndex": 0, "endColumnIndex": num_cols},
			"cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
			"fields": "userEnteredFormat.textFormat.bold",
		}},
		# Borders on entire table (including CoC row)
		{"updateBorders": {
			"range": {"sheetId": 0, "startRowIndex": 0, "endRowIndex": total_rows + 1,
					  "startColumnIndex": 0, "endColumnIndex": num_cols},
			"top": border_style, "bottom": border_style,
			"left": border_style, "right": border_style,
			"innerHorizontal": border_style, "innerVertical": border_style,
		}},
		# Auto-resize columns to fit content
		{"autoResizeDimensions": {
			"dimensions": {"sheetId": 0, "dimension": "COLUMNS",
						   "startIndex": 0, "endIndex": num_cols},
		}},
	]

	# Conditional formatting: green for profit, red for loss on Gain/Loss columns
	# Columns: L=11, M=12, N=13 (0-indexed)
	for col_idx in [11, 12, 13]:
		# Green for positive values
		format_requests.append({
			"addConditionalFormatRule": {
				"rule": {
					"ranges": [{"sheetId": 0, "startRowIndex": 1, "endRowIndex": total_rows,
								"startColumnIndex": col_idx, "endColumnIndex": col_idx + 1}],
					"booleanRule": {
						"condition": {"type": "NUMBER_GREATER", "values": [{"userEnteredValue": "0"}]},
						"format": {"textFormat": {"foregroundColorStyle": {"rgbColor": {"red": 0.13, "green": 0.55, "blue": 0.13}}}},
					},
				},
				"index": 0,
			}
		})
		# Red for negative values
		format_requests.append({
			"addConditionalFormatRule": {
				"rule": {
					"ranges": [{"sheetId": 0, "startRowIndex": 1, "endRowIndex": total_rows,
								"startColumnIndex": col_idx, "endColumnIndex": col_idx + 1}],
					"booleanRule": {
						"condition": {"type": "NUMBER_LESS", "values": [{"userEnteredValue": "0"}]},
						"format": {"textFormat": {"foregroundColorStyle": {"rgbColor": {"red": 0.8, "green": 0.13, "blue": 0.13}}}},
					},
				},
				"index": 0,
			}
		})

	sheet.batchUpdate(
		spreadsheetId=SHEET_ID,
		body={"requests": format_requests},
	).execute()

	print(f"✓ Wrote {len(positions)} positions + total row + CoC row to Google Sheet at {now_str}")


# ─── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
	print(f"[{datetime.now().isoformat()}] Starting portfolio sync...")

	print("Fetching Schwab positions...")
	schwab_positions = fetch_schwab_positions()
	print(f"  → {len(schwab_positions)} positions")

	print("Fetching Coinbase positions...")
	coinbase_positions = fetch_coinbase_positions()
	print(f"  → {len(coinbase_positions)} positions")

	# Fetch transactions for cost-of-capital calculation
	token = get_schwab_access_token()  # cheap cache hit after positions fetch

	print("Fetching Schwab transactions for cost of capital...")
	try:
		schwab_txs = fetch_schwab_transactions(token)
		print(f"  → {len(schwab_txs)} Schwab capital transactions")
	except Exception as e:
		print(f"  Warning: Schwab transactions failed ({e}); CoC excludes Schwab.")
		schwab_txs = []

	print("Fetching Coinbase transactions for cost of capital...")
	try:
		coinbase_txs = fetch_coinbase_capital_transactions()
		print(f"  → {len(coinbase_txs)} Coinbase capital transactions")
	except Exception as e:
		print(f"  Warning: Coinbase transactions failed ({e}); CoC excludes Coinbase.")
		coinbase_txs = []

	cost_of_capital_usd = calculate_cost_of_capital(schwab_txs + coinbase_txs)
	print(f"  → Cost of capital: ${cost_of_capital_usd:,.2f} USD")

	all_positions = schwab_positions + coinbase_positions
	write_to_sheet(all_positions, cost_of_capital_usd)

	print(f"[{datetime.now().isoformat()}] Done. {len(all_positions)} total positions synced.")


if __name__ == "__main__":
	main()
