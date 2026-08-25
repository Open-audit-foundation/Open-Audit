"use client";

interface InclusionProofPanelProps {
  txHash: string;
  ledger: number;
}

/** Placeholder for Soroban inclusion-proof verification UI. */
export function InclusionProofPanel({ txHash, ledger }: InclusionProofPanelProps) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
      Inclusion proof verification for ledger {ledger} (tx {txHash.slice(0, 8)}…) is not
      configured in this build.
    </div>
  );
}
