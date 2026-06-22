"use client";

/**
 * InclusionProofPanel
 *
 * A collapsible panel that lets the user independently verify that a
 * translated event corresponds to a finalized Stellar transaction by
 * walking the Merkle inclusion proof in-browser with WebCrypto.
 *
 * States:
 *  idle     — "Verify on-chain inclusion" button
 *  loading  — animated spinner
 *  verified — green banner with proof details
 *  invalid  — red tamper-detection alert
 *  error    — amber "could not fetch" warning
 */

import { useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInclusionProof } from "@/lib/hooks/useInclusionProof";
import { useNetwork } from "@/lib/hooks/useNetwork";
import type { InclusionProof } from "@/lib/stellar/stellar-proof";

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProofRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-xs break-all ${mono ? "font-mono" : ""} text-foreground/80`}
      >
        {value}
      </span>
    </div>
  );
}

function MerklePathDetails({
  proof,
}: {
  proof: InclusionProof;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 rounded border border-dashed border-muted-foreground/30">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <GitBranch className="h-3 w-3 shrink-0" />
        Merkle path ({proof.merklePath.length} hop
        {proof.merklePath.length !== 1 ? "s" : ""})
      </button>

      {open && (
        <div className="border-t border-dashed border-muted-foreground/30 px-3 py-2">
          {proof.merklePath.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Single-transaction ledger — no sibling hops needed.
            </p>
          ) : (
            <ol className="space-y-1.5 list-none">
              {proof.merklePath.map((node, i) => (
                <li key={i} className="text-xs font-mono">
                  <span className="text-muted-foreground mr-1.5">
                    [{i + 1}] {node.position.padEnd(5)}
                  </span>
                  <span className="text-foreground/70">
                    {node.siblingHash.slice(0, 16)}…{node.siblingHash.slice(-8)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              Full JSON
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[10px] font-mono leading-relaxed">
              {JSON.stringify(proof.merklePath, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

// ─── State panels ─────────────────────────────────────────────────────────────

function VerifiedPanel({
  proof,
  computedRoot,
}: {
  proof: InclusionProof;
  computedRoot: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            On-chain inclusion verified
          </p>
          <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
            This event&apos;s transaction was cryptographically confirmed in ledger{" "}
            <strong>{proof.ledgerSequence.toLocaleString()}</strong> (
            {proof.txCount} tx
            {proof.txCount !== 1 ? "s" : ""} in set,{" "}
            {proof.merklePath.length} Merkle hop
            {proof.merklePath.length !== 1 ? "s" : ""}).
          </p>
        </div>
      </div>

      {/* Hashes */}
      <div className="space-y-2 rounded bg-emerald-100/60 dark:bg-emerald-900/30 px-3 py-2.5">
        <ProofRow
          label="Computed root (browser)"
          value={computedRoot}
        />
        <ProofRow
          label="Ledger root (Horizon)"
          value={proof.ledgerRootHash}
        />
        <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-1">
          ✓ Roots match — verified using WebCrypto SHA-256 in your browser.
        </p>
      </div>

      <MerklePathDetails proof={proof} />
    </div>
  );
}

function InvalidPanel({
  proof,
  computedRoot,
}: {
  proof: InclusionProof;
  computedRoot: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <ShieldX className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            ⚠️ Proof mismatch — possible tampering detected
          </p>
          <p className="text-xs text-red-700/80 dark:text-red-400/80 mt-0.5">
            The Merkle root computed in your browser does not match the ledger root
            returned by Horizon. The translated event data may have been altered by
            the backend. Do not trust this event.
          </p>
        </div>
      </div>
      <div className="space-y-2 rounded bg-red-100/60 dark:bg-red-900/30 px-3 py-2.5">
        <ProofRow label="Computed root (browser)" value={computedRoot} />
        <ProofRow label="Expected root (Horizon)" value={proof.ledgerRootHash} />
      </div>
      <MerklePathDetails proof={proof} />
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 flex items-start gap-2">
      <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          Could not fetch inclusion proof
        </p>
        <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
          {message}
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface InclusionProofPanelProps {
  txHash: string;
  ledger: number;
}

export function InclusionProofPanel({
  txHash,
  ledger,
}: InclusionProofPanelProps): React.JSX.Element {
  const { network } = useNetwork();
  const { status, proof, computedRoot, errorMessage, verify } =
    useInclusionProof(txHash, ledger, network);

  // Horizon explorer URL for the transaction
  const explorerBase =
    network === "mainnet"
      ? "https://stellar.expert/explorer/public/tx"
      : "https://stellar.expert/explorer/testnet/tx";
  const explorerUrl = txHash ? `${explorerBase}/${txHash}` : "#";

  return (
    <div className="space-y-3 pt-4 border-t">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            On-chain Inclusion Proof
          </p>
        </div>
        {txHash && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Stellar Expert
          </a>
        )}
      </div>

      {/* Description */}
      {status === "idle" && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Cryptographically verify that this event&apos;s transaction is included in
          the Stellar ledger. The Merkle proof is walked entirely in your browser
          using WebCrypto — Open-Audit&apos;s backend cannot forge a valid proof.
        </p>
      )}

      {/* State: idle */}
      {status === "idle" && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-950"
          onClick={verify}
          id="verify-inclusion-proof-btn"
          aria-label="Verify on-chain Merkle inclusion proof for this transaction"
        >
          <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
          Verify on-chain inclusion
        </Button>
      )}

      {/* State: loading */}
      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Fetching Merkle proof and verifying in browser…</span>
        </div>
      )}

      {/* State: verified */}
      {status === "verified" && proof && computedRoot && (
        <VerifiedPanel proof={proof} computedRoot={computedRoot} />
      )}

      {/* State: invalid */}
      {status === "invalid" && proof && computedRoot && (
        <InvalidPanel proof={proof} computedRoot={computedRoot} />
      )}

      {/* State: error */}
      {status === "error" && errorMessage && (
        <ErrorPanel message={errorMessage} />
      )}

      {/* Re-verify button (after first attempt) */}
      {(status === "verified" || status === "invalid" || status === "error") && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={verify}
          aria-label="Re-run the inclusion proof verification"
        >
          Re-verify
        </Button>
      )}
    </div>
  );
}
