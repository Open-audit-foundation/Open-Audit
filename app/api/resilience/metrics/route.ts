import { NextResponse } from "next/server";
import { getHealthStatus, getResilientMetrics } from "@/lib/stellar/resilient-stellar-client";

export async function GET() {
  try {
    const health = getHealthStatus();
    const metrics = getResilientMetrics();

    return NextResponse.json({
      status: "success",
      timestamp: new Date().toISOString(),
      health,
      metrics
    }, {
      status: 200,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
