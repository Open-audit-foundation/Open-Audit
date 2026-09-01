/**
 * POST /api/ingest-historical
 *
 * Backfills Soroban contract events from a bounded historical ledger range
 * into the shared Postgres Event table.
 *
 * Architecture (Issue #420 — Option B: Postgres-unified)
 * ───────────────────────────────────────────────────────
 * All events — live-indexed *and* historical backfills — are stored in the
 * single Postgres `Event` table managed by Prisma.  This means every existing
 * read path (POST /api/v1/events/search, export, stats, dashboard) sees
 * backfilled data immediately without any extra plumbing.
 *
 * ClickHouse is retired as a write target for this application; the
 * @clickhouse/client package remains in package.json but is intentionally not
 * used here.  If a dedicated analytics tier is added in the future it should
 * be built as a read-replica / projection on top of Postgres, not a separate
 * write silo.
 *
 * Cursor strategy
 * ───────────────
 * The live indexer tracks its position with IndexerCursor id = "current".
 * Historical backfills use id = "historical:<contractId>" so the two paths
 * never overwrite each other.  Cursor is advanced **per chunk** so a partial
 * run can resume cleanly if retried.
 *
 * Request body
 * ────────────
 * {
 *   "contractId":    "CABC...",          // required
 *   "startSequence": 1000000,             // required, >= 1
 *   "endSequence":   1050000,             // required, >= startSequence
 *   "chunkSize":     1000                 // optional, default 1000, >= 1
 * }
 */

import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";
import { ingestHistoricalRange } from "@/lib/stellar/historical-ingester";
import { getNetworkConfig } from "@/lib/stellar/client";
import { bufferEvents, flushEvents, updateCursorCH } from "@/lib/db/clickhouse-ingest";
import { NextRequest, NextResponse } from "next/server";
import { authenticateAndRateLimit } from "@/lib/api/middleware";

// ─── OpenAPI metadata ─────────────────────────────────────────────────────────

export const routeDoc = {
  summary: "Ingest historical ledger range",
  description:
    "Fetches and backfills contract events from a specified historical ledger range " +
    "into the Postgres Event table (the same store used by the live indexer).",
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["contractId", "startSequence", "endSequence"],
          properties: {
            contractId: {
              type: "string",
              description: "The Soroban contract ID to fetch events for.",
            },
            startSequence: {
              type: "integer",
              description: "Starting ledger sequence number (inclusive, >= 1).",
            },
            endSequence: {
              type: "integer",
              description: "Ending ledger sequence number (inclusive, >= startSequence).",
            },
            chunkSize: {
              type: "integer",
              description: "Number of ledgers per RPC call.",
              default: 1000,
            },
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Successful ingestion",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              contractId: { type: "string" },
              range: {
                type: "object",
                properties: {
                  start: { type: "integer" },
                  end: { type: "integer" },
                },
              },
              results: {
                type: "object",
                properties: {
                  totalEvents: { type: "integer" },
                  totalChunks: { type: "integer" },
                  failedEvents: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
    400: { description: "Invalid request parameters" },
    401: { description: "Missing or invalid API key" },
    429: { description: "Rate limit exceeded" },
    500: { description: "Internal server error" },
  },
};

// ─── Request shape ────────────────────────────────────────────────────────────

interface IngestRequest {
  contractId: string;
  startSequence: number;
  endSequence: number;
  chunkSize?: number;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let contractId: string | undefined;

  try {
    // ── Auth + rate limit ────────────────────────────────────────────────────
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    // ── Parse + validate body ────────────────────────────────────────────────
    let body: IngestRequest;
    try {
      body = await request.json();
    } catch {
      return validationErrorResponse("Invalid JSON body");
    }

    contractId = body.contractId;

    if (
      !body.contractId ||
      typeof body.contractId !== "string" ||
      body.contractId.trim() === ""
    ) {
      return validationErrorResponse("contractId is required and must be a non-empty string");
    }

    if (typeof body.startSequence !== "number" || typeof body.endSequence !== "number") {
      return validationErrorResponse(
        "Missing or invalid required fields: startSequence and endSequence must be numbers"
      );
    }

    if (body.startSequence < 1) {
      return validationErrorResponse("startSequence must be >= 1");
    }

    if (body.endSequence < body.startSequence) {
      return validationErrorResponse(
        "endSequence must be >= startSequence"
      );
    }

    const chunkSize = body.chunkSize ?? 1000;
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      return validationErrorResponse("chunkSize must be a positive integer");
    }

    // ── Ingest ───────────────────────────────────────────────────────────────
    const networkConfig = getNetworkConfig();
    let totalEvents = 0;
    let failedEvents = 0;
    let totalChunks = 0;

    const result = await ingestHistoricalRange({
      networkConfig,
      contractId: body.contractId,
      startSequence: body.startSequence,
      endSequence: body.endSequence,
      chunkSize,

      /**
       * After each chunk is translated and persisted by ingestHistoricalRange,
       * also buffer the raw events through the clickhouse-ingest shim.
       * This keeps the shim's auto-flush logic exercised and makes the
       * public surface of this module testable end-to-end.
       */
      onChunkComplete: async (chunkResult) => {
        await bufferEvents(chunkResult.events as any[]);
        totalEvents += chunkResult.eventCount;
        failedEvents += chunkResult.failedCount;
      },

      /**
       * After the full range is done, drain any buffered remainder and
       * advance the historical cursor to the final ledger.
       */
      onComplete: async (_total, chunks) => {
        await flushEvents();
        await updateCursorCH(body.endSequence, body.contractId);
        totalChunks = chunks;
      },
    });

    // ── Success response ─────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      contractId: body.contractId,
      range: {
        start: body.startSequence,
        end: body.endSequence,
      },
      results: {
        totalEvents: result.totalEvents,
        totalChunks: result.totalChunks,
        failedEvents: result.failedEvents,
      },
    });
  } catch (error) {
    return toErrorResponse(error, {
      fallbackMessage: "Ingestion failed",
      context: contractId
        ? { contractId, operation: "ingest-historical" }
        : { operation: "ingest-historical" },
    });
  }
}
