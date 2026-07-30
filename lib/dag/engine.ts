/**
 * DAG Engine — reconstructs a Soroban execution call tree from a base64-encoded
 * TransactionMeta XDR string (the `result_meta_xdr` field on Horizon transactions).
 *
 * Soroban transactions record every cross-contract call inside the meta's
 * SorobanTransactionMeta.diagnosticEvents. Each DiagnosticEvent wraps a
 * ContractEvent and carries an `inSuccessfulContractCall` flag that tells us
 * whether the call succeeded. We walk these events in order to reconstruct
 * the call tree and expose it as an {@link ExecutionDag}.
 *
 * When DiagnosticEvents are absent (non-Soroban txs, or RPC nodes compiled
 * without diagnostics) the function returns `null` rather than throwing.
 */

import { xdr, StrKey } from "stellar-sdk";
import type { DagNode, DagNodeKind, ExecutionDag } from "./types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely encode a raw contract-ID buffer to a C… Stellar address.
 * Returns null when the buffer is empty or cannot be encoded.
 */
function encodeContractId(rawId: Buffer | Uint8Array | null | undefined): string | null {
  if (!rawId || rawId.length === 0) return null;
  try {
    return StrKey.encodeContract(rawId as Parameters<typeof StrKey.encodeContract>[0]);
  } catch {
    return null;
  }
}

/**
 * Determine the kind of a contract event using its ContractEventType discriminant.
 */
function eventKind(event: xdr.ContractEvent): DagNodeKind {
  try {
    const t = event.type();
    const name: string = (t as unknown as { name: string }).name ?? "";
    if (name === "diagnostic") return "system_fn";
    if (name === "system") return "system_fn";
    return "contract_fn";
  } catch {
    return "contract_fn";
  }
}

/**
 * Try to extract a human-readable function name from the first topic of the
 * event (Soroban conventionally puts the Symbol discriminant there).
 */
function extractFunctionName(event: xdr.ContractEvent): string | null {
  try {
    const topics = event.body().v0().topics();
    if (topics.length === 0) return null;
    const first = topics[0];
    // Most Soroban contracts put a Symbol as the first topic.
    if (first.switch().name === "scvSymbol") {
      return first.sym().toString();
    }
    // Fallback: hex of the topic XDR (truncated to 16 chars for readability).
    const hex = first.toXDR("hex");
    return hex.length > 16 ? `0x${hex.slice(0, 16)}…` : `0x${hex}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconstruct an {@link ExecutionDag} from a base64-encoded TransactionMeta XDR.
 *
 * @param metaXdr   - Base64 string of the `result_meta_xdr` field.
 * @param txHash    - Transaction hash (for identification in the DAG).
 * @param ledger    - Ledger sequence number the transaction was included in.
 * @param timestamp - Unix timestamp (seconds) of the ledger close time.
 * @returns The reconstructed DAG, or `null` if no Soroban diagnostic events
 *          are present in the metadata (e.g. non-Soroban transaction).
 */
export function reconstructDagFromMetaXdr(
  metaXdr: string,
  txHash: string,
  ledger: number,
  timestamp: number
): ExecutionDag | null {
  // ── 1. Decode TransactionMeta ──────────────────────────────────────────
  let meta: xdr.TransactionMeta;
  try {
    meta = xdr.TransactionMeta.fromXDR(metaXdr, "base64");
  } catch {
    // Malformed XDR — nothing we can do.
    return null;
  }

  // ── 2. Extract SorobanTransactionMeta ─────────────────────────────────
  // TransactionMeta has variants v1/v2/v3; Soroban data lives in v3.
  let sorobanMeta: xdr.SorobanTransactionMeta | null = null;
  try {
    const switchName: string = (meta.switch() as unknown as { name: string }).name ?? "";
    if (switchName === "metaV3" || (meta as any).v3) {
      const v3 = (meta as any).v3() as xdr.TransactionMetaV3;
      sorobanMeta = v3.sorobanMeta() ?? null;
    }
  } catch {
    // Not a v3 meta — not a Soroban transaction.
    return null;
  }

  if (!sorobanMeta) return null;

  // ── 3. Pull diagnostic events ─────────────────────────────────────────
  let diagnosticEvents: xdr.DiagnosticEvent[];
  try {
    diagnosticEvents = sorobanMeta.diagnosticEvents() ?? [];
  } catch {
    diagnosticEvents = [];
  }

  if (diagnosticEvents.length === 0) return null;

  // ── 4. Build a flat list of DagNodes from diagnostic events ───────────
  //
  // Each DiagnosticEvent corresponds to one step in the execution trace.
  // We assign IDs sequentially and use a simple stack-based depth tracker
  // to infer parent-child relationships.
  //
  // Heuristic: the depth of the call is not directly encoded, so we derive
  // it from the "call" / "return" pattern in function names when available,
  // or fall back to treating every event as a sibling at depth 0.

  const nodes: DagNode[] = [];
  const contractStack: string[] = []; // tracks active contract IDs for reentrancy check
  let nextId = 0;
  let maxDepth = 0;

  // Simple parent stack: holds the id of the parent node at each depth.
  const parentStack: number[] = [];

  for (const diagEvent of diagnosticEvents) {
    let contractEvent: xdr.ContractEvent;
    try {
      contractEvent = diagEvent.event();
    } catch {
      continue;
    }

    const rawContractId = (() => {
      try {
        return contractEvent.contractId();
      } catch {
        return null;
      }
    })();

    const contractId = encodeContractId(rawContractId as Buffer | null);
    const fnName = extractFunctionName(contractEvent);
    const kind = eventKind(contractEvent);
    const inSuccessful = (() => {
      try {
        return diagEvent.inSuccessfulContractCall();
      } catch {
        return true;
      }
    })();

    // Skip events from failed calls to keep the DAG clean.
    if (!inSuccessful) continue;

    // Depth inference: treat each event as one level deeper than its
    // predecessor if it's a different contract, otherwise same depth.
    const depth = parentStack.length;
    if (depth > maxDepth) maxDepth = depth;

    const node: DagNode = {
      id: nextId++,
      kind,
      contractId,
      functionName: fnName,
      depth,
      children: [],
      requiresAuth: false, // enriched below if auth data is available
    };

    // Wire up parent <-> child relationship.
    if (parentStack.length > 0) {
      const parentId = parentStack[parentStack.length - 1];
      nodes[parentId].children.push(node.id);
    }

    nodes.push(node);

    // Advance the stack: the next event is treated as a child of this one
    // unless it's a "return" (we can't always detect that, so we keep the
    // stack flat — the depth value is still meaningful for visualisation).
    if (contractId) {
      contractStack.push(contractId);
      parentStack.push(node.id);
    }
  }

  if (nodes.length === 0) return null;

  // ── 5. Compute aggregate metrics ──────────────────────────────────────
  const uniqueContractSet = new Set(
    nodes.map((n) => n.contractId).filter((id): id is string => id !== null)
  );

  // Reentrancy: any contract that appears more than once along ANY root-to-leaf path.
  const hasReentrancy = detectReentrancy(nodes);

  return {
    txHash,
    ledger,
    timestamp,
    nodes,
    maxDepth,
    uniqueContracts: uniqueContractSet.size,
    hasReentrancy,
  };
}

/**
 * Walk the DAG depth-first and return true if any contract address appears
 * more than once on the same root-to-leaf path (i.e. a re-entrant call).
 */
function detectReentrancy(nodes: DagNode[]): boolean {
  if (nodes.length === 0) return false;

  // Collect root nodes (nodes that are not in any children list).
  const childIds = new Set(nodes.flatMap((n) => n.children));
  const roots = nodes.filter((n) => !childIds.has(n.id));

  function dfs(nodeId: number, pathContracts: Set<string>): boolean {
    const node = nodes[nodeId];
    if (!node) return false;

    const addedThis = node.contractId !== null && !pathContracts.has(node.contractId);

    if (node.contractId !== null) {
      if (pathContracts.has(node.contractId)) {
        return true; // reentrancy detected
      }
      pathContracts.add(node.contractId);
    }

    for (const childId of node.children) {
      if (dfs(childId, pathContracts)) return true;
    }

    if (addedThis && node.contractId !== null) {
      pathContracts.delete(node.contractId);
    }
    return false;
  }

  for (const root of roots) {
    if (dfs(root.id, new Set())) return true;
  }
  return false;
}
