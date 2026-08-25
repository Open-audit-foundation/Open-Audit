/**
 * Execution DAG API
 *
 * GET /api/v1/dag?txHash=<hash>      — Fetch DAG by transaction hash
 * GET /api/v1/dag?id=<id>            — Fetch DAG by database ID
 * GET /api/v1/dag?ledger=<sequence>  — Fetch DAG by ledger sequence
 * GET /api/v1/dag?reentrancy=true   — List recent reentrancy-flagged DAGs
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAndRateLimit } from "@/lib/api/middleware";
import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";
import {
  getExecutionDagByTxHash,
  getExecutionDagById,
  getExecutionDagByLedger,
  listReentrancyDags,
} from "@/lib/dag/persistence";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await authenticateAndRateLimit(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const txHash = searchParams.get("txHash");
  const id = searchParams.get("id");
  const ledger = searchParams.get("ledger");
  const reentrancy = searchParams.get("reentrancy");

  try {
    // List reentrancy-flagged DAGs.
    if (reentrancy === "true") {
      const limit = Math.min(
        parseInt(searchParams.get("limit") ?? "50", 10) || 50,
        100
      );
      const dags = await listReentrancyDags(limit);
      return NextResponse.json({ dags });
    }

    // Fetch by transaction hash.
    if (txHash) {
      const dag = await getExecutionDagByTxHash(txHash);
      if (!dag) {
        return NextResponse.json(
          { error: "DAG not found for this transaction hash" },
          { status: 404 }
        );
      }
      return NextResponse.json({ dag });
    }

    // Fetch by database ID.
    if (id) {
      const dag = await getExecutionDagById(id);
      if (!dag) {
        return NextResponse.json(
          { error: "DAG not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ dag });
    }

    // Fetch by ledger sequence.
    if (ledger) {
      const ledgerNum = parseInt(ledger, 10);
      if (isNaN(ledgerNum) || ledgerNum < 0) {
        return validationErrorResponse("ledger must be a non-negative integer");
      }
      const dag = await getExecutionDagByLedger(ledgerNum);
      if (!dag) {
        return NextResponse.json(
          { error: "DAG not found for this ledger" },
          { status: 404 }
        );
      }
      return NextResponse.json({ dag });
    }

    return validationErrorResponse(
      "Provide one of: txHash, id, ledger, or reentrancy=true"
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
