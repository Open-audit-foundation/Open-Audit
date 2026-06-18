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

import { ingestHistoricalRange } from "@/lib/stellar/historical-ingester";
import { getNetworkConfig } from "@/lib/stellar/client";
import { NextRequest, NextResponse } from "next/server";

interface IngestRequest {
  contractId: string;
  startSequence: number;
  endSequence: number;
  chunkSize?: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: IngestRequest = await request.json();

    // Validate required fields
    if (!body.contractId || typeof body.startSequence !== "number" || typeof body.endSequence !== "number") {
      return NextResponse.json(
        { error: "Missing or invalid required fields: contractId, startSequence, endSequence" },
        { status: 400 }
      );
    }

    // Validate ranges
    if (body.startSequence < 1 || body.endSequence < body.startSequence) {
      return NextResponse.json(
        { error: "Invalid sequence range: startSequence >= 1 and endSequence >= startSequence" },
        { status: 400 }
      );
    }

    const chunkSize = body.chunkSize ?? 1000;
    if (chunkSize < 1) {
      return NextResponse.json({ error: "chunkSize must be >= 1" }, { status: 400 });
    }

    const networkConfig = getNetworkConfig();
    const events: unknown[] = [];
    let totalChunks = 0;

    // Ingest historical range
    await ingestHistoricalRange({
      networkConfig,
      contractId: body.contractId,
      startSequence: body.startSequence,
      endSequence: body.endSequence,
      chunkSize,
      onChunkComplete: async (result) => {
        events.push(...result.events);
      },
      onComplete: async (totalEvents, chunks) => {
        totalChunks = chunks;
      },
      onError: (error) => {
        console.error("[api/ingest-historical] Error:", error);
        throw error;
      },
    });

    return NextResponse.json({
      success: true,
      contractId: body.contractId,
      range: {
        start: body.startSequence,
        end: body.endSequence,
      },
      results: {
        totalEvents: events.length,
        totalChunks,
        events,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[api/ingest-historical] Request failed:", error);
    return NextResponse.json(
      { error: "Ingestion failed", details: message },
      { status: 500 }
    );
  }
}
