/**
 * GET /api/v1/analytics?contractId=...&days=30
 *
 * Returns pre-aggregated analytics from ClickHouse materialized views.
 * Typical P99 < 50 ms even at billion-row scale because reads never
 * touch the raw events table.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDailyVolume, getEventTypeTotals } from "@/lib/db/clickhouse-ingest";
import { authenticateAndRateLimit } from "@/lib/api/middleware";
import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    const { searchParams } = request.nextUrl;
    const contractId = searchParams.get("contractId");
    const days = parseInt(searchParams.get("days") ?? "30", 10);

    if (!contractId) return validationErrorResponse("contractId is required");
    if (isNaN(days) || days < 1 || days > 365) return validationErrorResponse("days must be 1–365");

    const [dailyVolume, eventTypes] = await Promise.all([
      getDailyVolume(contractId, days),
      getEventTypeTotals(contractId),
    ]);

    return NextResponse.json({ contractId, days, dailyVolume, eventTypes });
  } catch (error) {
    return toErrorResponse(error, { fallbackMessage: "Analytics query failed" });
  }
}
