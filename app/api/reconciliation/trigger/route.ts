/**
 * Reconciliation Trigger API
 * POST /api/reconciliation/trigger
 */

import { NextRequest, NextResponse } from "next/server";
import { triggerReconciliation } from "@/lib/reconciliation/scheduler";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { startLedger, endLedger, contractIds, autoFix } = body;

    // Validate inputs
    if (!Number.isInteger(startLedger) || !Number.isInteger(endLedger)) {
      return NextResponse.json(
        { error: "startLedger and endLedger must be integers" },
        { status: 400 }
      );
    }

    if (startLedger < 0 || endLedger < 0) {
      return NextResponse.json({ error: "Ledger numbers must be positive" }, { status: 400 });
    }

    if (startLedger > endLedger) {
      return NextResponse.json(
        { error: "startLedger must be less than or equal to endLedger" },
        { status: 400 }
      );
    }

    const result = await triggerReconciliation({
      startLedger,
      endLedger,
      contractIds,
      autoFix: autoFix || false,
    });

    if (result.success) {
      return NextResponse.json(result);
    } else {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
  } catch (error) {
    console.error("[reconciliation/trigger] Error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
