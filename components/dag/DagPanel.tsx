"use client";

import React, { useState, useCallback, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Shield,
  FileCode,
  Cpu,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { ExecutionDag, DagNode, ReentrancyInfo, AuthTrace } from "@/lib/dag/types";

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function truncateAddress(addr: string, chars: number = 6): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

function kindBadgeColor(kind: DagNode["kind"]): string {
  switch (kind) {
    case "contract_fn":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
    case "create_contract":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
    case "system_fn":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  }
}

function kindLabel(kind: DagNode["kind"]): string {
  switch (kind) {
    case "contract_fn": return "contract";
    case "create_contract": return "deploy";
    case "system_fn": return "system";
  }
}

// ---------------------------------------------------------------------------
// TreeNode — renders a single node with collapsible children
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  node: DagNode;
  allNodes: DagNode[];
  reentrancyContracts: Set<string>;
  reentrancyPaths: Set<number>;
  authMap: Map<number, AuthTrace>;
  depth: number;
  expandedByDefault: boolean;
}

function TreeNode({
  node,
  allNodes,
  reentrancyContracts,
  reentrancyPaths,
  authMap,
  depth,
  expandedByDefault,
}: TreeNodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(expandedByDefault);
  const children = node.children.map((id) => allNodes[id]).filter(Boolean);
  const hasChildren = children.length > 0;
  const isReentrancyNode = node.contractId !== null && reentrancyContracts.has(node.contractId);
  const isOnReentrancyPath = reentrancyPaths.has(node.id);
  const authTrace = authMap.get(node.id);

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
          isOnReentrancyPath
            ? "bg-red-50 dark:bg-red-950/30 ring-1 ring-red-200 dark:ring-red-800"
            : "hover:bg-muted/50"
        }`}
        style={{ marginLeft: depth * 20 }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}

        {/* Reentrancy warning icon */}
        {isReentrancyNode && isOnReentrancyPath && (
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-red-500"
            title="Reentrancy detected"
          />
        )}

        {/* Kind badge */}
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${kindBadgeColor(
            node.kind
          )}`}
        >
          {node.kind === "create_contract" && <Plus className="h-3 w-3" />}
          {node.kind === "system_fn" && <Cpu className="h-3 w-3" />}
          {node.kind === "contract_fn" && <FileCode className="h-3 w-3" />}
          {kindLabel(node.kind)}
        </span>

        {/* Contract address */}
        {node.contractId ? (
          <span
            className="font-mono text-xs text-muted-foreground"
            title={node.contractId}
          >
            {truncateAddress(node.contractId)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground italic">no contract</span>
        )}

        {/* Function name */}
        {node.functionName && (
          <span className="font-mono text-xs font-medium text-foreground">
            {node.functionName}
          </span>
        )}

        {/* Auth badge */}
        {authTrace && authTrace.authorizedBy.length > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
            title={`Authorized by: ${authTrace.authorizedBy.join(", ")}`}
          >
            <Shield className="h-3 w-3" />
            auth
          </span>
        )}

        {/* Depth indicator */}
        <span className="ml-auto text-xs text-muted-foreground/60">
          d{node.depth}
        </span>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              allNodes={allNodes}
              reentrancyContracts={reentrancyContracts}
              reentrancyPaths={reentrancyPaths}
              authMap={authMap}
              depth={depth + 1}
              expandedByDefault={depth < 2}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReentrancyPanel — shows reentrancy details
// ---------------------------------------------------------------------------

function ReentrancyPanel({
  details,
}: {
  details: ReentrancyInfo[];
}): React.JSX.Element | null {
  if (details.length === 0) return null;

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-800 dark:text-red-300">
        <AlertTriangle className="h-4 w-4" />
        Reentrancy Detected ({details.length} instance{details.length !== 1 ? "s" : ""})
      </div>
      <ul className="space-y-2">
        {details.map((info, i) => (
          <li key={i} className="text-xs text-red-700 dark:text-red-400">
            <span className="font-mono font-medium">{truncateAddress(info.contractId, 8)}</span>
            {" — "}
            {info.description}
            <div className="mt-1 font-mono text-red-600/70 dark:text-red-500/70">
              Path: {info.callPath.map((id) => `#${id}`).join(" → ")}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AuthPanel — shows auth trace details
// ---------------------------------------------------------------------------

function AuthPanel({
  traces,
}: {
  traces: AuthTrace[];
}): React.JSX.Element | null {
  if (traces.length === 0) return null;

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-950/30">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-purple-800 dark:text-purple-300">
        <Shield className="h-4 w-4" />
        Authorization Traces
      </div>
      <ul className="space-y-1">
        {traces.map((trace, i) => (
          <li key={i} className="text-xs text-purple-700 dark:text-purple-400">
            <span className="font-mono font-medium">#{trace.nodeId}</span>
            {" "}
            {trace.functionName ?? "unknown"}
            {" — authorized by: "}
            {trace.authorizedBy.length > 0 ? (
              trace.authorizedBy.map((addr) => (
                <span key={addr} className="font-mono" title={addr}>
                  {truncateAddress(addr)}
                </span>
              ))
            ) : (
              <span className="italic">no auth data</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main DagPanel component
// ---------------------------------------------------------------------------

interface DagPanelProps {
  dag: ExecutionDag | null;
  isLoading?: boolean;
  txHash?: string | null;
}

export function DagPanel({
  dag,
  isLoading = false,
  txHash,
}: DagPanelProps): React.JSX.Element {
  const [filter, setFilter] = useState("");

  // Build lookup structures for reentrancy visualization.
  const reentrancyContracts = useMemo(() => {
    const set = new Set<string>();
    if (dag?.reentrancyDetails) {
      for (const r of dag.reentrancyDetails) {
        set.add(r.contractId);
      }
    }
    return set;
  }, [dag]);

  const reentrancyPaths = useMemo(() => {
    const set = new Set<number>();
    if (dag?.reentrancyDetails) {
      for (const r of dag.reentrancyDetails) {
        for (const id of r.callPath) {
          set.add(id);
        }
      }
    }
    return set;
  }, [dag]);

  const authMap = useMemo(() => {
    const map = new Map<number, AuthTrace>();
    if (dag?.authTraces) {
      for (const trace of dag.authTraces) {
        map.set(trace.nodeId, trace);
      }
    }
    return map;
  }, [dag]);

  // Find root nodes (not in any children list).
  const rootNodes = useMemo(() => {
    if (!dag) return [];
    const childIds = new Set(dag.nodes.flatMap((n) => n.children));
    return dag.nodes.filter((n) => !childIds.has(n.id));
  }, [dag]);

  // Filter nodes by search query.
  const filteredRoots = useMemo(() => {
    if (!filter || !dag) return rootNodes;
    const q = filter.toLowerCase();
    return rootNodes.filter((node) => {
      const matchesNode =
        node.contractId?.toLowerCase().includes(q) ||
        node.functionName?.toLowerCase().includes(q);
      const matchesChild = node.children.some((id) => {
        const child = dag.nodes[id];
        return (
          child?.contractId?.toLowerCase().includes(q) ||
          child?.functionName?.toLowerCase().includes(q)
        );
      });
      return matchesNode || matchesChild;
    });
  }, [rootNodes, filter, dag]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span className="ml-2">Loading call tree...</span>
      </div>
    );
  }

  if (!dag) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {txHash
          ? `No call tree available for ${truncateAddress(txHash, 8)}`
          : "Select a transaction to view its call tree."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Execution Call Tree</h3>
          <p className="text-xs text-muted-foreground">
            Tx: <span className="font-mono">{truncateAddress(dag.txHash, 8)}</span>
            {" · "}Ledger {dag.ledger}
            {" · "}{dag.nodes.length} calls
            {" · "}{dag.uniqueContracts} contracts
            {dag.maxDepth > 0 && ` · depth ${dag.maxDepth}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter contracts..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 rounded-md border bg-background pl-7 pr-6 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Reentrancy alerts */}
      <ReentrancyPanel details={dag.reentrancyDetails} />

      {/* Auth traces */}
      <AuthPanel traces={dag.authTraces} />

      {/* Tree */}
      <div className="overflow-auto rounded-lg border bg-card p-2" style={{ maxHeight: 500 }}>
        {filteredRoots.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            No matching nodes for "{filter}"
          </p>
        ) : (
          filteredRoots.map((root) => (
            <TreeNode
              key={root.id}
              node={root}
              allNodes={dag.nodes}
              reentrancyContracts={reentrancyContracts}
              reentrancyPaths={reentrancyPaths}
              authMap={authMap}
              depth={0}
              expandedByDefault
            />
          ))
        )}
      </div>
    </div>
  );
}
