/**
 * Reconciliation History API
 * GET /api/reconciliation/history
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { generateAuditReport, getAuditStatistics } from "@/lib/reconciliation/auditor";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const status = searchParams.get("status"); // Optional: "pending" | "processing" | "completed" | "failed"

    // Get reconciliation jobs
    const jobs = await db.reconciliationJob.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    // Get total count
    const totalCount = await db.reconciliationJob.count({
      where: status ? { status } : {},
    });

    // Get statistics for the last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const stats = await getAuditStatistics(thirtyDaysAgo, new Date());

    return NextResponse.json({
      jobs,
      pagination: {
        offset,
        limit,
        total: totalCount,
        hasMore: offset + limit < totalCount,
      },
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[reconciliation/history] Error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
