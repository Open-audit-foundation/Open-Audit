"use client";

/**
 * components/dag/DagExplorer.tsx
 *
 * Standalone page-level component for the /dag route.
 * Provides a search input for a transaction hash, then renders
 * the ExecutionDagView with live fetch state.
 */

import { useState, useCallback, FormEvent } from "react";
import { Search, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExecutionDagView } from "./ExecutionDagView";
import { useExecutionDag } from "@/lib/hooks/useExecutionDag";

// ── Quick-access example hashes (testnet) ────────────────────────────────────
// Replace these with real hashes from your network once available.
const EXAMPLES: { label: string; txHash: string }[] = [
  {
    label: "Example — SAC transfer",
    txHash: "0000000000000000000000000000000000000000000000000000000000000000",
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function DagExplorer() {
  const [inputValue, setInputValue] = useState("");
  const [activeTxHash, setActiveTxHash] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const { dag, loading, error, refetch } = useExecutionDag(activeTxHash);

  const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = inputValue.trim();

      if (!TX_HASH_RE.test(trimmed)) {
        setInputError("Transaction hash must be exactly 64 hex characters.");
        return;
      }

      setInputError(null);
      // If same hash re-submitted, force a refetch.
      if (trimmed === activeTxHash) {
        refetch();
      } else {
        setActiveTxHash(trimmed);
      }
    },
    [inputValue, activeTxHash, refetch]
  );

  const loadExample = useCallback((txHash: string) => {
    setInputValue(txHash);
    setInputError(null);
    setActiveTxHash(txHash);
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Search form ──────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <label
          htmlFor="tx-hash-input"
          className="text-sm font-medium text-foreground"
        >
          Transaction Hash
        </label>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              id="tx-hash-input"
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (inputError) setInputError(null);
              }}
              placeholder="Enter a 64-character hex transaction hash…"
              className={`pl-9 font-mono text-sm ${
                inputError ? "border-destructive focus-visible:ring-destructive" : ""
              }`}
              aria-describedby={inputError ? "tx-hash-error" : undefined}
              aria-invalid={inputError ? true : undefined}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !inputValue.trim()}
            className="shrink-0"
          >
            <GitBranch className="h-4 w-4 mr-1.5" />
            Inspect
          </Button>
        </div>

        {inputError && (
          <p
            id="tx-hash-error"
            className="text-xs text-destructive"
            role="alert"
          >
            {inputError}
          </p>
        )}
      </form>

      {/* ── Example links ─────────────────────────────────────────────────── */}
      {EXAMPLES.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Try an example:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.txHash}
              type="button"
              onClick={() => loadExample(ex.txHash)}
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              {ex.label}
            </button>
          ))}
        </div>
      )}

      {/* ── DAG view ─────────────────────────────────────────────────────── */}
      <ExecutionDagView
        dag={dag}
        loading={loading}
        error={error}
        onRefetch={activeTxHash ? refetch : undefined}
        maxTreeHeight={580}
      />
    </div>
  );
}
