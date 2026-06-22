/**
 * GET /api/v1/dag/[txHash]
 *
 * Reconstructs the Soroban execution DAG for a given transaction hash by:
 *   1. Fetching the transaction from the Soroban RPC `getTransaction` endpoint.
 *   2. Extracting `SorobanTransactionMeta.diagnosticEvents` from the result XDR.
 *   3. Running the DAG reconstruction engine.
 *   4. Returning the serialised DAG as JSON.
 *
 * Returns 404 if the transaction is not found or has no Soroban metadata.
 * Returns 422 if the txHash format is invalid.
 * Returns 200 with { dag: ExecutionDagJson } on success.
 */

import { NextRequest, NextResponse } from "next/server";
import { SorobanRpc } from "stellar-sdk";
import { getConfigForNetwork } from "@/lib/stellar/client";
import { reconstructDagFromMetaXdr } from "@/lib/dag/engine";
import { dagToJson } from "@/lib/dag/types";

// A transaction hash is a 64-character hex string.
const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: { txHash: string } }
): Promise<NextResponse> {
  const { txHash } = params;

  if (!TX_HASH_RE.test(txHash)) {
    return NextResponse.json(
      { error: "Invalid transaction hash format. Expected 64 hex characters." },
      { status: 422 }
    );
  }

  const networkName =
    (process.env.NEXT_PUBLIC_NETWORK as "testnet" | "mainnet" | "futurenet") ??
    "testnet";
  const config = getConfigForNetwork(networkName);
  const server = new SorobanRpc.Server(config.sorobanRpcUrl);

  let txResult: SorobanRpc.Api.GetTransactionResponse;
  try {
    txResult = await server.getTransaction(txHash);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `RPC error: ${msg}` },
      { status: 502 }
    );
  }

  // getTransaction returns { status: "NOT_FOUND" } or similar when not found.
  if (
    !txResult ||
    (txResult as { status?: string }).status === "NOT_FOUND"
  ) {
    return NextResponse.json(
      { error: "Transaction not found." },
      { status: 404 }
    );
  }

  // The result XDR is base64-encoded TransactionMeta.
  const resultMetaXdr =
    (txResult as unknown as { resultMetaXdr?: string }).resultMetaXdr ?? "";
  if (!resultMetaXdr) {
    return NextResponse.json(
      { error: "Transaction has no result meta XDR (non-Soroban transaction?)." },
      { status: 404 }
    );
  }

  const ledger =
    (txResult as unknown as { ledger?: number }).ledger ?? 0;
  const createdAt =
    (txResult as unknown as { createdAt?: number }).createdAt ??
    Math.floor(Date.now() / 1000);

  const dag = reconstructDagFromMetaXdr(resultMetaXdr, txHash, ledger, createdAt);

  if (dag === null) {
    return NextResponse.json(
      { error: "No Soroban diagnostic events found in this transaction." },
      { status: 404 }
    );
  }

  return NextResponse.json(dagToJson(dag), {
    status: 200,
    headers: {
      // Cache for 60s — DAGs are immutable once the ledger is closed.
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
