"use client";

import React from "react";

interface DagPanelProps {
  txHash: string | null;
  maxTreeHeight?: number;
}

/**
 * DagPanel renders the execution call-tree (DAG) for a given transaction hash.
 * This is a placeholder component – the real implementation lives in a separate
 * package / future PR.
 */
export function DagPanel({ txHash, maxTreeHeight = 400 }: DagPanelProps): React.JSX.Element {
  if (!txHash) {
    return <div className="p-4 text-sm text-muted-foreground">No transaction selected.</div>;
  }

  return (
    <div
      className="flex items-center justify-center text-sm text-muted-foreground"
      style={{ minHeight: maxTreeHeight }}
    >
      Call tree for <span className="font-mono ml-1">{txHash}</span>
    </div>
  );
}
