"use client";

import { Button } from "@/components/ui/button";
import { SourceFilter } from "@/lib/types";

interface SourceSelectorProps {
  value: SourceFilter;
  onChange: (value: SourceFilter) => void;
}

export function SourceSelector({ value, onChange }: SourceSelectorProps) {
  const sources: SourceFilter[] = ["All", "Schwab", "Coinbase"];

  return (
    <div className="flex gap-2">
      {sources.map((source) => (
        <Button
          key={source}
          variant={value === source ? "default" : "outline"}
          onClick={() => onChange(source)}
          className="min-w-[100px]"
        >
          {source}
        </Button>
      ))}
    </div>
  );
}
