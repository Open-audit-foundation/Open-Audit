/**
 * Unit tests for useInclusionProof hook.
 *
 * Mocks fetch and window.crypto.subtle.digest to verify that the hook:
 *  - Returns "verified" when the computed root matches the ledger root
 *  - Returns "invalid" when they diverge
 *  - Returns "error" on API failure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import crypto from "crypto";

// ─── WebCrypto shim ───────────────────────────────────────────────────────────
// jsdom doesn't ship WebCrypto — delegate to Node.js crypto

function nodeSubtleDigest(_algo: string, data: ArrayBuffer): Promise<ArrayBuffer> {
  const buf = Buffer.from(data);
  const hash = crypto.createHash("sha256").update(buf).digest();
  return Promise.resolve(hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const result = await nodeSubtleDigest("SHA-256", data.buffer);
  return new Uint8Array(result);
}

async function buildExpectedRoot(txHash: string, merklePath: Array<{ siblingHash: string; position: "left" | "right" }>): Promise<string> {
  let current = await sha256(hexToBytes(txHash));
  for (const node of merklePath) {
    const sibling = hexToBytes(node.siblingHash);
    const pair =
      node.position === "left"
        ? new Uint8Array([...sibling, ...current])
        : new Uint8Array([...current, ...sibling]);
    current = await sha256(pair);
  }
  return bytesToHex(current);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FAKE_TX_HASH = "ab".repeat(32); // 64 hex chars
const FAKE_SIBLING = "cd".repeat(32);

// Build the correct root for the fixture proof
async function makeValidProof() {
  const merklePath = [{ siblingHash: FAKE_SIBLING, position: "right" as const }];
  const ledgerRootHash = await buildExpectedRoot(FAKE_TX_HASH, merklePath);
  return {
    ledgerSequence: 52341001,
    ledgerRootHash,
    txHash: FAKE_TX_HASH,
    merklePath,
    fetchedAt: new Date().toISOString(),
    txCount: 2,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useInclusionProof", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Inject WebCrypto shim
    Object.defineProperty(globalThis, "window", {
      value: {
        crypto: { subtle: { digest: nodeSubtleDigest } },
      },
      configurable: true,
      writable: true,
    });
  });

  it("returns 'verified' when computed root matches ledger root hash", async () => {
    const proof = await makeValidProof();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ proof }),
    } as unknown as Response);

    const { useInclusionProof } = await import("@/lib/hooks/useInclusionProof");
    const { result } = renderHook(() =>
      useInclusionProof(FAKE_TX_HASH, 52341001, "testnet")
    );

    expect(result.current.status).toBe("idle");

    await act(async () => {
      await result.current.verify();
    });

    expect(result.current.status).toBe("verified");
    expect(result.current.computedRoot).toBe(proof.ledgerRootHash);
    expect(result.current.proof?.txHash).toBe(FAKE_TX_HASH);
  });

  it("returns 'invalid' when ledgerRootHash has been tampered with", async () => {
    const proof = await makeValidProof();
    const tampered = { ...proof, ledgerRootHash: "dead".repeat(16) };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ proof: tampered }),
    } as unknown as Response);

    const { useInclusionProof } = await import("@/lib/hooks/useInclusionProof");
    const { result } = renderHook(() =>
      useInclusionProof(FAKE_TX_HASH, 52341001, "testnet")
    );

    await act(async () => {
      await result.current.verify();
    });

    expect(result.current.status).toBe("invalid");
    expect(result.current.computedRoot).not.toBe(tampered.ledgerRootHash);
  });

  it("returns 'error' when the API returns a non-OK response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Transaction not found in ledger 52341001." }),
    } as unknown as Response);

    const { useInclusionProof } = await import("@/lib/hooks/useInclusionProof");
    const { result } = renderHook(() =>
      useInclusionProof(FAKE_TX_HASH, 52341001, "testnet")
    );

    await act(async () => {
      await result.current.verify();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/not found/i);
  });

  it("returns 'error' when fetch itself throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

    const { useInclusionProof } = await import("@/lib/hooks/useInclusionProof");
    const { result } = renderHook(() =>
      useInclusionProof(FAKE_TX_HASH, 52341001, "testnet")
    );

    await act(async () => {
      await result.current.verify();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/Network failure/);
  });

  it("starts in 'idle' state before verify is called", async () => {
    const { useInclusionProof } = await import("@/lib/hooks/useInclusionProof");
    const { result } = renderHook(() =>
      useInclusionProof(FAKE_TX_HASH, 52341001, "testnet")
    );

    expect(result.current.status).toBe("idle");
    expect(result.current.proof).toBeNull();
    expect(result.current.computedRoot).toBeNull();
  });
});
