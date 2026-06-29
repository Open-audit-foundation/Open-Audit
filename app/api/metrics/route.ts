import { NextResponse } from "next/server";
import { metricsRegistry } from "@/lib/telemetry";

export async function GET() {
  try {
    const metrics = await metricsRegistry.metrics();
    return new NextResponse(metrics, {
      status: 200,
      headers: {
        "Content-Type": metricsRegistry.contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    return new NextResponse(
      `Unable to collect metrics: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}
