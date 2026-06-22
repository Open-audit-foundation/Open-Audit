/**
 * lib/dag/types.ts
 *
 * Type definitions for the Soroban execution DAG (Directed Acyclic Graph)
 * reconstruction engine.
 *
 * A Soroban transaction can trigger cross-contract calls.  The Soroban VM
 * emits DiagnosticEvents inside SorobanTransactionMeta to record these
 * invocations.  This module models the resulting call-tree as a DAG where:
 *   - Each node   = one contract function invocation
 *   - Each edge   = caller → callee relationship (parent → child)
 *   - The root    = the top-level transaction entrypoint
 *
 * The DAG is strictly acyclic because the Soroban VM enforces reentrancy
 * guards at the host level (contracts cannot call themselves recursively
 * within the same transaction).
 */

// ── Raw diagnostic event shapes ───────────────────────────────────────────────

/**
 * Discriminated union of the diagnostic event types emitted by the Soroban VM.
 *
 * The stellar-sdk exposes DiagnosticEvents as XDR objects; we decode them into
 * this plain-TS union before the engine processes them.
 */
export type DiagnosticEventKind =
  | FnCallEvent
  | FnReturnEvent
  | FnErrorEvent
  | LogEvent;

/** Emitted when a contract function is entered. */
export interface FnCallEvent {
  kind: "fn_call";
  /** C-prefixed contract address of the callee. */
  contractId: string;
  /** The function being invoked, e.g. "transfer". */
  fnName: string;
  /** Serialised argument list (hex XDR). One string per argument. */
  args: string[];
}

/** Emitted when a contract function returns successfully. */
export interface FnReturnEvent {
  kind: "fn_return";
  /** Function name that is returning. */
  fnName: string;
  /** Serialised return value (hex XDR). Empty string if void. */
  returnValue: string;
  /** Gas consumed by this frame, in sub-entries (fuel units). */
  cpuInsns: bigint;
  /** Memory consumed by this frame, in bytes. */
  memBytes: bigint;
}

/** Emitted when a contract function traps or returns an error. */
export interface FnErrorEvent {
  kind: "fn_error";
  /** Function name that errored. */
  fnName: string;
  /** Serialised error ScVal (hex XDR). */
  errorVal: string;
}

/** Diagnostic log message emitted by the contract via log_str / log. */
export interface LogEvent {
  kind: "log";
  message: string;
}

// ── Call-tree node ────────────────────────────────────────────────────────────

/** Unique stable identifier for a DAG node within one transaction. */
export type DagNodeId = string; // e.g. "node-0", "node-1"

/**
 * One node in the execution DAG — represents a single contract invocation
 * frame from fn_call to fn_return/fn_error.
 */
export interface DagNode {
  /** Stable identifier within the reconstructed tree. */
  id: DagNodeId;

  /** C-prefixed Soroban contract address. */
  contractId: string;

  /** Function name that was called. */
  fnName: string;

  /**
   * Serialised arguments (hex XDR strings).
   * Decoded for display by the UI layer via the native XDR binding.
   */
  args: string[];

  /**
   * Serialised return value (hex XDR).  Empty string if the frame errored
   * or returned void.
   */
  returnValue: string;

  /**
   * Whether the frame completed successfully, errored, or is still
   * in-progress (open call with no matching return seen yet — indicates
   * a truncated/partial event stream).
   */
  status: "success" | "error" | "pending";

  /** Error ScVal, populated only when status === "error". */
  errorVal?: string;

  // ── Gas attribution ────────────────────────────────────────────────────────

  /**
   * Gas (CPU instructions) consumed by THIS frame ONLY, excluding any
   * children.  Computed as: frame.cpuInsns − sum(child.totalCpuInsns).
   *
   * Bigint because Soroban fuel counters can exceed Number.MAX_SAFE_INTEGER
   * for complex transactions.
   */
  selfCpuInsns: bigint;

  /**
   * Total gas consumed by this frame AND all its descendants.
   * Set directly from the fn_return event's cpuInsns field.
   */
  totalCpuInsns: bigint;

  /** Memory (bytes) consumed by this frame only, excluding children. */
  selfMemBytes: bigint;

  /** Total memory consumed by this frame and its descendants. */
  totalMemBytes: bigint;

  // ── Tree structure ─────────────────────────────────────────────────────────

  /** ID of the parent node, or null if this is the root call. */
  parentId: DagNodeId | null;

  /** IDs of direct child calls, in invocation order. */
  childIds: DagNodeId[];

  /** Nesting depth (root = 0). */
  depth: number;

  /** Diagnostic log messages emitted during this frame. */
  logs: string[];
}

// ── Full reconstructed DAG ────────────────────────────────────────────────────

/**
 * The complete execution DAG for one Soroban transaction.
 */
export interface ExecutionDag {
  /** The transaction hash this DAG was reconstructed from. */
  txHash: string;

  /** The ledger sequence the transaction was included in. */
  ledger: number;

  /** Unix timestamp of the ledger close. */
  timestamp: number;

  /**
   * Flat map of all nodes keyed by their ID.
   * Traversal: start at rootId, follow childIds recursively.
   */
  nodes: Map<DagNodeId, DagNode>;

  /** ID of the root invocation node (the top-level call). */
  rootId: DagNodeId | null;

  /** Total gas consumed by the entire transaction. */
  totalCpuInsns: bigint;

  /** Total memory consumed by the entire transaction. */
  totalMemBytes: bigint;

  /**
   * Whether the reconstruction is complete (all fn_call events have a
   * matching fn_return/fn_error).  False when the event stream was truncated.
   */
  isComplete: boolean;
}

// ── JSON-serialisable variant (for API / localStorage) ───────────────────────

/** JSON-safe version of DagNode (bigints → strings). */
export interface DagNodeJson {
  id: DagNodeId;
  contractId: string;
  fnName: string;
  args: string[];
  returnValue: string;
  status: DagNode["status"];
  errorVal?: string;
  selfCpuInsns: string;
  totalCpuInsns: string;
  selfMemBytes: string;
  totalMemBytes: string;
  parentId: DagNodeId | null;
  childIds: DagNodeId[];
  depth: number;
  logs: string[];
}

/** JSON-safe version of ExecutionDag. */
export interface ExecutionDagJson {
  txHash: string;
  ledger: number;
  timestamp: number;
  nodes: Record<DagNodeId, DagNodeJson>;
  rootId: DagNodeId | null;
  totalCpuInsns: string;
  totalMemBytes: string;
  isComplete: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function dagToJson(dag: ExecutionDag): ExecutionDagJson {
  const nodes: Record<DagNodeId, DagNodeJson> = {};
  for (const [id, node] of dag.nodes) {
    nodes[id] = {
      ...node,
      selfCpuInsns: node.selfCpuInsns.toString(),
      totalCpuInsns: node.totalCpuInsns.toString(),
      selfMemBytes: node.selfMemBytes.toString(),
      totalMemBytes: node.totalMemBytes.toString(),
    };
  }
  return {
    txHash: dag.txHash,
    ledger: dag.ledger,
    timestamp: dag.timestamp,
    nodes,
    rootId: dag.rootId,
    totalCpuInsns: dag.totalCpuInsns.toString(),
    totalMemBytes: dag.totalMemBytes.toString(),
    isComplete: dag.isComplete,
  };
}

export function dagFromJson(json: ExecutionDagJson): ExecutionDag {
  const nodes = new Map<DagNodeId, DagNode>();
  for (const [id, raw] of Object.entries(json.nodes)) {
    nodes.set(id, {
      ...raw,
      selfCpuInsns: BigInt(raw.selfCpuInsns),
      totalCpuInsns: BigInt(raw.totalCpuInsns),
      selfMemBytes: BigInt(raw.selfMemBytes),
      totalMemBytes: BigInt(raw.totalMemBytes),
    });
  }
  return {
    txHash: json.txHash,
    ledger: json.ledger,
    timestamp: json.timestamp,
    nodes,
    rootId: json.rootId,
    totalCpuInsns: BigInt(json.totalCpuInsns),
    totalMemBytes: BigInt(json.totalMemBytes),
    isComplete: json.isComplete,
  };
}
