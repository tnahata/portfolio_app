import { Position } from "@/lib/types";
import { Coinbase } from "coinbase-advanced-node";

class CoinbaseAPIClient {
  private client: Coinbase;
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.COINBASE_API_KEY || "";
    const apiSecret = process.env.COINBASE_API_SECRET || "";

    // Initialize the Coinbase Advanced Trade client with CDP API keys
    // The privateKey should be in PEM format with \n replaced by actual newlines
    const formattedPrivateKey = apiSecret.replace(/\\n/g, '\n');

    this.client = new Coinbase({
      cloudApiKeyName: this.apiKey,
      cloudApiSecret: formattedPrivateKey,
    });
  }

  async getPrice(currency: string): Promise<number> {
    try {
      // Use the public endpoint which doesn't require auth
      const response = await fetch(`https://api.coinbase.com/v2/prices/${currency}-USD/spot`);
      const data = await response.json();
      return parseFloat(data.data.amount);
    } catch (error) {
      console.error(`Failed to fetch price for ${currency}:`, error);
      return 0;
    }
  }

  async calculateCostBasis(accountId: string, currency: string): Promise<number> {
    try {
      console.log(`Calculating cost basis for ${currency} account ${accountId}...`);

      // Fetch transaction history for this account
      const transactionsResponse = await this.client.rest.transaction.listTransactions(accountId);

      if (!transactionsResponse.data || transactionsResponse.data.length === 0) {
        console.log(`No transactions found for ${currency}, using market value as cost basis`);
        return 0; // Will result in 0% gain/loss
      }

      console.log(`Found ${transactionsResponse.data.length} transactions for ${currency}`);

      let totalCost = 0;
      let totalQuantity = 0;

      // IMPORTANT: Coinbase CDP API returns transactions in reverse chronological order (newest first)
      // For proper FIFO cost basis calculation, we need to process oldest transactions first
      const sortedTransactions = [...transactionsResponse.data].reverse();
      console.log(`Processing transactions in chronological order (oldest to newest)...`);

      // Process each transaction to calculate average cost basis
      for (const tx of sortedTransactions) {
        // Log ALL transaction types for debugging
        console.log(`  Transaction type: ${tx.type}, amount: ${tx.amount?.amount}, native: ${tx.native_amount?.amount}`);

        const amount = Math.abs(parseFloat(tx.amount?.amount || '0'));
        const nativeAmount = Math.abs(parseFloat(tx.native_amount?.amount || '0'));

        // Skip if no valid amounts
        if (amount === 0) {
          console.log(`    ⏭️  Skipped - zero amount`);
          continue;
        }

        // Determine if this is a buy or sell based on the transaction type string
        const txTypeStr = String(tx.type).toLowerCase();
        const isBuy = txTypeStr.includes('buy') || txTypeStr.includes('receive');
        const isSell = txTypeStr.includes('sell') || txTypeStr.includes('send');

        if (isBuy) {
          // For buys, add to cost basis
          totalQuantity += amount;
          totalCost += nativeAmount;
          console.log(`    ✅ BUY: ${amount} ${currency} for $${nativeAmount.toFixed(2)}`);
        } else if (isSell) {
          // For sells, reduce quantity using FIFO
          if (totalQuantity > 0) {
            const sellRatio = amount / totalQuantity;
            totalCost = totalCost * (1 - sellRatio);
            totalQuantity -= amount;
            console.log(`    ❌ SELL: sold ${amount} ${currency}, adjusted cost basis by ratio ${sellRatio.toFixed(4)}`);
          } else {
            console.log(`    ⚠️  SELL detected but no quantity to deduct from - ignoring`);
          }
        } else {
          console.log(`    ⏭️  Skipped - type not recognized as buy/sell: ${tx.type}`);
        }
      }

      console.log(`Total cost basis for ${currency}: $${totalCost.toFixed(2)} for ${totalQuantity} units`);
      return totalCost;

    } catch (error) {
      console.error(`Failed to calculate cost basis for ${currency}:`, error);
      // Return 0 to show 0% gain/loss if we can't fetch transactions
      return 0;
    }
  }

  async getPositions(): Promise<Position[]> {
    console.log("Fetching Coinbase Advanced Trade positions...");

    try {
      // List all accounts using the Advanced Trade API
      console.log("Listing accounts...");
      const accountsResponse = await this.client.rest.account.listAccounts();

      if (!accountsResponse.data || accountsResponse.data.length === 0) {
        console.log("No accounts found");
        return [];
      }

      console.log(`Found ${accountsResponse.data.length} accounts`);

      const positions: Position[] = [];

      for (const account of accountsResponse.data) {
        // Extract currency symbol (e.g., "BTC", "ETH")
        const currency = account.currency;
        const balance = parseFloat(account.available_balance?.value || "0");

        console.log(`Account: ${currency}, Balance: ${balance}, Name: ${account.name}`);

        // Skip if balance is zero or very small
        if (balance <= 0.00000001) {
          console.log(`Skipping ${currency} - zero or negligible balance`);
          continue;
        }

        // Skip fiat currencies
        if (["USD", "EUR", "GBP", "CAD"].includes(currency)) {
          console.log(`Skipping ${currency} - fiat currency`);
          continue;
        }

        // Get current price
        const price = await this.getPrice(currency);
        if (price === 0) {
          console.log(`Skipping ${currency} - couldn't fetch price`);
          continue;
        }

        const marketValue = balance * price;

        // Calculate cost basis from transaction history
        const costBasis = await this.calculateCostBasis(account.uuid, currency);
        const gainLoss = marketValue - costBasis;
        const gainLossPct = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;

        // Map common crypto names
        const cryptoNames: Record<string, string> = {
          BTC: "Bitcoin",
          ETH: "Ethereum",
          USDC: "USD Coin",
          USDT: "Tether",
          SOL: "Solana",
          ADA: "Cardano",
          DOGE: "Dogecoin",
          DOT: "Polkadot",
          MATIC: "Polygon",
          LINK: "Chainlink",
        };

        const position: Position = {
          symbol: currency,
          name: cryptoNames[currency] || account.name || currency,
          quantity: balance,
          price,
          marketValue,
          costBasis,
          gainLoss,
          gainLossPct,
          source: "Coinbase",
        };

        console.log(`Added position: ${currency} - ${balance} @ $${price} = $${marketValue}`);
        positions.push(position);
      }

      console.log(`Total Coinbase positions found: ${positions.length}`);
      return positions;

    } catch (error) {
      console.error("Coinbase API error:", error);
      if (error instanceof Error) {
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }
      throw new Error(`Failed to fetch Coinbase positions: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

export const coinbaseClient = new CoinbaseAPIClient();
