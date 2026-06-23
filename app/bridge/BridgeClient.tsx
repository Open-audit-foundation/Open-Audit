"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CrossChainJourneyCard } from "@/components/bridge/CrossChainJourneyCard";
import { BridgeJourneyDetail } from "@/components/bridge/BridgeJourneyDetail";
import { BridgeStatsBar } from "@/components/bridge/BridgeStatsBar";
import { useBridgeMatches } from "@/lib/hooks/useBridgeMatches";
import type { CrossChainJourney, MatchStatus } from "@/lib/bridge/types";

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: "All",       value: "" },
  { label: "Matched",   value: "matched" },
  { label: "Pending",   value: "pending" },
  { label: "Unmatched", value: "unmatched" },
  { label: "Disputed",  value: "disputed" },
];

const CHAIN_OPTIONS: { label: string; value: string }[] = [
  { label: "All chains", value: "" },
  { label: "Ethereum",   value: "ethereum" },
  { label: "Optimism",   value: "optimism" },
  { label: "Arbitrum",   value: "arbitrum" },
  { label: "Base",       value: "base" },
];

export function BridgeClient(): React.JSX.Element {
  const [statusFilter, setStatusFilter] = useState("");
  const [chainFilter,  setChainFilter]  = useState("");
  const [selected,     setSelected]     = useState<CrossChainJourney | null>(null);

  const { matches, isLoading, error, refresh, hasMore, loadMore } =
    useBridgeMatches({
      status: statusFilter || undefined,
      chain:  chainFilter  || undefined,
      limit:  25,
    });

  return (
    <div>
      {/* Stats */}
      <BridgeStatsBar matches={matches} />

      {/* Filter bar */}
      <div
        className="flex flex-wrap gap-2 mb-4 items-center"
        role="toolbar"
        aria-label="Bridge transfer filters"
      >
        {/* Status filter */}
        <div className="flex items-center gap-1" role="group" aria-label="Filter by status">
          {STATUS_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={statusFilter === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(opt.value)}
              aria-pressed={statusFilter === opt.value}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        {/* Chain filter */}
        <select
          className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={chainFilter}
          onChange={(e) => setChainFilter(e.target.value)}
          aria-label="Filter by destination chain"
        >
          {CHAIN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="icon"
          onClick={refresh}
          disabled={isLoading}
          aria-label="Refresh"
        >
          <RefreshCw
            className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </Button>
      </div>

      {/* Error */}
      {error && (
        <p role="alert" className="text-sm text-destructive mb-4">
          Failed to load bridge data: {error}
        </p>
      )}

      {/* Empty state */}
      {!isLoading && matches.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No cross-chain transfers found.</p>
          <p className="text-xs mt-1">
            Bridge events appear here as assets move between Stellar and EVM chains.
          </p>
        </div>
      )}

      {/* Journey cards */}
      <div
        className="grid gap-3 sm:grid-cols-2"
        role="list"
        aria-label="Cross-chain transfer list"
        aria-live="polite"
        aria-busy={isLoading}
      >
        {matches.map((journey) => (
          <div key={journey.id} role="listitem">
            <CrossChainJourneyCard
              journey={journey}
              onClick={setSelected}
            />
          </div>
        ))}
      </div>

      {/* Skeleton rows while loading */}
      {isLoading && matches.length === 0 && (
        <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border bg-card p-4 h-36 animate-pulse bg-muted"
            />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center mt-6">
          <Button variant="outline" onClick={loadMore} disabled={isLoading}>
            {isLoading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      {/* Detail dialog */}
      <BridgeJourneyDetail
        journey={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
