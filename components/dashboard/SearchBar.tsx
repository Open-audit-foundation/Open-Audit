"use client";

import { useState, type FormEvent } from "react";
import { Search, X, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchBarProps {
  onSearch: (contractId: string) => void;
  defaultValue?: string;
  topicFilter: string;
  onTopicFilterChange: (value: string) => void;
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

const STELLAR_CONTRACT_REGEX = /^C[A-Z2-7]{55}$/;

export function SearchBar({
  onSearch,
  defaultValue = "",
  topicFilter,
  onTopicFilterChange,
}: SearchBarProps): React.JSX.Element {
  const [value, setValue] = useState(defaultValue);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed && !STELLAR_CONTRACT_REGEX.test(trimmed)) {
      setValidationError("Invalid Stellar contract ID. Must be 56 characters starting with 'C'.");
      return;
    }
    setValidationError(null);
    if (trimmed) {
      onSearch(trimmed);
    }
  }

  function handleClear(): void {
    setValue("");
    setValidationError(null);
    onSearch("");
  }

  function handleExampleClick(contractId: string): void {
    setValue(contractId);
    setValidationError(null);
    onSearch(contractId);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Contract ID
        </label>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={value}
              onChange={function (e) {
                setValue(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder="Enter a Soroban Contract ID (C...)"
              className="pl-9 pr-9 font-mono text-sm"
              aria-label="Contract ID filter"
            />
            {value && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear contract filter"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button type="submit" disabled={!value.trim()}>
            Filter
          </Button>
        </form>
        {validationError && <p className="text-xs text-destructive">{validationError}</p>}
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
              >
                {contract.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Event Type
        </label>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={topicFilter}
            onChange={function (e) {
              onTopicFilterChange(e.target.value);
            }}
            placeholder="Filter by event type (e.g. Transfer, Mint, Burn)"
            className="pl-9 pr-9 font-mono text-sm"
            aria-label="Event type filter"
          />
          {topicFilter && (
            <button
              type="button"
              onClick={function () {
                onTopicFilterChange("");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear event type filter"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
