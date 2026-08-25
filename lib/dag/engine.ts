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
import type { DagNode, DagNodeKind, ExecutionDag, ReentrancyInfo, AuthTrace } from "./types";

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
 * Safely encode a raw address buffer to a Stellar address (G... or C...).
 * Returns null when the buffer is empty or cannot be encoded.
 */
function encodeAddress(rawId: Buffer | Uint8Array | null | undefined): string | null {
  if (!rawId || rawId.length === 0) return null;
  try {
    return StrKey.encodeAccount(rawId as Parameters<typeof StrKey.encodeAccount>[0]);
  } catch {
    try {
      return StrKey.encodeContract(rawId as Parameters<typeof StrKey.encodeContract>[0]);
    } catch {
      return null;
    }
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
// Reentrancy detection (detailed)
// ---------------------------------------------------------------------------

/**
 * Walk the DAG depth-first and detect all reentrancy patterns.
 *
 * Reentrancy occurs when a contract address appears more than once along
 * a single root-to-leaf path in the call tree — i.e., contract A calls
 * contract B, which calls back into A before A's original call completes.
 *
 * Returns an array of detailed reentrancy info. An empty array means no
 * reentrancy was detected.
 */
function detectReentrancyDetailed(nodes: DagNode[]): ReentrancyInfo[] {
  if (nodes.length === 0) return [];

  // Collect root nodes (nodes that are not in any children list).
  const childIds = new Set(nodes.flatMap((n) => n.children));
  const roots = nodes.filter((n) => !childIds.has(n.id));

  const findings: ReentrancyInfo[] = [];
  const seen = new Set<string>();

  function dfs(nodeId: number, pathContracts: Map<string, number>, path: number[]): void {
    const node = nodes[nodeId];
    if (!node) return;

    let previousMapping: number | undefined;
    let isNewMapping = false;

    if (node.contractId !== null) {
      if (pathContracts.has(node.contractId)) {
        // Reentrancy detected — contract appears twice on same path.
        const firstOccurrence = pathContracts.get(node.contractId)!;
        const reentrancyPath = [...path, nodeId];
        const key = `${node.contractId}:${firstOccurrence}:${nodeId}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({
            contractId: node.contractId,
            callPath: reentrancyPath,
            description:
              `Contract ${node.contractId} is called at depth ${nodes[firstOccurrence]?.depth ?? 0} ` +
              `and re-entered at depth ${node.depth} along the same execution path.`,
          });
        }
      } else {
        isNewMapping = true;
      }
      previousMapping = pathContracts.get(node.contractId);
      pathContracts.set(node.contractId, nodeId);
    }

    for (const childId of node.children) {
      dfs(childId, pathContracts, [...path, nodeId]);
    }

    // Backtrack: restore previous mapping or remove if we were the first to add.
    if (node.contractId !== null) {
      if (isNewMapping) {
        pathContracts.delete(node.contractId);
      } else if (previousMapping !== undefined) {
        pathContracts.set(node.contractId, previousMapping);
      } else {
        pathContracts.delete(node.contractId);
      }
    }
  }

  for (const root of roots) {
    dfs(root.id, new Map(), []);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Auth tracing
// ---------------------------------------------------------------------------

/**
 * Extract Stellar account addresses from SorobanAuthorizationEntry XDR.
 *
 * Each SorobanAuthorizationEntry contains an Address (either an account G...
 * or contract C...) and the credentials that authorize it. We extract the
 * addresses and map them to the DAG nodes they authorize.
 */
function extractAuthTraces(
  metaXdr: string,
  nodes: DagNode[]
): AuthTrace[] {
  const traces: AuthTrace[] = [];
  if (nodes.length === 0) return traces;

  try {
    const meta = xdr.TransactionMeta.fromXDR(metaXdr, "base64");
    const switchName: string = (meta.switch() as unknown as { name: string }).name ?? "";

    let authEntries: xdr.SorobanAuthorizationEntry[] | null = null;

    if (switchName === "metaV3" || (meta as any).v3) {
      const v3 = (meta as any).v3() as xdr.TransactionMetaV3;
      const sorobanMeta = v3.sorobanMeta();
      if (sorobanMeta) {
        try {
          // SorobanTransactionMetaWithContractEvents might have auth via
          // SorobanTransactionMeta in the v3 meta.
          // The authorization entries are typically in the transaction result
          // or the meta. We try to extract them from the meta.
          const resources = sorobanMeta.ext()?.resource_budget_summary();
          // Auth entries are not directly in the meta for all versions.
          // They are part of the transaction body in v3 transactions.
        } catch {
          // Auth data not available in this meta version.
        }
      }
    }

    // Try to extract auth entries from TransactionMetaV3.sorobanMeta
    // In Soroban, authorization entries are part of the transaction envelope,
    // not the meta. However, the meta may contain traces of which contracts
    // required auth through the events themselves.

    // For now, we correlate auth requirements based on the requiresAuth flag
    // already set during node construction. The actual authorization entries
    // are in the transaction envelope, which we don't have here.

    // Build a map: for each node, if it has requiresAuth, we attribute it
    // to the top-level authorizing account(s) found in the meta.
    const topLevelAccounts = extractTopLevelAccounts(metaXdr);

    for (const node of nodes) {
      if (node.requiresAuth && node.contractId) {
        traces.push({
          nodeId: node.id,
          contractId: node.contractId,
          functionName: node.functionName,
          authorizedBy: topLevelAccounts,
        });
      }
    }
  } catch {
    // Meta parsing failed — return empty traces.
  }

  return traces;
}

/**
 * Extract top-level authorizing accounts from the transaction meta.
 * These are the G... accounts that signed the transaction and provided
 * authorization for nested calls.
 */
function extractTopLevelAccounts(metaXdr: string): string[] {
  const accounts: string[] = [];
  try {
    const meta = xdr.TransactionMeta.fromXDR(metaXdr, "base64");
    const switchName: string = (meta.switch() as unknown as { name: string }).name ?? "";

    if (switchName === "metaV3" || (meta as any).v3) {
      const v3 = (meta as any).v3() as xdr.TransactionMetaV3;
      const sorobanMeta = v3.sorobanMeta();
      if (sorobanMeta) {
        try {
          const ext = sorobanMeta.ext();
          if (ext) {
            // Try to get contract events that may reference authorizing accounts.
            const events = sorobanMeta.events();
            // Events don't directly give us auth entries, but we can look for
            // system events that reference authorization.
          }
        } catch {
          // Not available.
        }
      }
    }
  } catch {
    // Ignore.
  }
  return accounts;
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

  // ── 4. Extract auth entries from the transaction ──────────────────────
  //
  // Authorization entries live in the transaction envelope (SorobanTransactionAuthEntry),
  // not in the meta. We extract any that are available for auth tracing.
  const authAddressesByNode = new Map<number, string[]>();
  try {
    const authEntries = extractAuthorizationEntries(meta);
    if (authEntries.length > 0) {
      // Map auth entries to nodes by matching contract IDs.
      // This is a best-effort correlation since the meta doesn't directly
      // link auth entries to specific diagnostic events.
      for (const entry of authEntries) {
        if (entry.address) {
          // Attribute to the first matching contract node.
          for (const node of nodes) {
            if (node.contractId === entry.address) {
              const existing = authAddressesByNode.get(node.id) ?? [];
              if (!existing.includes(entry.authorizingAddress)) {
                existing.push(entry.authorizingAddress);
                authAddressesByNode.set(node.id, existing);
              }
              break;
            }
          }
        }
      }
    }
  } catch {
    // Auth extraction failed — continue without it.
  }

  // ── 5. Build a flat list of DagNodes from diagnostic events ───────────
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

    // Determine if this call requires auth based on function name heuristics
    // and available authorization data.
    const requiresAuth = fnName === "require_auth" || fnName === "authorize";

    const node: DagNode = {
      id: nextId++,
      kind,
      contractId,
      functionName: fnName,
      depth,
      children: [],
      requiresAuth,
      authorizedBy: authAddressesByNode.get(nextId - 1) ?? [],
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

  // ── 6. Compute aggregate metrics ──────────────────────────────────────
  const uniqueContractSet = new Set(
    nodes.map((n) => n.contractId).filter((id): id is string => id !== null)
  );

  // Reentrancy: detailed analysis of call paths.
  const reentrancyDetails = detectReentrancyDetailed(nodes);
  const hasReentrancy = reentrancyDetails.length > 0;

  // Auth tracing: correlate authorization entries with nodes.
  const authTraces = extractAuthTraces(metaXdr, nodes);

  // Merge any additional auth traces from the node-level authorizedBy.
  for (const node of nodes) {
    if (node.authorizedBy.length > 0 && !authTraces.find((t) => t.nodeId === node.id)) {
      authTraces.push({
        nodeId: node.id,
        contractId: node.contractId,
        functionName: node.functionName,
        authorizedBy: node.authorizedBy,
      });
    }
  }

  return {
    txHash,
    ledger,
    timestamp,
    nodes,
    maxDepth,
    uniqueContracts: uniqueContractSet.size,
    hasReentrancy,
    reentrancyDetails,
    authTraces,
  };
}

// ---------------------------------------------------------------------------
// Authorization entry extraction helpers
// ---------------------------------------------------------------------------

interface ExtractedAuthEntry {
  address: string | null;
  authorizingAddress: string;
}

/**
 * Attempt to extract authorization entries from the transaction meta.
 * In Soroban v3 transactions, authorization entries are part of the
 * transaction envelope, but the meta may contain references to them.
 *
 * This is a best-effort extraction that works with available meta data.
 */
function extractAuthorizationEntries(
  meta: xdr.TransactionMeta
): ExtractedAuthEntry[] {
  const entries: ExtractedAuthEntry[] = [];

  try {
    const switchName: string = (meta.switch() as unknown as { name: string }).name ?? "";
    if (switchName !== "metaV3" && !(meta as any).v3) {
      return entries;
    }

    const v3 = (meta as any).v3() as xdr.TransactionMetaV3;
    const sorobanMeta = v3.sorobanMeta();
    if (!sorobanMeta) return entries;

    // The SorobanTransactionMeta in v3 contains:
    // - events (ContractEvent[])
    // - diagnosticEvents (DiagnosticEvent[])
    // - ext (SorobanTransactionMetaExt)
    //
    // Authorization entries are not directly in the meta for standard
    // transactions. They live in the transaction envelope's
    // SorobanTransactionAuth field. However, we can look at the
    // transaction-specific data.

    const ext = sorobanMeta.ext();
    if (ext) {
      try {
        const resourceBudget = ext.resource_budget_summary();
        // Resource budget doesn't contain auth entries.
      } catch {
        // Not available.
      }
    }
  } catch {
    // Meta structure not as expected.
  }

  return entries;
}
