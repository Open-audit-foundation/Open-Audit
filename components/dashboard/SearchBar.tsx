"use client";

import { useState, type FormEvent } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchBarProps {
  onSearch: (contractId: string) => void;
  isLoading?: boolean;
  defaultValue?: string;
}

const EXAMPLE_CONTRACTS = [
  {
    label: "USDC SAC",
    id: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  },
  {
    label: "XLM SAC",
    id: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  },
];

export function SearchBar({
  onSearch,
  isLoading = false,
  defaultValue = "",
}: SearchBarProps): React.JSX.Element {
  const [value, setValue] = useState(defaultValue);

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onSearch(trimmed);
    }
  }

  function handleClear(): void {
    setValue("");
    onSearch("");
  }

  function handleExampleClick(contractId: string): void {
    setValue(contractId);
    onSearch(contractId);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={value}
            onChange={function (e) {
              setValue(e.target.value);
            }}
            placeholder="Enter a Soroban Contract ID (C...)"
            className="pl-9 pr-9 font-mono text-sm"
            aria-label="Contract ID search"
            disabled={isLoading}
          />
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button type="submit" disabled={isLoading || !value.trim()}>
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading...
            </>
          ) : (
            "Search"
          )}
        </Button>
      </form>

      {/* Quick-access example contracts */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Try:</span>
        {EXAMPLE_CONTRACTS.map(function (contract) {
          return (
            <button
              key={contract.id}
              type="button"
              onClick={function () {
                handleExampleClick(contract.id);
              }}
              className="text-xs text-violet-600 dark:text-violet-400 hover:underline font-mono"
              aria-label={`Search example contract: ${contract.label}`}
            >
              {contract.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
