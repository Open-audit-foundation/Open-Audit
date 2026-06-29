import { NextResponse } from "next/server";

// Mocking WASM stats since they aren't globally tracked in the repository yet.
export async function GET() {
  try {
    return NextResponse.json({
      status: "success",
      timestamp: new Date().toISOString(),
      stats: {
        totalExecutions: 1542,
        successful: 1500,
        failures: 30,
        timeouts: 12,
        averageExecutionTimeMs: 45,
        peakMemoryUsageBytes: 1024 * 512,
      }
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
