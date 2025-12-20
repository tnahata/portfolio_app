"use client";

import { SourceSelector } from "@/components/SourceSelector";
import { PortfolioTable } from "@/components/PortfolioTable";
import { PortfolioChart } from "@/components/PortfolioChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { RefreshCw, AlertCircle } from "lucide-react";

export default function Home() {
  const {
    positions,
    sourceFilter,
    setSourceFilter,
    summary,
    isLoading,
    isError,
    error,
    refetch
  } = usePortfolioData();

  // Error state
  if (isError) {
    return (
      <main className="container mx-auto px-4 py-8">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <div className="flex-1">
                <h2 className="text-lg font-semibold">Failed to load portfolio data</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {error?.message || "An unknown error occurred"}
                </p>
              </div>
              <Button onClick={() => refetch()} variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="space-y-6">
        {/* Header with Refresh Button */}
        <div className="flex justify-between items-center">
          <div className="flex justify-center flex-1">
            <SourceSelector value={sourceFilter} onChange={setSourceFilter} />
          </div>
          <Button
            onClick={() => refetch()}
            variant="outline"
            size="sm"
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin" />
                <span>Loading portfolio data...</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Portfolio Value
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(summary.totalValue)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Gain/Loss
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    summary.totalGainLoss >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatCurrency(summary.totalGainLoss)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Gain/Loss %
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    summary.totalGainLossPct >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatPercent(summary.totalGainLossPct)}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Chart */}
        {!isLoading && <PortfolioChart summary={summary} positions={positions} sourceFilter={sourceFilter} />}

        {/* Table */}
        {!isLoading && <PortfolioTable positions={positions} />}
      </div>
    </main>
  );
}
