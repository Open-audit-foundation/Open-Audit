"use client";

/**
 * components/dag/DagPanel.tsx
 *
 * A self-contained panel that fetches and renders the execution DAG for a
 * given Soroban transaction hash.  Drop this anywhere a txHash is known.
 *
 * Usage:
 *   <DagPanel txHash={event.raw.txHash} />
 */

import React from "react";
import { useExecutionDag } from "@/lib/hooks/useExecutionDag";
import { ExecutionDagView } from "./ExecutionDagView";

export interface DagPanelProps {
  /** 64-char hex transaction hash, or null/empty to render nothing. */
  txHash: string | null | undefined;
  /** Maximum height (px) for the scrollable tree area. */
  maxTreeHeight?: number;
}

export function DagPanel({ txHash, maxTreeHeight = 520 }: DagPanelProps) {
  const { dag, loading, error, refetch } = useExecutionDag(txHash ?? null);

  return (
    <ExecutionDagView
      dag={dag}
      loading={loading}
      error={error}
      onRefetch={refetch}
      maxTreeHeight={maxTreeHeight}
    />
  );
}
