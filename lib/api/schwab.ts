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

class SchwabAPIClient {
  private appKey: string;
  private appSecret: string;
  private refreshToken: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.appKey = process.env.SCHWAB_APP_KEY || "";
    this.appSecret = process.env.SCHWAB_APP_SECRET || "";
    this.refreshToken = process.env.SCHWAB_REFRESH_TOKEN || "";
  }

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Get new access token using refresh token
    const credentials = Buffer.from(`${this.appKey}:${this.appSecret}`).toString("base64");

    const response = await fetch("https://api.schwabapi.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Schwab auth failed: ${response.statusText} - ${errorText}`);
    }

    const data: SchwabTokenResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Subtract 1 min for safety

    return this.accessToken;
  }

  async getAccounts(): Promise<SchwabAccount[]> {
    const token = await this.getAccessToken();

    const response = await fetch("https://api.schwabapi.com/trader/v1/accounts?fields=positions", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
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
