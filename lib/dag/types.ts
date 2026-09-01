/**
 * DAG Types stub
 *
 * Placeholder type definitions for the execution DAG feature.
 * TODO: Define the full shape once DAG reconstruction is implemented.
 */

/** Represents a Soroban execution DAG reconstructed from DiagnosticEvents. */
export interface ExecutionDag {
  /** Transaction hash that this DAG was built from. */
  txHash: string;
  /** Ledger sequence number of the transaction. */
  ledger: number;
  /** Unix timestamp of ledger close. */
  timestamp: number;
  /** Ordered list of contract calls in this transaction. */
  nodes: ExecutionDagNode[];
}

/** A single node in the execution DAG (a contract invocation). */
export interface ExecutionDagNode {
  /** Contract ID that was invoked. */
  contractId: string;
  /** Function name that was called. */
  functionName: string;
  /** Index of this node in execution order. */
  index: number;
  /** Index of the parent call (null for root). */
  parentIndex: number | null;
}
