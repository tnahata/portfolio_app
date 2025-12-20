"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Position, SourceFilter, PortfolioSummary } from "@/lib/types";

interface PortfolioAPIResponse {
  success: boolean;
  data: Position[];
  source: "mock" | "api";
  warnings?: string[];
  error?: string;
}

async function fetchPortfolioData(): Promise<Position[]> {
  const response = await fetch("/api/portfolio", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch portfolio data");
  }

  const result: PortfolioAPIResponse = await response.json();

  if (!result.success) {
    throw new Error(result.error || "Unknown error");
  }

  return result.data;
}

export function usePortfolioData() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("All");

  // Fetch data using React Query
  const {
    data: allPositions = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolioData,
    staleTime: 30 * 1000, // Data is fresh for 30 seconds (reduced from 5 minutes)
    refetchInterval: 60 * 1000, // Auto-refetch every 1 minute (reduced from 5 minutes)
    refetchOnWindowFocus: true, // Refetch when user returns to the tab
  });

  // Filter positions based on source
  const filteredPositions = useMemo(() => {
    if (sourceFilter === "All") return allPositions;
    return allPositions.filter((position) => position.source === sourceFilter);
  }, [allPositions, sourceFilter]);

  // Calculate summary statistics
  const summary: PortfolioSummary = useMemo(() => {
    const totalValue = filteredPositions.reduce(
      (sum, pos) => sum + pos.marketValue,
      0
    );
    const totalCostBasis = filteredPositions.reduce(
      (sum, pos) => sum + pos.costBasis,
      0
    );
    const totalGainLoss = filteredPositions.reduce(
      (sum, pos) => sum + pos.gainLoss,
      0
    );

    // Calculate source values from FILTERED positions (not all positions)
    // This ensures pie chart percentages are based on what's currently displayed
    const schwabPositions = filteredPositions.filter((p) => p.source === "Schwab");
    const coinbasePositions = filteredPositions.filter(
      (p) => p.source === "Coinbase"
    );

    const schwabValue = schwabPositions.reduce(
      (sum, pos) => sum + pos.marketValue,
      0
    );
    const coinbaseValue = coinbasePositions.reduce(
      (sum, pos) => sum + pos.marketValue,
      0
    );

    return {
      totalValue,
      totalGainLoss,
      totalGainLossPct: totalCostBasis > 0 ? (totalGainLoss / totalCostBasis) * 100 : 0,
      schwabValue,
      coinbaseValue,
    };
  }, [filteredPositions]);

  return {
    positions: filteredPositions,
    sourceFilter,
    setSourceFilter,
    summary,
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}
