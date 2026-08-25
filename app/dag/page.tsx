"use client";

import type { Metadata } from "next";
import { useState, useCallback } from "react";
import { GitBranch, Search, AlertTriangle } from "lucide-react";
import { DagPanel } from "@/components/dag/DagPanel";
import { Button } from "@/components/ui/button";
import type { ExecutionDag } from "@/lib/dag/types";

export default function DagPage(): React.JSX.Element {
  const [txHash, setTxHash] = useState("");
  const [dag, setDag] = useState<ExecutionDag | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    const trimmed = txHash.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setError(null);
    setDag(null);

    try {
      const res = await fetch(`/api/v1/dag?txHash=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDag(data.dag);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch DAG");
    } finally {
      setIsLoading(false);
    }
  }, [txHash]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSearch();
      }
    },
    [handleSearch]
  );

  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
            <GitBranch className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Call Tree (DAG)</h1>
            <p className="text-sm text-muted-foreground">
              Visualize Soroban contract execution as a directed acyclic graph.
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6 flex items-center gap-2">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Enter transaction hash..."
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-10 w-full rounded-lg border bg-background pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={!txHash.trim() || isLoading}
          className="h-10"
        >
          {isLoading ? "Loading..." : "View Call Tree"}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      {/* DAG Visualization */}
      <DagPanel dag={dag} isLoading={isLoading} txHash={txHash} />

      {/* Feature list (shown when no DAG is loaded) */}
      {!dag && !isLoading && !error && (
        <div className="mt-8 rounded-lg border bg-card p-6">
          <h2 className="text-sm font-medium mb-3">Features</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-violet-500 shrink-0" />
              <span>Collapsible call-tree view with contract addresses and function names</span>
            </li>
            <li className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
              <span>Reentrancy detection with full call path visualization</span>
            </li>
            <li className="flex items-center gap-2">
              <Search className="h-4 w-4 text-blue-500 shrink-0" />
              <span>Filter by contract address or function name</span>
            </li>
            <li className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-purple-500 shrink-0" />
              <span>Auth tracing showing which accounts authorized each call</span>
            </li>
          </ul>
        </div>
      )}
    </main>
  );
}
