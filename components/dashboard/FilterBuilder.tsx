"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, type SelectOption } from "@/components/ui/select";
import { useEventFilters } from "@/lib/hooks/useEventFilters";

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

const DEFAULT_EVENT_TYPES = [
  "Transfer",
  "Mint",
  "Burn",
  "Swap",
  "Approve",
  "Lend",
  "Deposit",
  "Withdraw",
];

const NETWORK_OPTIONS: SelectOption[] = [
  { value: "", label: "All Networks" },
  { value: "testnet", label: "Testnet" },
  { value: "mainnet", label: "Mainnet" },
];

interface FilterBuilderProps {
  eventTypeSuggestions: string[];
  contractSuggestions?: string[];
}

export function FilterBuilder({
  eventTypeSuggestions,
  contractSuggestions = [],
}: FilterBuilderProps): React.JSX.Element {
  const { filters, rawParams, setFilters, clearAll } = useEventFilters();

  const [contractInput, setContractInput] = useState(filters.contractId ?? "");
  const [minAmountInput, setMinAmountInput] = useState(rawParams.minAmount ?? "");
  const [startLedgerInput, setStartLedgerInput] = useState(rawParams.startLedger ?? "");
  const [endLedgerInput, setEndLedgerInput] = useState(rawParams.endLedger ?? "");

  useEffect(
    function () {
      setContractInput(filters.contractId ?? "");
    },
    [filters.contractId]
  );

  useEffect(
    function () {
      setMinAmountInput(rawParams.minAmount ?? "");
    },
    [rawParams.minAmount]
  );

  useEffect(
    function () {
      setStartLedgerInput(rawParams.startLedger ?? "");
    },
    [rawParams.startLedger]
  );

  useEffect(
    function () {
      setEndLedgerInput(rawParams.endLedger ?? "");
    },
    [rawParams.endLedger]
  );

  const eventTypeOptions: SelectOption[] = useMemo(
    function () {
      const all = Array.from(
        new Set([...DEFAULT_EVENT_TYPES, ...eventTypeSuggestions].filter(Boolean))
      ).sort();
      return [
        { value: "", label: "All Event Types" },
        ...all.map((et) => ({ value: et, label: et })),
      ];
    },
    [eventTypeSuggestions]
  );

  const contractOptions: SelectOption[] = useMemo(
    function () {
      const seen = new Set<string>();
      const opts: SelectOption[] = [{ value: "", label: "All Contracts" }];

      for (const ex of EXAMPLE_CONTRACTS) {
        if (!seen.has(ex.id)) {
          seen.add(ex.id);
          opts.push({ value: ex.id, label: `${ex.label} (${ex.id.slice(0, 6)}…${ex.id.slice(-4)})` });
        }
      }

      for (const id of contractSuggestions) {
        if (!seen.has(id)) {
          seen.add(id);
          opts.push({ value: id, label: `${id.slice(0, 6)}…${id.slice(-4)}` });
        }
      }

      return opts;
    },
    [contractSuggestions]
  );

  const hasAnyFilter =
    Boolean(filters.contractId) ||
    Boolean(filters.eventType) ||
    Boolean(filters.network) ||
    filters.minAmount !== undefined ||
    filters.startLedger !== undefined ||
    filters.endLedger !== undefined;

  function setParam(key: keyof typeof rawParams, value: string | null): void {
    // Reset page to 1 whenever a filter changes
    setFilters({ [key]: value, page: "1" });
  }

  function handleContractSubmit(): void {
    const value = contractInput.trim();
    setParam("contractId", value || null);
  }

  function handleNumericSubmit(key: keyof typeof rawParams, value: string): void {
    const trimmed = value.trim();
    setParam(key, trimmed || null);
  }

  return (
    <div className="rounded-2xl border border-input bg-background/70 p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-3">
        {/* ── Network Select ─────────────────────────────────── */}
        <label className="min-w-0">
          <span className="text-sm font-medium">Network</span>
          <Select
            id="filter-network"
            value={filters.network ?? ""}
            onValueChange={(val) => setParam("network", val || null)}
            options={NETWORK_OPTIONS}
            placeholder="All Networks"
            className="mt-2"
            aria-label="Filter by network"
          />
        </label>

        {/* ── Contract ID Select + free-text input ───────────── */}
        <label className="min-w-0">
          <span className="text-sm font-medium">Contract ID</span>
          {contractOptions.length > 1 ? (
            <Select
              id="filter-contract"
              value={filters.contractId ?? ""}
              onValueChange={(val) => setParam("contractId", val || null)}
              options={contractOptions}
              placeholder="All Contracts"
              className="mt-2"
              aria-label="Filter by contract ID"
            />
          ) : (
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={contractInput}
                onChange={(event) => setContractInput(event.target.value)}
                onBlur={() => handleContractSubmit()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleContractSubmit();
                  }
                }}
                placeholder="C... or paste a contract address"
                className="pl-9"
                aria-label="Filter by contract ID"
              />
            </div>
          )}
        </label>

        {/* ── Event Topic Select ──────────────────────────────── */}
        <label className="min-w-0">
          <span className="text-sm font-medium">Event Topic</span>
          <Select
            id="filter-event-type"
            value={filters.eventType ?? ""}
            onValueChange={(val) => setParam("eventType", val || null)}
            options={eventTypeOptions}
            placeholder="All Event Types"
            className="mt-2"
            aria-label="Filter by event topic"
          />
        </label>

        {/* ── Ledger range ────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 xl:col-span-1">
          <label className="min-w-0">
            <span className="text-sm font-medium">Start ledger</span>
            <Input
              type="number"
              value={startLedgerInput}
              onChange={(event) => setStartLedgerInput(event.target.value)}
              onBlur={() => handleNumericSubmit("startLedger", startLedgerInput)}
              placeholder="e.g. 52341001"
              className="mt-2"
              aria-label="Filter by start ledger"
            />
          </label>
          <label className="min-w-0">
            <span className="text-sm font-medium">End ledger</span>
            <Input
              type="number"
              value={endLedgerInput}
              onChange={(event) => setEndLedgerInput(event.target.value)}
              onBlur={() => handleNumericSubmit("endLedger", endLedgerInput)}
              placeholder="e.g. 52341050"
              className="mt-2"
              aria-label="Filter by end ledger"
            />
          </label>
        </div>

        {/* ── Min amount ──────────────────────────────────────── */}
        <label className="min-w-0 xl:col-span-1">
          <span className="text-sm font-medium">Amount &gt;</span>
          <Input
            type="number"
            step="any"
            value={minAmountInput}
            onChange={(event) => setMinAmountInput(event.target.value)}
            onBlur={() => handleNumericSubmit("minAmount", minAmountInput)}
            placeholder="e.g. 50000"
            className="mt-2"
            aria-label="Filter by minimum amount"
          />
        </label>
      </div>

      {/* ── Active filter badges ─────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {filters.network && (
          <Badge className="inline-flex items-center gap-2">
            Network: {filters.network}
            <button
              type="button"
              onClick={() => setParam("network", null)}
              aria-label="Remove network filter"
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        )}
        {filters.contractId && (
          <Badge className="inline-flex items-center gap-2">
            Contract: {filters.contractId.slice(0, 6)}…{filters.contractId.slice(-4)}
            <button
              type="button"
              onClick={() => setParam("contractId", null)}
              aria-label="Remove contract filter"
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        )}
        {filters.eventType && (
          <Badge className="inline-flex items-center gap-2">
            Event: {filters.eventType}
            <button
              type="button"
              onClick={() => setParam("eventType", null)}
              aria-label="Remove event filter"
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        )}
        {filters.startLedger !== undefined && (
          <Badge className="inline-flex items-center gap-2">
            Ledger ≥ {filters.startLedger}
            <button
              type="button"
              onClick={() => setParam("startLedger", null)}
              aria-label="Remove start ledger filter"
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        )}
        {filters.endLedger !== undefined && (
          <Badge className="inline-flex items-center gap-2">
            Ledger ≤ {filters.endLedger}
            <button
              type="button"
              onClick={() => setParam("endLedger", null)}
              aria-label="Remove end ledger filter"
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        )}
        {filters.minAmount !== undefined && (
          <Badge className="inline-flex items-center gap-2">
            Amount &gt; {filters.minAmount}
            <button
              type="button"
              onClick={() => setParam("minAmount", null)}
              aria-label="Remove amount filter"
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        )}

        {hasAnyFilter && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-9"
            onClick={clearAll}
            type="button"
          >
            Clear all filters
          </Button>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-dashed border-input/60 bg-muted/5 p-3 text-sm text-muted-foreground">
        <p className="font-medium">Deep-link ready</p>
        <p className="mt-1">
          Complex filters are stored in the URL. Copy and paste the browser address to restore the full filter state.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Try quick contract filters:</span>
        {EXAMPLE_CONTRACTS.map((contract) => (
          <button
            key={contract.id}
            type="button"
            onClick={() => {
              setContractInput(contract.id);
              setParam("contractId", contract.id);
            }}
            className="rounded-full border border-input px-3 py-1 text-xs font-mono text-violet-600 transition hover:bg-violet-50"
          >
            {contract.label}
          </button>
        ))}
      </div>
    </div>
  );
}
