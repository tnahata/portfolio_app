"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Position } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PortfolioTableProps {
  positions: Position[];
}

type SortField = keyof Position;
type SortDirection = "asc" | "desc";

export function PortfolioTable({ positions }: PortfolioTableProps) {
  const [sortField, setSortField] = useState<SortField>("symbol");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortedPositions = useMemo(() => {
    return [...positions].sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortDirection === "asc"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }

      return 0;
    });
  }, [positions, sortField, sortDirection]);

  const totals = useMemo(() => {
    return positions.reduce(
      (acc, pos) => ({
        marketValue: acc.marketValue + pos.marketValue,
        costBasis: acc.costBasis + pos.costBasis,
        gainLoss: acc.gainLoss + pos.gainLoss,
      }),
      { marketValue: 0, costBasis: 0, gainLoss: 0 }
    );
  }, [positions]);

  const totalGainLossPct =
    totals.costBasis > 0 ? (totals.gainLoss / totals.costBasis) * 100 : 0;

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 data-[state=open]:bg-accent"
      onClick={() => handleSort(field)}
    >
      {children}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Positions</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortButton field="symbol">Symbol</SortButton>
              </TableHead>
              <TableHead>
                <SortButton field="name">Name</SortButton>
              </TableHead>
              <TableHead className="text-right">
                <SortButton field="quantity">Quantity</SortButton>
              </TableHead>
              <TableHead className="text-right">
                <SortButton field="price">Price</SortButton>
              </TableHead>
              <TableHead className="text-right">
                <SortButton field="marketValue">Market Value</SortButton>
              </TableHead>
              <TableHead className="text-right">
                <SortButton field="costBasis">Cost Basis</SortButton>
              </TableHead>
              <TableHead className="text-right">
                <SortButton field="gainLoss">Gain/Loss</SortButton>
              </TableHead>
              <TableHead className="text-right">
                <SortButton field="gainLossPct">Gain/Loss %</SortButton>
              </TableHead>
              <TableHead>
                <SortButton field="source">Source</SortButton>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedPositions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  No positions found
                </TableCell>
              </TableRow>
            ) : (
              sortedPositions.map((position) => (
                <TableRow key={`${position.source}-${position.symbol}`}>
                  <TableCell className="font-medium">{position.symbol}</TableCell>
                  <TableCell>{position.name}</TableCell>
                  <TableCell className="text-right">{position.quantity}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(position.price)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(position.marketValue)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(position.costBasis)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      position.gainLoss >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {formatCurrency(position.gainLoss)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      position.gainLossPct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {formatPercent(position.gainLossPct)}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary">
                      {position.source}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {sortedPositions.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-bold">
                  Total
                </TableCell>
                <TableCell className="text-right font-bold">
                  {formatCurrency(totals.marketValue)}
                </TableCell>
                <TableCell className="text-right font-bold">
                  {formatCurrency(totals.costBasis)}
                </TableCell>
                <TableCell
                  className={`text-right font-bold ${
                    totals.gainLoss >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatCurrency(totals.gainLoss)}
                </TableCell>
                <TableCell
                  className={`text-right font-bold ${
                    totalGainLossPct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatPercent(totalGainLossPct)}
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>
    </Card>
  );
}
