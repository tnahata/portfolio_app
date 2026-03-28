import { execFileSync } from "child_process";
import { Position } from "@/lib/types";

interface SchwabAccount {
  securitiesAccount: {
    accountId: string;
    positions?: SchwabPosition[];
  };
}

interface SchwabPosition {
  instrument: {
    symbol: string;
    description?: string;
  };
  longQuantity?: number;
  marketValue?: number;
  averagePrice?: number;
}

interface SchwabTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

const SERVICE = "portfolio-viz-schwab";

function keychainRead(account: string): string | null {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-a", account, "-s", SERVICE, "-w"],
      { encoding: "utf8" }
    ).trim();
  } catch {
    return null;
  }
}

function keychainWrite(account: string, value: string): void {
  execFileSync(
    "security",
    ["add-generic-password", "-U", "-a", account, "-s", SERVICE, "-w", value],
    { stdio: "ignore" }
  );
}

class SchwabAPIClient {
  private async getAccessToken(): Promise<string> {
    const tokenExpiry = keychainRead("token_expiry");
    const accessToken = keychainRead("access_token");

    // Use cached token if still valid (with 1-minute buffer)
    if (accessToken && tokenExpiry && Date.now() < Number(tokenExpiry) - 60000) {
      return accessToken;
    }

    // Refresh the access token
    const appKey = keychainRead("app_key");
    const appSecret = keychainRead("app_secret");
    const refreshToken = keychainRead("refresh_token");

    if (!appKey || !appSecret || !refreshToken) {
      throw new Error(
        "Schwab credentials not found in keychain. Run: python scripts/schwab_auth.py"
      );
    }

    const credentials = Buffer.from(`${appKey}:${appSecret}`).toString("base64");

    const response = await fetch("https://api.schwabapi.com/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Schwab auth failed: ${response.statusText} - ${errorText}`);
    }

    const data: SchwabTokenResponse = await response.json();
    const newExpiry = String(Date.now() + data.expires_in * 1000);

    keychainWrite("access_token", data.access_token);
    keychainWrite("token_expiry", newExpiry);

    return data.access_token;
  }

  async getAccounts(): Promise<SchwabAccount[]> {
    const token = await this.getAccessToken();

    const response = await fetch(
      "https://api.schwabapi.com/trader/v1/accounts?fields=positions",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch Schwab accounts: ${response.statusText}`);
    }

    return response.json();
  }

  async getPositions(): Promise<Position[]> {
    const accounts = await this.getAccounts();
    const allPositions: Position[] = [];

    for (const account of accounts) {
      const positions = account.securitiesAccount.positions || [];

      for (const position of positions) {
        const quantity = position.longQuantity || 0;
        const marketValue = position.marketValue || 0;
        const averagePrice = position.averagePrice || 0;
        const costBasis = averagePrice * quantity;
        const currentPrice = quantity > 0 ? marketValue / quantity : 0;
        const gainLoss = marketValue - costBasis;
        const gainLossPct = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;

        allPositions.push({
          symbol: position.instrument.symbol,
          name: position.instrument.description || position.instrument.symbol,
          quantity,
          price: currentPrice,
          marketValue,
          costBasis,
          gainLoss,
          gainLossPct,
          source: "Schwab",
        });
      }
    }

    return allPositions;
  }
}

export const schwabClient = new SchwabAPIClient();
