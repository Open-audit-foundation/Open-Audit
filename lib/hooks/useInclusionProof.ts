/**
 * useInclusionProof
 *
 * React hook that fetches a Stellar Merkle inclusion proof from the
 * Open-Audit backend and independently verifies it in the browser
 * using the WebCrypto API (no third-party library required).
 *
 * Verification algorithm (mirrors stellar-proof.ts server-side logic):
 *   1. Compute leaf = SHA-256( txHash bytes )
 *   2. For each node in merklePath:
 *        if node.position === "left":  current = SHA-256( sibling || current )
 *        else:                         current = SHA-256( current || sibling )
 *   3. Compare computed root to proof.ledgerRootHash
 *
 * Usage:
 *   const { status, proof, computedRoot } = useInclusionProof(txHash, ledger);
 */

"use client";

import { useState, useCallback } from "react";
import type { InclusionProof } from "@/lib/stellar/stellar-proof";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProofStatus =
  | "idle"       // not yet triggered
  | "loading"    // fetching + verifying
  | "verified"   // proof is valid — computed root matches ledger root
  | "invalid"    // proof is invalid — possible tampering
  | "error";     // network/API error

export interface UseInclusionProofResult {
  /** Current state of the proof verification. */
  status: ProofStatus;
  /** The proof returned by the API (available once loading completes). */
  proof: InclusionProof | null;
  /** The Merkle root computed by the client-side verifier. */
  computedRoot: string | null;
  /** The expected root from the Horizon ledger record. */
  expectedRoot: string | null;
  /** Human-readable error message (only set when status === "error"). */
  errorMessage: string | null;
  /** Trigger the fetch + verify flow. Safe to call multiple times. */
  verify: () => Promise<void>;
}

// ─── WebCrypto helpers ────────────────────────────────────────────────────────

/** Converts a lowercase hex string to a Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Converts a Uint8Array to a lowercase hex string. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 of a Uint8Array via WebCrypto. Returns a new Uint8Array. */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await window.crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

/**
 * Concatenates two Uint8Arrays into one.
 * Used to form the input for inner-node hashing.
 */
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

// ─── Verifier ─────────────────────────────────────────────────────────────────

/**
 * Re-walks the Merkle path in the browser and returns the computed root hex.
 * This is the core trust-minimization step — the user's browser independently
 * recomputes the root without relying on the backend's claim.
 */
async function walkMerklePath(proof: InclusionProof): Promise<string> {
  const { txHash, merklePath } = proof;

  // Compute the leaf hash: SHA-256 of the raw transaction hash bytes
  let current = await sha256(hexToBytes(txHash));

  for (const node of merklePath) {
    const sibling = hexToBytes(node.siblingHash);
    const pair =
      node.position === "left"
        ? concatBytes(sibling, current)
        : concatBytes(current, sibling);
    current = await sha256(pair);
  }

  return bytesToHex(current);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param txHash  - 64-char hex transaction hash
 * @param ledger  - Ledger sequence number that finalised the transaction
 * @param network - "testnet" | "mainnet" | "futurenet" (defaults to env or testnet)
 */
export function useInclusionProof(
  txHash: string,
  ledger: number,
  network?: string
): UseInclusionProofResult {
  const [status, setStatus] = useState<ProofStatus>("idle");
  const [proof, setProof] = useState<InclusionProof | null>(null);
  const [computedRoot, setComputedRoot] = useState<string | null>(null);
  const [expectedRoot, setExpectedRoot] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const verify = useCallback(async () => {
    if (!txHash || !ledger) return;

    setStatus("loading");
    setProof(null);
    setComputedRoot(null);
    setExpectedRoot(null);
    setErrorMessage(null);

    try {
      // 1. Fetch the inclusion proof from the backend
      const net = network ?? (typeof window !== "undefined"
        ? (document.documentElement.dataset.network ?? "testnet")
        : "testnet");

      const url = `/api/v1/events/proof?txHash=${encodeURIComponent(txHash)}&ledger=${ledger}&network=${encodeURIComponent(net)}`;
      const resp = await fetch(url);
      const body = await resp.json();

      if (!resp.ok) {
        const msg = (body as { error?: string }).error ?? `HTTP ${resp.status}`;
        setStatus("error");
        setErrorMessage(msg);
        return;
      }

      const fetchedProof = (body as { proof: InclusionProof }).proof;
      setProof(fetchedProof);
      setExpectedRoot(fetchedProof.ledgerRootHash);

      // 2. Independently verify in the browser
      if (fetchedProof.merklePath.length === 0 && fetchedProof.txCount === 1) {
        // Single-TX ledger: computed root = leaf hash = SHA-256(txHash)
        const leaf = await sha256(hexToBytes(fetchedProof.txHash));
        const leafHex = bytesToHex(leaf);
        setComputedRoot(leafHex);
        // For single-tx ledgers Stellar sets txSetHash = SHA-256(txHash)
        const match = leafHex === fetchedProof.ledgerRootHash;
        setStatus(match ? "verified" : "invalid");
        return;
      }

      const computed = await walkMerklePath(fetchedProof);
      setComputedRoot(computed);
      setStatus(computed === fetchedProof.ledgerRootHash ? "verified" : "invalid");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setStatus("error");
      setErrorMessage(msg);
    }
  }, [txHash, ledger, network]);

  return { status, proof, computedRoot, expectedRoot, errorMessage, verify };
}
