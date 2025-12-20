export interface Position {
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  marketValue: number;
  costBasis: number;
  gainLoss: number;
  gainLossPct: number;
  source: "Schwab" | "Coinbase";
}

export type SourceFilter = "All" | "Schwab" | "Coinbase";

export interface PortfolioSummary {
  totalValue: number;
  totalGainLoss: number;
  totalGainLossPct: number;
  schwabValue: number;
  coinbaseValue: number;
}
