/**
 * Types for the Soroban execution DAG (Directed Acyclic Graph).
 *
 * A Soroban transaction can make nested cross-contract calls, forming a call
 * tree. These types represent that tree so it can be visualised in the UI and
 * used for analytics (reentrancy detection, auth tracing, etc.).
 */

/** The type of a node in the execution DAG. */
export type DagNodeKind =
  /** A regular contract function call. */
  | "contract_fn"
  /** A contract creation (deploy) call. */
  | "create_contract"
  /** A System function call (e.g. a host function). */
  | "system_fn";

/**
 * A single node in the execution DAG representing one contract call.
 */
export interface DagNode {
  /** Unique identifier within this DAG (zero-based depth-first index). */
  id: number;
  /** The kind of invocation this node represents. */
  kind: DagNodeKind;
  /**
   * The contract address being called (C… address).
   * Null for system/host functions that do not target a contract.
   */
  contractId: string | null;
  /**
   * The name of the function being called.
   * Null when the kind is not "contract_fn".
   */
  functionName: string | null;
  /** Depth from the root call (0 = root). */
  depth: number;
  /** IDs of direct children of this node (i.e. sub-calls made from here). */
  children: number[];
  /**
   * Whether this call required an explicit `require_auth` check.
   * Derived from the SorobanAuthorizationEntry tree.
   */
  requiresAuth: boolean;
}

/**
 * The complete execution DAG for a single Soroban transaction.
 */
export interface ExecutionDag {
  /** The transaction hash this DAG was built from. */
  txHash: string;
  /** The ledger sequence number the transaction was included in. */
  ledger: number;
  /** Unix timestamp (seconds) of the ledger close time. */
  timestamp: number;
  /**
   * Flat list of all nodes, ordered by their `id`.
   * The root call is always at index 0 (id === 0).
   */
  nodes: DagNode[];
  /** Total depth of the deepest call in the tree. */
  maxDepth: number;
  /** Total number of unique contract addresses involved. */
  uniqueContracts: number;
  /** Whether any contract appears more than once in the call path (reentrancy hint). */
  hasReentrancy: boolean;
}
