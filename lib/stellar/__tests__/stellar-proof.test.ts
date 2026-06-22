/**
 * Unit tests for the Stellar Merkle inclusion proof builder.
 *
 * Tests the core tree-building and path-extraction logic with a known
 * 4-transaction set whose expected root can be hand-verified.
 *
 * Node.js crypto is used for the expected values (same algorithm as the module).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ─── Helpers mirroring the module's internal logic ────────────────────────────

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

function sha256(buf: Buffer): Buffer {
  return crypto.createHash("sha256").update(buf).digest();
}

function sha256Pair(left: Buffer, right: Buffer): Buffer {
  return crypto.createHash("sha256").update(left).update(right).digest();
}

function buildExpectedRoot(sortedHashes: string[]): string {
  let level = sortedHashes.map((h) => sha256(hexToBuffer(h)));

  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(sha256Pair(left, right));
    }
    level = next;
  }

  return level[0].toString("hex");
}

// ─── Mock setup ───────────────────────────────────────────────────────────────

// Known 4-transaction set (realistic-looking 64-char hex hashes)
const TX_HASHES = [
  "aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233",
  "11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd",
  "deadbeefcafebabe deadbeefcafebabe".replace(/ /g, "").padEnd(64, "0"),
  "f0f1f2f3f4f5f6f7f0f1f2f3f4f5f6f7f0f1f2f3f4f5f6f7f0f1f2f3f4f5f6",
];

// The module sorts hashes ascending before building the tree
const SORTED = [...TX_HASHES].sort();
const EXPECTED_ROOT = buildExpectedRoot(SORTED);

// Simulate the Horizon API responses
function makeLedgerResp(txCount: number) {
  return {
    ok: true,
    json: async () => ({
      sequence: 52341001,
      tx_set_hash: EXPECTED_ROOT,
      transaction_count: txCount,
    }),
  };
}

function makeTxsResp(hashes: string[]) {
  return {
    ok: true,
    json: async () => ({
      _embedded: { records: hashes.map((hash) => ({ hash })) },
      _links: {},
    }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fetchInclusionProof", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a valid 4-tx inclusion proof whose root matches the ledger hash", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeLedgerResp(4) as unknown as Response)
      .mockResolvedValueOnce(makeTxsResp(TX_HASHES) as unknown as Response);

    const { fetchInclusionProof } = await import("@/lib/stellar/stellar-proof");

    const targetTx = TX_HASHES[2];
    const proof = await fetchInclusionProof(targetTx, 52341001, "testnet");

    expect(proof.txHash).toBe(targetTx.toLowerCase());
    expect(proof.ledgerSequence).toBe(52341001);
    expect(proof.merklePath.length).toBeGreaterThan(0);
    expect(proof.ledgerRootHash).toBe(EXPECTED_ROOT);

    // Manually walk the proof to confirm it's correct
    let current = sha256(hexToBuffer(targetTx));
    for (const node of proof.merklePath) {
      const sibling = hexToBuffer(node.siblingHash);
      current =
        node.position === "left"
          ? sha256Pair(sibling, current)
          : sha256Pair(current, sibling);
    }
    expect(current.toString("hex")).toBe(EXPECTED_ROOT);
  });

  it("returns an empty merklePath for a single-transaction ledger", async () => {
    const singleTx = TX_HASHES[0];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sequence: 99999999,
          tx_set_hash: sha256(hexToBuffer(singleTx)).toString("hex"),
          transaction_count: 1,
        }),
      } as unknown as Response)
      .mockResolvedValueOnce(makeTxsResp([singleTx]) as unknown as Response);

    const { fetchInclusionProof } = await import("@/lib/stellar/stellar-proof");
    const proof = await fetchInclusionProof(singleTx, 99999999, "testnet");

    expect(proof.merklePath).toHaveLength(0);
    expect(proof.txCount).toBe(1);
  });

  it("throws when the target txHash is not in the ledger", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeLedgerResp(4) as unknown as Response)
      .mockResolvedValueOnce(makeTxsResp(TX_HASHES) as unknown as Response);

    const { fetchInclusionProof } = await import("@/lib/stellar/stellar-proof");

    await expect(
      fetchInclusionProof("0".repeat(64), 52341001, "testnet")
    ).rejects.toThrow("not found in ledger");
  });

  it("throws when Horizon returns a non-OK status", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response);

    const { fetchInclusionProof } = await import("@/lib/stellar/stellar-proof");

    await expect(
      fetchInclusionProof(TX_HASHES[0], 52341001, "testnet")
    ).rejects.toThrow("404");
  });
});

describe("verifyInclusionProofSync", () => {
  it("returns true for a correct proof", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeLedgerResp(4) as unknown as Response)
      .mockResolvedValueOnce(makeTxsResp(TX_HASHES) as unknown as Response);

    const { fetchInclusionProof, verifyInclusionProofSync } = await import(
      "@/lib/stellar/stellar-proof"
    );

    const proof = await fetchInclusionProof(TX_HASHES[1], 52341001, "testnet");
    expect(verifyInclusionProofSync(proof)).toBe(true);
  });

  it("returns false when the ledgerRootHash is tampered with", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeLedgerResp(4) as unknown as Response)
      .mockResolvedValueOnce(makeTxsResp(TX_HASHES) as unknown as Response);

    const { fetchInclusionProof, verifyInclusionProofSync } = await import(
      "@/lib/stellar/stellar-proof"
    );

    const proof = await fetchInclusionProof(TX_HASHES[0], 52341001, "testnet");
    const tampered = { ...proof, ledgerRootHash: "dead".repeat(16) };
    expect(verifyInclusionProofSync(tampered)).toBe(false);
  });
});
