/**
 * API endpoint for historical ledger range ingestion.
 *
 * POST /api/ingest-historical
 * {
 *   "contractId": "CABC...",
 *   "startSequence": 1000,
 *   "endSequence": 5000,
 *   "chunkSize": 1000 // optional
 * }
 */

import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";
import { ingestHistoricalRange } from "@/lib/stellar/historical-ingester";
import { getNetworkConfig } from "@/lib/stellar/client";
import { bufferEvents, flushEvents, updateCursorCH } from "@/lib/db/clickhouse-ingest";
import { NextRequest, NextResponse } from "next/server";
import { authenticateAndRateLimit } from "@/lib/api/middleware";

// OpenAPI documentation metadata
export const routeDoc = {
  summary: "Ingest historical ledger range",
  description: "Fetches and backfills contract events from a specified historical ledger range.",
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["contractId", "startSequence", "endSequence"],
          properties: {
            contractId: { type: "string", description: "The Soroban contract ID to fetch events for." },
            startSequence: { type: "integer", description: "The starting ledger sequence number (inclusive)." },
            endSequence: { type: "integer", description: "The ending ledger sequence number (inclusive)." },
            chunkSize: { type: "integer", description: "Number of ledgers per chunk.", default: 1000 },
          },
        },
      },
    },
  },
  responses: {
    200: { description: "Successful ingestion" },
    400: { description: "Invalid request parameters" },
    500: { description: "Internal server error" },
  },
};

interface IngestRequest {
  contractId: string;
  startSequence: number;
  endSequence: number;
  chunkSize?: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let contractId: string | undefined;

  try {
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    const body: IngestRequest = await request.json();
    contractId = body.contractId;

    if (!body.contractId || typeof body.startSequence !== "number" || typeof body.endSequence !== "number") {
      return validationErrorResponse(
        "Missing or invalid required fields: contractId, startSequence, endSequence"
      );
    }

    if (body.startSequence < 1 || body.endSequence < body.startSequence) {
      return validationErrorResponse(
        "Invalid sequence range: startSequence >= 1 and endSequence >= startSequence"
      );
    }

    const chunkSize = body.chunkSize ?? 1000;
    if (chunkSize < 1) {
      return validationErrorResponse("chunkSize must be >= 1");
    }

    const networkConfig = getNetworkConfig();
    let totalEvents = 0;
    let totalChunks = 0;

    await ingestHistoricalRange({
      networkConfig,
      contractId: body.contractId,
      startSequence: body.startSequence,
      endSequence: body.endSequence,
      chunkSize,
      onChunkComplete: async (result) => {
        // Buffer into ClickHouse; auto-flushes at every 10 000 rows.
        await bufferEvents(result.events as any[]);
        totalEvents += result.eventCount;
      },
      onComplete: async (_total, chunks) => {
        // Drain any remainder that didn't fill a full batch.
        await flushEvents();
        await updateCursorCH(body.endSequence);
        totalChunks = chunks;
      },
    });

    return NextResponse.json({
      success: true,
      contractId: body.contractId,
      range: { start: body.startSequence, end: body.endSequence },
      results: { totalEvents, totalChunks },
    });
  } catch (error) {
    return toErrorResponse(error, {
      fallbackMessage: "Ingestion failed",
      context: contractId ? { contractId, operation: "ingest-historical" } : { operation: "ingest-historical" },
    });
  }
}
