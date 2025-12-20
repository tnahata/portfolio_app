"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortfolioSummary, Position, SourceFilter } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

interface PortfolioChartProps {
  summary: PortfolioSummary;
  positions: Position[];
  sourceFilter: SourceFilter;
}

const SOURCE_COLORS = {
  Schwab: "hsl(217, 91%, 60%)", // Blue
  Coinbase: "hsl(142, 76%, 36%)", // Green
};

// Generate colors for individual assets using HSL with different hues
const generateAssetColor = (index: number, total: number) => {
  const hue = (index * 360) / total;
  return `hsl(${hue}, 70%, 55%)`;
};

export function PortfolioChart({ summary, positions, sourceFilter }: PortfolioChartProps) {
  // Determine what to display in the chart
  let data: Array<{ name: string; value: number }>;
  let colors: Record<string, string>;
  let chartTitle: string;

  if (sourceFilter === "All") {
    // Show source-level breakdown (Schwab vs Coinbase)
    data = [
      { name: "Schwab", value: summary.schwabValue },
      { name: "Coinbase", value: summary.coinbaseValue },
    ].filter(item => item.value > 0);
    colors = SOURCE_COLORS;
    chartTitle = "Portfolio Allocation";
  } else {
    // Show asset-level breakdown for the filtered source
    data = positions.map(pos => ({
      name: pos.symbol,
      value: pos.marketValue,
    }));

    // Generate colors for each asset
    colors = {};
    data.forEach((item, index) => {
      colors[item.name] = generateAssetColor(index, data.length);
    });

    chartTitle = `${sourceFilter} Asset Allocation`;
  }

  const totalValue = data.reduce((sum, item) => sum + item.value, 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border bg-background p-2 shadow-sm">
          <div className="grid grid-cols-2 gap-2">
            <span className="font-medium">{payload[0].name}:</span>
            <span className="font-bold">{formatCurrency(payload[0].value)}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {((payload[0].value / totalValue) * 100).toFixed(1)}%
          </div>
        </div>
      );
    }
    return null;
  };

  const renderCustomLabel = (entry: any) => {
    const percent = ((entry.value / totalValue) * 100).toFixed(1);
    return `${percent}%`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{chartTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={renderCustomLabel}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={colors[entry.name]}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {sourceFilter === "All" && (
          <div className="mt-4 grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-sm text-muted-foreground">Schwab</div>
              <div className="text-lg font-bold text-primary">
                {formatCurrency(summary.schwabValue)}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Coinbase</div>
              <div className="text-lg font-bold" style={{ color: SOURCE_COLORS.Coinbase }}>
                {formatCurrency(summary.coinbaseValue)}
              </div>
            </div>
          </div>
        )}
        {sourceFilter !== "All" && (
          <div className="mt-4">
            <div className="text-sm text-muted-foreground text-center">Total {sourceFilter} Value</div>
            <div className="text-lg font-bold text-center">
              {formatCurrency(totalValue)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
