import { NextRequest, NextResponse } from "next/server";
import { schwabClient } from "@/lib/api/schwab";
import { coinbaseClient } from "@/lib/api/coinbase";
import { Position } from "@/lib/types";
import schwabMockData from "@/lib/mockData/schwab.json";
import coinbaseMockData from "@/lib/mockData/coinbase.json";

export const dynamic = "force-dynamic"; // Disable caching for this route

export async function GET(request: NextRequest) {
  try {
    // Check individual mock flags for each source
    const useMockSchwab = process.env.USE_MOCK_SCHWAB === "true";
    const useMockCoinbase = process.env.USE_MOCK_COINBASE === "true";

    const positions: Position[] = [];
    const errors: string[] = [];
    const sources: string[] = [];

    // Fetch Schwab data (mock or real)
    if (useMockSchwab) {
      console.log("Using mock Schwab data");
      positions.push(...(schwabMockData as Position[]));
      sources.push("schwab:mock");
    } else {
      console.log("Fetching real Schwab data from API");
      try {
        const schwabPositions = await schwabClient.getPositions();
        positions.push(...schwabPositions);
        sources.push("schwab:api");
      } catch (error) {
        console.error("Schwab API error:", error);
        errors.push(`Schwab: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // Fetch Coinbase data (mock or real)
    if (useMockCoinbase) {
      console.log("Using mock Coinbase data");
      positions.push(...(coinbaseMockData as Position[]));
      sources.push("coinbase:mock");
    } else {
      console.log("Fetching real Coinbase data from API");
      try {
        const coinbasePositions = await coinbaseClient.getPositions();
        positions.push(...coinbasePositions);
        sources.push("coinbase:api");
      } catch (error) {
        console.error("Coinbase API error:", error);
        errors.push(`Coinbase: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // If no data was retrieved (both failed or returned empty), return error
    if (positions.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch data from any source",
          details: errors.length > 0 ? errors : ["No positions found"],
        },
        { status: 500 }
      );
    }

    const response = NextResponse.json({
      success: true,
      data: positions,
      sources: sources.join(", "),
      warnings: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(), // Add timestamp to verify freshness
    });

    // Explicitly disable caching
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.set('Surrogate-Control', 'no-store');

    return response;
  } catch (error) {
    console.error("Portfolio API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
