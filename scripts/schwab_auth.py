#!/usr/bin/env python3
"""
Schwab OAuth Setup Script

Reads app_key and app_secret from the macOS keychain (prompts on first run),
runs the OAuth flow via schwabdev, and stores the resulting tokens in the keychain.

Keychain service: portfolio-viz-schwab
Accounts stored: app_key, app_secret, access_token, refresh_token, token_expiry

Usage:
    pip install -r scripts/requirements.txt
    python scripts/schwab_auth.py
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import keyring
    import schwabdev
except ImportError:
    print("Missing dependencies. Run: pip install -r scripts/requirements.txt")
    sys.exit(1)

CALLBACK_URL = os.getenv("SCHWAB_CALLBACK_URL", "https://127.0.0.1:3001/callback")
SERVICE = "portfolio-viz-schwab"
TOKENS_DB = "/tmp/schwab_tokens_tmp.db"


def keychain_read(account: str) -> str | None:
    return keyring.get_password(SERVICE, account)


def keychain_write(account: str, value: str) -> None:
    keyring.set_password(SERVICE, account, value)


def prompt_and_store(account: str, label: str) -> str:
    value = input(f"Enter {label}: ").strip()
    if not value:
        print(f"Error: {label} cannot be empty.")
        sys.exit(1)
    keychain_write(account, value)
    print(f"Stored {label} in keychain.")
    return value


def main() -> None:
    print("Schwab OAuth Setup")
    print("=" * 60)

    # Read or prompt for app_key and app_secret
    app_key = keychain_read("app_key")
    if not app_key:
        print("\napp_key not found in keychain.")
        app_key = prompt_and_store("app_key", "Schwab app key")

    app_secret = keychain_read("app_secret")
    if not app_secret:
        print("\napp_secret not found in keychain.")
        app_secret = prompt_and_store("app_secret", "Schwab app secret")

    print(f"\nUsing callback URL: {CALLBACK_URL}")
    print("Make sure this URL is registered in the Schwab Developer Portal.")
    print()
    print("Starting OAuth flow...")
    print("1. A browser window will open — log in and authorize the app")
    print("2. After authorizing, your browser will redirect to the callback URL")
    print("3. Copy the full URL from the address bar and paste it when prompted\n")

    # Remove stale temp DB if present
    Path(TOKENS_DB).unlink(missing_ok=True)

    # Initialize schwabdev — this triggers the OAuth flow:
    # opens browser, prompts for callback URL, exchanges code for tokens, stores in SQLite DB
    client = schwabdev.Client(
        app_key,
        app_secret,
        callback_url=CALLBACK_URL,
        tokens_db=TOKENS_DB,
    )

    # Read tokens from the client object after successful OAuth
    tokens = client.tokens
    if not tokens.access_token or not tokens.refresh_token:
        print("\nError: OAuth did not produce tokens. Please try again.")
        sys.exit(1)

    # Compute expiry timestamp in ms
    issued_at: datetime = tokens._access_token_issued
    timeout_secs: int = tokens._access_token_timeout
    expiry_dt = issued_at + timedelta(seconds=timeout_secs)
    token_expiry = str(int(expiry_dt.timestamp() * 1000))

    # Write tokens to keychain
    keychain_write("access_token", tokens.access_token)
    keychain_write("refresh_token", tokens.refresh_token)
    keychain_write("token_expiry", token_expiry)

    # Clean up temp DB
    Path(TOKENS_DB).unlink(missing_ok=True)

    print("\nTokens written to keychain:")
    print(f"  access_token  → stored ({len(tokens.access_token)} chars)")
    print(f"  refresh_token → stored ({len(tokens.refresh_token)} chars)")
    print(f"  token_expiry  → {token_expiry}")
    print("\nSetup complete. The app will now read credentials directly from the keychain.")
    print("Re-run this script in 7 days to renew the refresh token.")


if __name__ == "__main__":
    main()
