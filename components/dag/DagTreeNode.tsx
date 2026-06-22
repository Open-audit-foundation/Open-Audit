"use client";

/**
 * components/dag/DagTreeNode.tsx
 *
 * Recursive tree node component for the execution DAG visualisation.
 * Each node renders the contract invocation details and its children,
 * with expand/collapse support and a gas-heat bar.
 */

import React, { useState, memo, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTreeExpansion } from "./ExecutionDagView";
import type { DagNode, ExecutionDag } from "@/lib/dag/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Shorten a Stellar address/contract ID for display. */
function shorten(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/** Format a bigint gas value to a human-readable string. */
function fmtGas(n: bigint): string {
  if (n === 0n) return "0";
  if (n < 1_000n) return n.toString();
  if (n < 1_000_000n) return `${(Number(n) / 1_000).toFixed(1)}K`;
  return `${(Number(n) / 1_000_000).toFixed(2)}M`;
}

/** Compute a 0..1 heat ratio for a node relative to the transaction root. */
function heatRatio(node: DagNode, root: DagNode): number {
  if (root.totalCpuInsns === 0n) return 0;
  return Number(node.totalCpuInsns * 1_000n / root.totalCpuInsns) / 1000;
}

/**
 * Returns a Tailwind background colour class based on the heat ratio.
 * Root-level nodes get full "hot" colour; deep leaf calls trend cooler.
 */
function heatColor(ratio: number): string {
  if (ratio >= 0.7) return "bg-red-500";
  if (ratio >= 0.4) return "bg-orange-400";
  if (ratio >= 0.15) return "bg-amber-300";
  if (ratio >= 0.04) return "bg-yellow-200";
  return "bg-muted";
}

// ── Status icon ───────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: DagNode["status"] }) {
  if (status === "success")
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />;
  if (status === "error")
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />;
  return <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

// ── Gas bar ───────────────────────────────────────────────────────────────────

function GasBar({
  selfRatio,
  totalRatio,
}: {
  selfRatio: number;
  totalRatio: number;
}) {
  return (
    <div
      className="relative h-1 w-16 rounded-full bg-muted overflow-hidden"
      role="img"
      aria-label={`Gas: ${(totalRatio * 100).toFixed(1)}% of transaction`}
    >
      {/* Total (including children) */}
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${heatColor(totalRatio)}`}
        style={{ width: `${Math.min(totalRatio * 100, 100)}%` }}
      />
      {/* Self-only (darker overlay) */}
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-primary/60"
        style={{ width: `${Math.min(selfRatio * 100, 100)}%` }}
      />
    </div>
  );
}

// ── Tree node ─────────────────────────────────────────────────────────────────

interface DagTreeNodeProps {
  node: DagNode;
  dag: ExecutionDag;
  root: DagNode;
  /** Whether this node should be expanded on first render. */
  defaultExpanded?: boolean;
}

export const DagTreeNode = memo(function DagTreeNode({
  node,
  dag,
  root,
  defaultExpanded = true,
}: DagTreeNodeProps) {
  const hasChildren = node.childIds.length > 0;
  const { version, expandAll: globalExpandAll } = useTreeExpansion();

  // Local expanded state, reset whenever the global version bumps.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const prevVersionRef = React.useRef(version);
  if (prevVersionRef.current !== version) {
    prevVersionRef.current = version;
    setExpanded(globalExpandAll);
  }

  const toggleExpanded = useCallback(() => {
    if (hasChildren) setExpanded((e) => !e);
  }, [hasChildren]);

  const selfRatio = root.totalCpuInsns > 0n
    ? Number(node.selfCpuInsns * 1_000n / root.totalCpuInsns) / 1000
    : 0;
  const totalRatio = heatRatio(node, root);

  // Indent children relative to this node.
  const isRoot = node.parentId === null;

  return (
    <div
      className={`
        relative
        ${!isRoot ? "ml-4 pl-3 border-l border-border" : ""}
      `}
      data-testid={`dag-node-${node.id}`}
    >
      {/* ── Node card ───────────────────────────────────────────────────── */}
      <div
        className={`
          group flex items-start gap-2 rounded-md px-2 py-1.5 my-0.5
          transition-colors
          ${node.status === "error" ? "bg-red-50/60 dark:bg-red-950/20" : "hover:bg-accent/50"}
          ${hasChildren ? "cursor-pointer" : ""}
        `}
        onClick={toggleExpanded}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleExpanded(); }}
        role={hasChildren ? "button" : undefined}
        tabIndex={hasChildren ? 0 : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-label={`${node.contractId} → ${node.fnName}`}
      >
        {/* Expand/collapse chevron */}
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {hasChildren ? (
            expanded
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <span className="inline-block h-3.5 w-3.5" />
          )}
        </span>

        {/* Status indicator */}
        <StatusIcon status={node.status} />

        {/* Contract + function */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {/* Contract badge */}
            <Badge
              variant="outline"
              className="font-mono text-[10px] px-1 py-0 h-4 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800"
              title={node.contractId}
            >
              {shorten(node.contractId)}
            </Badge>

            {/* Function name */}
            <span className="font-mono text-xs font-semibold text-foreground">
              {node.fnName}
            </span>

            {/* Child count */}
            {hasChildren && (
              <span className="text-[10px] text-muted-foreground">
                ({node.childIds.length} {node.childIds.length === 1 ? "call" : "calls"})
              </span>
            )}

            {/* Error badge */}
            {node.status === "error" && (
              <Badge variant="destructive" className="text-[10px] h-4 px-1 py-0">
                error
              </Badge>
            )}

            {/* Pending badge */}
            {node.status === "pending" && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1 py-0 gap-1">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                pending
              </Badge>
            )}
          </div>

          {/* Gas row */}
          <div className="mt-1 flex items-center gap-2">
            <GasBar selfRatio={selfRatio} totalRatio={totalRatio} />

            {/* Self gas */}
            <span className="text-[10px] text-muted-foreground tabular-nums">
              self {fmtGas(node.selfCpuInsns)} insns
            </span>
            {/* Total gas (only if has children) */}
            {hasChildren && node.totalCpuInsns !== node.selfCpuInsns && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                · total {fmtGas(node.totalCpuInsns)}
              </span>
            )}
            {/* Gas percentage */}
            {totalRatio > 0 && (
              <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                ({(totalRatio * 100).toFixed(1)}%)
              </span>
            )}
          </div>

          {/* Depth indicator */}
          <div className="mt-0.5">
            <span className="text-[10px] text-muted-foreground/60">
              depth {node.depth}
            </span>
          </div>

          {/* Log messages */}
          {node.logs.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {node.logs.map((msg, i) => (
                <li
                  key={i}
                  className="text-[10px] text-muted-foreground font-mono bg-muted/40 rounded px-1 py-0.5 break-all"
                >
                  {msg}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Children ─────────────────────────────────────────────────────── */}
      {hasChildren && expanded && (
        <div>
          {node.childIds.map((childId) => {
            const child = dag.nodes.get(childId);
            if (!child) return null;
            return (
              <DagTreeNode
                key={childId}
                node={child}
                dag={dag}
                root={root}
                defaultExpanded={node.depth < 2}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});
