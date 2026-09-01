/**
 * DAG Persistence — stores and retrieves ExecutionDags from the database.
 *
 * Each Soroban transaction produces at most one ExecutionDag. The DAG is
 * linked to the Event(s) it corresponds to (a transaction can produce
 * multiple contract events, all sharing one call tree).
 */

import { db } from "../db/client";
import type { ExecutionDag, ReentrancyInfo, AuthTrace } from "./types";

/**
 * Persist an ExecutionDag to the database.
 *
 * If a DAG for this transaction hash already exists, it is updated in place.
 * The DAG is linked to any existing Event records with the same txHash.
 *
 * @returns The saved ExecutionDag record ID.
 */
export async function persistExecutionDag(dag: ExecutionDag): Promise<string> {
  const existing = await db.executionDag.findUnique({
    where: { txHash: dag.txHash },
    select: { id: true },
  });

  const data = {
    txHash: dag.txHash,
    ledger: dag.ledger,
    timestamp: dag.timestamp,
    nodes: dag.nodes as any,
    maxDepth: dag.maxDepth,
    uniqueContracts: dag.uniqueContracts,
    hasReentrancy: dag.hasReentrancy,
    reentrancyDetails: dag.reentrancyDetails as any,
    authTraces: dag.authTraces as any,
  };

  let dagId: string;

  if (existing) {
    await db.executionDag.update({
      where: { id: existing.id },
      data,
    });
    dagId = existing.id;
  } else {
    const created = await db.executionDag.create({ data });
    dagId = created.id;
  }

  // Link any existing events with this txHash to the DAG.
  await db.event.updateMany({
    where: { txHash: dag.txHash, executionDagId: null },
    data: { executionDagId: dagId },
  });

  return dagId;
}

/**
 * Retrieve an ExecutionDag by transaction hash.
 *
 * Returns the full DAG including nodes, reentrancy details, and auth traces,
 * or null if no DAG has been persisted for this transaction.
 */
export async function getExecutionDagByTxHash(
  txHash: string
): Promise<ExecutionDag | null> {
  const record = await db.executionDag.findUnique({
    where: { txHash },
  });

  if (!record) return null;

  return {
    txHash: record.txHash,
    ledger: record.ledger,
    timestamp: record.timestamp,
    nodes: record.nodes as unknown as ExecutionDag["nodes"],
    maxDepth: record.maxDepth,
    uniqueContracts: record.uniqueContracts,
    hasReentrancy: record.hasReentrancy,
    reentrancyDetails: record.reentrancyDetails as unknown as ReentrancyInfo[],
    authTraces: record.authTraces as unknown as AuthTrace[],
  };
}

/**
 * Retrieve an ExecutionDag by its database ID.
 */
export async function getExecutionDagById(
  id: string
): Promise<ExecutionDag | null> {
  const record = await db.executionDag.findUnique({
    where: { id },
  });

  if (!record) return null;

  return {
    txHash: record.txHash,
    ledger: record.ledger,
    timestamp: record.timestamp,
    nodes: record.nodes as unknown as ExecutionDag["nodes"],
    maxDepth: record.maxDepth,
    uniqueContracts: record.uniqueContracts,
    hasReentrancy: record.hasReentrancy,
    reentrancyDetails: record.reentrancyDetails as unknown as ReentrancyInfo[],
    authTraces: record.authTraces as unknown as AuthTrace[],
  };
}

/**
 * Retrieve an ExecutionDag by ledger sequence number.
 * Returns the most recent DAG for the given ledger.
 */
export async function getExecutionDagByLedger(
  ledger: number
): Promise<ExecutionDag | null> {
  const record = await db.executionDag.findFirst({
    where: { ledger },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return null;

  return {
    txHash: record.txHash,
    ledger: record.ledger,
    timestamp: record.timestamp,
    nodes: record.nodes as unknown as ExecutionDag["nodes"],
    maxDepth: record.maxDepth,
    uniqueContracts: record.uniqueContracts,
    hasReentrancy: record.hasReentrancy,
    reentrancyDetails: record.reentrancyDetails as unknown as ReentrancyInfo[],
    authTraces: record.authTraces as unknown as AuthTrace[],
  };
}

/**
 * List recent reentrancy-flagged DAGs.
 *
 * @param limit Maximum number of results (default 50).
 * @returns Array of ExecutionDags where hasReentrancy is true, newest first.
 */
export async function listReentrancyDags(
  limit: number = 50
): Promise<ExecutionDag[]> {
  const records = await db.executionDag.findMany({
    where: { hasReentrancy: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return records.map((record) => ({
    txHash: record.txHash,
    ledger: record.ledger,
    timestamp: record.timestamp,
    nodes: record.nodes as unknown as ExecutionDag["nodes"],
    maxDepth: record.maxDepth,
    uniqueContracts: record.uniqueContracts,
    hasReentrancy: record.hasReentrancy,
    reentrancyDetails: record.reentrancyDetails as unknown as ReentrancyInfo[],
    authTraces: record.authTraces as unknown as AuthTrace[],
  }));
}
