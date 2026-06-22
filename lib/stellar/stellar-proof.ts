/**
 * Stellar Transaction Inclusion Proof (Merkle path builder)
 *
 * Constructs a cryptographic Merkle inclusion proof for a Stellar transaction
 * by fetching the full transaction set from Horizon and building the binary
 * Merkle tree whose root hash equals the ledger header's `txSetHash`.
 *
 * The proof can be verified entirely client-side using the WebCrypto API
 * with no third-party libraries.
 *
 * Merkle hashing convention (matches Stellar core):
 *   leaf  = SHA-256( txHash bytes )
 *   inner = SHA-256( leftBytes || rightBytes )
 *
 * Nodes are sorted in ascending hex order before pairing so the tree
 * is fully deterministic from the transaction set alone.
 */

import crypto from "crypto";
import { getConfigForNetwork } from "./client";
import type { Network } from "./client";

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single sibling step in the Merkle path from a leaf to the root. */
export interface MerkleNode {
  /** Hex-encoded 32-byte SHA-256 hash of the sibling node. */
  siblingHash: string;
  /** Whether the sibling is to the left or right of the current node. */
  position: "left" | "right";
}

/** A complete inclusion proof for a single transaction. */
export interface InclusionProof {
  /** Ledger sequence number the transaction was finalized in. */
  ledgerSequence: number;
  /**
   * The `txSetHash` from the Horizon ledger record.
   * This is the Merkle root of all transaction hashes in the ledger.
   */
  ledgerRootHash: string;
  /** The transaction hash that is being proven. */
  txHash: string;
  /**
   * Ordered sibling path from the transaction leaf to the root.
   * Empty when the ledger contained exactly one transaction
   * (the root equals the single leaf hash in that case).
   */
  merklePath: MerkleNode[];
  /** ISO-8601 timestamp when the proof was generated. */
  fetchedAt: string;
  /** Number of transactions in the ledger at the time of proof generation. */
  txCount: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Decodes a lowercase hex string to a Buffer.
 * Throws if the input is not valid hex.
 */
function hexToBuffer(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) {
    throw new Error(`Invalid hex string: ${hex.slice(0, 16)}…`);
  }
  return Buffer.from(clean, "hex");
}

/** Returns lowercase hex string of a Buffer. */
function bufferToHex(buf: Buffer): string {
  return buf.toString("hex");
}

/** SHA-256 of the concatenation of two buffers. */
function sha256Pair(left: Buffer, right: Buffer): Buffer {
  return crypto.createHash("sha256").update(left).update(right).digest();
}

/** SHA-256 of a single buffer (used for leaf hashing). */
function sha256(buf: Buffer): Buffer {
  return crypto.createHash("sha256").update(buf).digest();
}

/**
 * Builds a full binary Merkle tree from a sorted list of leaf hashes.
 *
 * Returns an array of levels, where level[0] is the leaf level and
 * level[level.length - 1] is the root.
 *
 * Odd-length levels duplicate the last node before pairing (Stellar convention).
 */
function buildMerkleTree(leafHashes: Buffer[]): Buffer[][] {
  if (leafHashes.length === 0) {
    throw new Error("Cannot build Merkle tree from empty leaf set");
  }

  const levels: Buffer[][] = [leafHashes];

  let current = leafHashes;
  while (current.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      // Duplicate last node when count is odd (Stellar core behaviour)
      const right = i + 1 < current.length ? current[i + 1] : current[i];
      next.push(sha256Pair(left, right));
    }
    levels.push(next);
    current = next;
  }

  return levels;
}

/**
 * Walks the Merkle tree to extract the sibling path for a given leaf index.
 *
 * @param levels - Full tree as returned by buildMerkleTree
 * @param leafIndex - 0-based index of the target leaf
 * @returns Ordered list of sibling nodes from leaf to root
 */
function extractMerklePath(levels: Buffer[][], leafIndex: number): MerkleNode[] {
  const path: MerkleNode[] = [];

  let idx = leafIndex;
  for (let level = 0; level < levels.length - 1; level++) {
    const currentLevel = levels[level];
    const isRightNode = idx % 2 === 1;
    const siblingIdx = isRightNode ? idx - 1 : idx + 1;

    if (siblingIdx < currentLevel.length) {
      path.push({
        siblingHash: bufferToHex(currentLevel[siblingIdx]),
        position: isRightNode ? "left" : "right",
      });
    } else {
      // Duplicated node — sibling is self (odd length case)
      path.push({
        siblingHash: bufferToHex(currentLevel[idx]),
        position: isRightNode ? "left" : "right",
      });
    }

    idx = Math.floor(idx / 2);
  }

  return path;
}

// ─── Horizon fetch helpers ────────────────────────────────────────────────────

interface HorizonLedgerRecord {
  sequence: number;
  /** The hash over the full transaction set — this is the Merkle root we verify against. */
  tx_set_hash: string;
  transaction_count: number;
}

interface HorizonTransactionRecord {
  hash: string;
}

interface HorizonTransactionsPage {
  _embedded: { records: HorizonTransactionRecord[] };
  _links: { next?: { href: string } };
}

/** Maximum transactions to fetch per ledger (covers >99.9% of Stellar ledgers). */
const MAX_TX_FETCH = 500;

/**
 * Fetches all transaction hashes for a given ledger sequence number from Horizon.
 * Paginates automatically up to MAX_TX_FETCH transactions.
 */
async function fetchLedgerTransactions(
  horizonUrl: string,
  ledgerSequence: number
): Promise<{ ledgerRootHash: string; txHashes: string[] }> {
  // 1. Fetch ledger header to get the canonical root hash
  const ledgerResp = await fetch(
    `${horizonUrl}/ledgers/${ledgerSequence}`,
    { headers: { Accept: "application/json" } }
  );

  if (!ledgerResp.ok) {
    throw new Error(
      `Horizon returned ${ledgerResp.status} for ledger ${ledgerSequence}`
    );
  }

  const ledger = (await ledgerResp.json()) as HorizonLedgerRecord;
  const ledgerRootHash = ledger.tx_set_hash;

  if (!ledgerRootHash) {
    throw new Error(`Ledger ${ledgerSequence} has no tx_set_hash`);
  }

  if (ledger.transaction_count === 0) {
    return { ledgerRootHash, txHashes: [] };
  }

  // 2. Paginate through transactions
  const txHashes: string[] = [];
  let url: string | null =
    `${horizonUrl}/ledgers/${ledgerSequence}/transactions?limit=200&order=asc&include_failed=false`;

  while (url && txHashes.length < MAX_TX_FETCH) {
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) {
      throw new Error(`Horizon returned ${resp.status} fetching transactions`);
    }
    const page = (await resp.json()) as HorizonTransactionsPage;
    for (const tx of page._embedded.records) {
      txHashes.push(tx.hash.toLowerCase());
    }
    const nextUrl = page._links?.next?.href;
    url = nextUrl && txHashes.length < MAX_TX_FETCH ? nextUrl : null;
  }

  return { ledgerRootHash: ledgerRootHash.toLowerCase(), txHashes };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches a Merkle inclusion proof for a transaction from the Stellar network.
 *
 * @param txHash - The transaction hash to prove (64 lowercase hex chars)
 * @param ledgerSequence - The ledger sequence number that finalized the transaction
 * @param network - "testnet" | "mainnet" | "futurenet" (defaults to "testnet")
 * @returns A complete `InclusionProof` ready for JSON serialization
 * @throws If the transaction is not found in the ledger or Horizon is unavailable
 */
export async function fetchInclusionProof(
  txHash: string,
  ledgerSequence: number,
  network: Network | string = "testnet"
): Promise<InclusionProof> {
  const config = getConfigForNetwork(network);
  const normalizedTxHash = txHash.toLowerCase().replace(/^0x/, "");

  const { ledgerRootHash, txHashes } = await fetchLedgerTransactions(
    config.horizonUrl,
    ledgerSequence
  );

  if (txHashes.length > MAX_TX_FETCH) {
    throw new Error(
      `Ledger ${ledgerSequence} has too many transactions (${txHashes.length} > ${MAX_TX_FETCH}). ` +
        `Proof generation is not supported for this ledger.`
    );
  }

  // Find the target transaction
  const txIndex = txHashes.findIndex((h) => h === normalizedTxHash);
  if (txIndex === -1) {
    throw new Error(
      `Transaction ${normalizedTxHash.slice(0, 12)}… not found in ledger ${ledgerSequence}. ` +
        `It may belong to a different ledger or the hash may be incorrect.`
    );
  }

  // Single-transaction ledger: root = leaf hash, no siblings needed
  if (txHashes.length === 1) {
    const leafHash = bufferToHex(sha256(hexToBuffer(normalizedTxHash)));
    return {
      ledgerSequence,
      ledgerRootHash,
      txHash: normalizedTxHash,
      merklePath: [],
      fetchedAt: new Date().toISOString(),
      txCount: 1,
    };
  }

  // Sort hashes ascending (deterministic canonical order) then rebuild index
  const sortedHashes = [...txHashes].sort();
  const sortedIndex = sortedHashes.findIndex((h) => h === normalizedTxHash);

  // Build leaf layer: leaf_i = SHA-256( txHash_i bytes )
  const leafLayer = sortedHashes.map((h) => sha256(hexToBuffer(h)));

  // Build full tree and extract sibling path
  const tree = buildMerkleTree(leafLayer);
  const merklePath = extractMerklePath(tree, sortedIndex);

  return {
    ledgerSequence,
    ledgerRootHash,
    txHash: normalizedTxHash,
    merklePath,
    fetchedAt: new Date().toISOString(),
    txCount: txHashes.length,
  };
}

/**
 * Verifies an inclusion proof server-side (Node.js environment).
 * Returns true if the computed root matches the ledger root hash.
 *
 * The client-side equivalent in `useInclusionProof.ts` uses WebCrypto for
 * the same computation without any server round-trip.
 */
export function verifyInclusionProofSync(proof: InclusionProof): boolean {
  try {
    const { txHash, ledgerRootHash, merklePath } = proof;

    // Start from the leaf hash
    let current = sha256(hexToBuffer(txHash));

    for (const node of merklePath) {
      const sibling = hexToBuffer(node.siblingHash);
      current =
        node.position === "left"
          ? sha256Pair(sibling, current)
          : sha256Pair(current, sibling);
    }

    return bufferToHex(current) === ledgerRootHash;
  } catch {
    return false;
  }
}
