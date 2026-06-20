/**
 * Reconciliation Status API
 * GET /api/reconciliation/status
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";

export async function GET(request: NextRequest) {
  try {
    // Get latest reconciliation job
    const latestJob = await db.reconciliationJob.findFirst({
      orderBy: { createdAt: "desc" },
    });

    // Get active job
    const activeJob = await db.reconciliationJob.findFirst({
      where: { status: "processing" },
    });

    // Get statistics
    const completedJobs = await db.reconciliationJob.count({
      where: { status: "completed" },
    });

    const failedJobs = await db.reconciliationJob.count({
      where: { status: "failed" },
    });

    return NextResponse.json({
      latest: latestJob,
      active: activeJob,
      stats: {
        completedJobs,
        failedJobs,
        totalJobs: completedJobs + failedJobs,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[reconciliation/status] Error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
