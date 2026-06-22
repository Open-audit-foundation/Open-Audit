"use client";

/**
 * components/dag/ExecutionDagView.tsx
 *
 * The main container component for visualising a Soroban execution DAG.
 *
 * Features:
 * - Summary header: tx hash, ledger, gas totals, completeness indicator.
 * - Expand-all / collapse-all controls that push state down via a context key.
 * - Recursive DagTreeNode tree for the call hierarchy.
 * - Loading skeleton and empty/error states.
 * - Gas legend.
 */

import React, {
  useMemo,
  useState,
  useCallback,
  createContext,
  useContext,
  memo,
} from "react";
import {
  GitBranch,
  Zap,
  HardDrive,
  RefreshCw,
  ChevronsDownUp,
  ChevronsUpDown,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DagTreeNode } from "./DagTreeNode";
import type { ExecutionDag } from "@/lib/dag/types";

// ── Context for expand-all / collapse-all ─────────────────────────────────────

interface TreeExpansionContextValue {
  /**
   * Monotonically-increasing version counter.  When it changes, all nodes
   * reset their expansion state to `expandAll`.
   */
  version: number;
  expandAll: boolean;
}

export const TreeExpansionContext = createContext<TreeExpansionContextValue>({
  version: 0,
  expandAll: true,
});

export function useTreeExpansion() {
  return useContext(TreeExpansionContext);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shorten(id: string, head = 8, tail = 6): string {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

function fmtGas(n: bigint): string {
  if (n === 0n) return "0";
  if (n < 1_000n) return n.toString();
  if (n < 1_000_000n) return `${(Number(n) / 1_000).toFixed(1)} K`;
  if (n < 1_000_000_000n) return `${(Number(n) / 1_000_000).toFixed(2)} M`;
  return `${(Number(n) / 1_000_000_000).toFixed(3)} G`;
}

function fmtBytes(n: bigint): string {
  if (n === 0n) return "0 B";
  if (n < 1024n) return `${n} B`;
  if (n < 1_048_576n) return `${(Number(n) / 1024).toFixed(1)} KB`;
  return `${(Number(n) / 1_048_576).toFixed(2)} MB`;
}

// ── Summary header ────────────────────────────────────────────────────────────

const DagSummary = memo(function DagSummary({ dag }: { dag: ExecutionDag }) {
  const nodeCount = dag.nodes.size;
  const contractSet = new Set<string>();
  for (const node of dag.nodes.values()) {
    contractSet.add(node.contractId);
  }

  return (
    <div className="space-y-3 pb-4 border-b mb-4">
      {/* Tx hash */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Tx</span>
        <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded break-all">
          {dag.txHash}
        </code>
        {dag.isComplete ? (
          <Badge variant="success" className="gap-1 text-[10px] h-4">
            <CheckCircle2 className="h-2.5 w-2.5" /> Complete
          </Badge>
        ) : (
          <Badge variant="warning" className="gap-1 text-[10px] h-4">
            <AlertCircle className="h-2.5 w-2.5" /> Partial
          </Badge>
        )}
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-3">
        {/* Ledger */}
        <StatChip icon={<GitBranch className="h-3 w-3" />} label="Ledger">
          {dag.ledger.toLocaleString()}
        </StatChip>

        {/* CPU gas */}
        <StatChip icon={<Zap className="h-3 w-3" />} label="CPU insns">
          {fmtGas(dag.totalCpuInsns)}
        </StatChip>

        {/* Memory */}
        <StatChip icon={<HardDrive className="h-3 w-3" />} label="Memory">
          {fmtBytes(dag.totalMemBytes)}
        </StatChip>

        {/* Frame count */}
        <StatChip icon={<GitBranch className="h-3 w-3" />} label="Frames">
          {nodeCount}
        </StatChip>

        {/* Unique contracts */}
        <StatChip icon={<GitBranch className="h-3 w-3" />} label="Contracts">
          {contractSet.size}
        </StatChip>
      </div>
    </div>
  );
});

function StatChip({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="text-primary">{icon}</span>
      <span>{label}:</span>
      <span className="font-semibold text-foreground tabular-nums">{children}</span>
    </div>
  );
}

// ── Gas legend ────────────────────────────────────────────────────────────────

const GasLegend = memo(function GasLegend() {
  const entries = [
    { label: "≥70%", className: "bg-red-500" },
    { label: "40–70%", className: "bg-orange-400" },
    { label: "15–40%", className: "bg-amber-300" },
    { label: "4–15%", className: "bg-yellow-200 border border-border" },
    { label: "<4%", className: "bg-muted border border-border" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground pt-3 border-t">
      <span className="font-medium">Gas heat:</span>
      {entries.map((e) => (
        <span key={e.label} className="flex items-center gap-1">
          <span className={`inline-block h-2 w-4 rounded-sm ${e.className}`} />
          {e.label}
        </span>
      ))}
      <span className="ml-1 text-muted-foreground/60">
        · bar left = self-only, full = total (incl. children)
      </span>
    </div>
  );
});

// ── Loading skeleton ──────────────────────────────────────────────────────────

function SkeletonTree() {
  return (
    <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Loading call tree">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-2"
          style={{ paddingLeft: `${i * 16}px` }}
        >
          <div className="h-3.5 w-3.5 rounded-sm bg-muted" />
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-1 w-16 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ExecutionDagViewProps {
  dag: ExecutionDag | null;
  loading?: boolean;
  error?: string | null;
  onRefetch?: () => void;
  /** Maximum pixel height of the scrollable tree area. Default 600. */
  maxTreeHeight?: number;
}

export function ExecutionDagView({
  dag,
  loading = false,
  error = null,
  onRefetch,
  maxTreeHeight = 600,
}: ExecutionDagViewProps) {
  // Global expansion version — increment to reset all node states.
  const [expansion, setExpansion] = useState<{
    version: number;
    expandAll: boolean;
  }>({ version: 0, expandAll: true });

  const expandAll = useCallback(() => {
    setExpansion((prev) => ({ version: prev.version + 1, expandAll: true }));
  }, []);

  const collapseAll = useCallback(() => {
    setExpansion((prev) => ({ version: prev.version + 1, expandAll: false }));
  }, []);

  const rootNode = useMemo(
    () => (dag && dag.rootId ? dag.nodes.get(dag.rootId) ?? null : null),
    [dag]
  );

  return (
    <section className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 space-y-2">
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <GitBranch className="h-4 w-4 text-primary" />
          Execution Call Tree
        </h2>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            onClick={expandAll}
            disabled={loading || !dag}
            aria-label="Expand all nodes"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            Expand all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            onClick={collapseAll}
            disabled={loading || !dag}
            aria-label="Collapse all nodes"
          >
            <ChevronsDownUp className="h-3.5 w-3.5" />
            Collapse all
          </Button>
          {onRefetch && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              onClick={onRefetch}
              disabled={loading}
              aria-label="Reload DAG"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Reload
            </Button>
          )}
        </div>
      </div>

      {/* ── Summary ──────────────────────────────────────────────────── */}
      {dag && <DagSummary dag={dag} />}

      {/* ── Tree body ────────────────────────────────────────────────── */}
      <div
        className="overflow-y-auto pr-1"
        style={{ maxHeight: `${maxTreeHeight}px` }}
      >
        {loading && <SkeletonTree />}

        {!loading && error && (
          <div
            className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && dag === null && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Select a transaction to view its execution call tree.
          </p>
        )}

        {!loading && !error && dag !== null && rootNode === null && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No invocation frames found in this transaction.
          </p>
        )}

        {!loading && !error && dag !== null && rootNode !== null && (
          <TreeExpansionContext.Provider value={expansion}>
            <DagTreeNode
              node={rootNode}
              dag={dag}
              root={rootNode}
              defaultExpanded
            />
          </TreeExpansionContext.Provider>
        )}
      </div>

      {/* ── Legend ───────────────────────────────────────────────────── */}
      {dag && <GasLegend />}
    </section>
  );
}
