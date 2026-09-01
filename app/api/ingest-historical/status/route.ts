/**
 * GET /api/ingest-historical/status
 *
 * Returns the current state of a historical backfill run for a given contract:
 *   - The last ledger processed (from the historical IndexerCursor)
 *   - How many events have been written to the Postgres Event table
 *   - A sample of the most recently backfilled events (queryable proof)
 *
 * This route satisfies Issue #420's acceptance criterion:
 *   "Backfilled historical data is actually queryable afterward through some
 *    real path in the application — not just written and then unreachable."
 *
 * Query parameters
 * ────────────────
 * contractId   (required) — The Soroban contract address to inspect.
 * startLedger  (optional) — Lower bound for the event count / sample query.
 * endLedger    (optional) — Upper bound for the event count / sample query.
 * sampleSize   (optional) — Max events to include in the sample (default 10, max 100).
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAndRateLimit } from "@/lib/api/middleware";
import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";
import { getHistoricalCursor, historicalCursorId } from "@/lib/stellar/historical-ingester";
import { getEventCount, getEventsByLedgerRange } from "@/lib/db/utils";
import { db } from "@/lib/db/client";

// ─── OpenAPI metadata ─────────────────────────────────────────────────────────

export const routeDoc = {
  summary: "Query historical ingestion status",
  description:
    "Returns cursor progress, event count, and a queryable sample of backfilled " +
    "events for the given contract.  Proves that POST /api/ingest-historical " +
    "data lands in a path readable by the rest of the application.",
  parameters: [
    {
      name: "contractId",
      in: "query",
      required: true,
      schema: { type: "string" },
      description: "Soroban contract address to inspect.",
    },
    {
      name: "startLedger",
      in: "query",
      required: false,
      schema: { type: "integer" },
      description: "Lower ledger bound for the event count and sample.",
    },
    {
      name: "endLedger",
      in: "query",
      required: false,
      schema: { type: "integer" },
      description: "Upper ledger bound for the event count and sample.",
    },
    {
      name: "sampleSize",
      in: "query",
      required: false,
      schema: { type: "integer", default: 10, maximum: 100 },
      description: "Maximum number of events to return as proof of queryability.",
    },
  ],
  responses: {
    200: { description: "Status retrieved successfully" },
    400: { description: "Invalid query parameters" },
    401: { description: "Missing or invalid API key" },
    429: { description: "Rate limit exceeded" },
    500: { description: "Internal server error" },
  },
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    // ── Parse query params ───────────────────────────────────────────────────
    const { searchParams } = request.nextUrl;

    const contractId = searchParams.get("contractId");
    if (!contractId || contractId.trim() === "") {
      return validationErrorResponse("contractId query parameter is required");
    }

    const startLedgerRaw = searchParams.get("startLedger");
    const endLedgerRaw   = searchParams.get("endLedger");
    const sampleSizeRaw  = searchParams.get("sampleSize");

    const startLedger = startLedgerRaw !== null ? Number(startLedgerRaw) : undefined;
    const endLedger   = endLedgerRaw   !== null ? Number(endLedgerRaw)   : undefined;
    const sampleSize  = sampleSizeRaw  !== null ? Math.min(Number(sampleSizeRaw), 100) : 10;

    if (startLedger !== undefined && (!Number.isInteger(startLedger) || startLedger < 0)) {
      return validationErrorResponse("startLedger must be a non-negative integer");
    }
    if (endLedger !== undefined && (!Number.isInteger(endLedger) || endLedger < 0)) {
      return validationErrorResponse("endLedger must be a non-negative integer");
    }
    if (startLedger !== undefined && endLedger !== undefined && startLedger > endLedger) {
      return validationErrorResponse("startLedger must be <= endLedger");
    }
    if (!Number.isInteger(sampleSize) || sampleSize < 1) {
      return validationErrorResponse("sampleSize must be a positive integer (max 100)");
    }

    // ── Fetch cursor progress ────────────────────────────────────────────────
    const lastLedger = await getHistoricalCursor(contractId);
    const cursorId   = historicalCursorId(contractId);

    // ── Count and sample backfilled events in Postgres ───────────────────────
    // Use the requested ledger bounds when provided; otherwise query
    // everything for this contract that was tagged as "historical".
    const effectiveStart = startLedger ?? 0;
    const effectiveEnd   = endLedger   ?? lastLedger;

    const [eventCount, sampleEvents, liveEventCount] = await Promise.all([
      // Count of historical-tagged events in the requested range
      getEventCount(effectiveStart, effectiveEnd, contractId, "historical"),
      // Queryable sample — the same table every other endpoint reads
      getEventsByLedgerRange(effectiveStart, effectiveEnd, contractId, "historical").then(
        (rows) => rows.slice(0, sampleSize)
      ),
      // Also show live-tagged events so operators can see the full picture
      getEventCount(effectiveStart, effectiveEnd, contractId, "live"),
    ]);

    // Retrieve the full cursor row for extra metadata (lastProcessed timestamp)
    const cursorRow = await db.indexerCursor.findUnique({ where: { id: cursorId } });

    // ── Response ─────────────────────────────────────────────────────────────
    return NextResponse.json({
      contractId,
      cursor: {
        id: cursorId,
        lastLedger,
        lastProcessed: cursorRow?.lastProcessed ?? null,
      },
      ledgerRange: {
        start: effectiveStart,
        end: effectiveEnd,
      },
      events: {
        historicalCount: eventCount,
        liveCount: liveEventCount,
        totalCount: eventCount + liveEventCount,
        sample: sampleEvents,
      },
      queryable: eventCount > 0 || liveEventCount > 0,
      message:
        eventCount > 0
          ? `${eventCount} backfilled events are queryable for contract ${contractId}.`
          : lastLedger > 0
            ? `Backfill cursor is at ledger ${lastLedger} but no events matched the requested range.`
            : `No historical backfill has been run for contract ${contractId} yet.`,
    });
  } catch (error) {
    return toErrorResponse(error, {
      fallbackMessage: "Failed to retrieve historical ingestion status",
      context: { operation: "ingest-historical-status" },
    });
  }
}
