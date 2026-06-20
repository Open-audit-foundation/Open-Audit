/**
 * Health Check API
 * GET /api/health
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getIndexerHealthMetrics } from "@/lib/stellar/indexer-persistent";

export async function GET(request: NextRequest) {
  try {
    const metrics = await getIndexerHealthMetrics();

    return NextResponse.json({
      status: metrics.healthy ? "healthy" : "degraded",
      database: {
        connected: true,
        totalEvents: metrics.totalEvents,
        verifiedEvents: metrics.verifiedEvents,
        pendingVerification: metrics.pendingVerification,
        verificationRate: metrics.verificationRate,
      },
      indexer: {
        lastLedger: metrics.lastLedger,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[health] Error:", error);

    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        database: { connected: false },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
