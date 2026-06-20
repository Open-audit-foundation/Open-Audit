/**
 * Reconciliation Configuration API
 * GET /api/reconciliation/config
 * PUT /api/reconciliation/config
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getReconciliationConfig,
  updateReconciliationConfig,
} from "@/lib/reconciliation/scheduler";

export async function GET(request: NextRequest) {
  try {
    const config = await getReconciliationConfig();

    return NextResponse.json(config);
  } catch (error) {
    console.error("[reconciliation/config] GET Error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    const updated = await updateReconciliationConfig(body);

    return NextResponse.json({
      success: true,
      config: updated,
    });
  } catch (error) {
    console.error("[reconciliation/config] PUT Error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
