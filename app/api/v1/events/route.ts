
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { authenticateAndRateLimit } from "@/lib/api/middleware";
import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";
import type { TranslatedEvent, TranslationStatus } from "@/lib/translator/types";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    const { searchParams } = request.nextUrl;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 1000);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10);

    if (isNaN(limit) || limit < 1)
      return validationErrorResponse("limit must be a positive integer");
    if (isNaN(offset) || offset < 0)
      return validationErrorResponse("offset must be a non-negative integer");

    const events = await db.event.findMany({
      take: limit,
      skip: offset,
      orderBy: {
        ledger: "desc",
      },
    });

    const translatedEvents: TranslatedEvent[] = events.map((event) => ({
      raw: {
        id: event.id,
        contractId: event.contractId,
        topics: event.topics as string[],
        data: event.data,
        ledger: event.ledger,
        timestamp: event.timestamp,
        txHash: event.txHash,
      },
      description: event.description,
      status: event.status as TranslationStatus,
      blueprintName: event.blueprintName,
      eventType: event.eventType,
      schemaVersion: null,
    }));

    return NextResponse.json(translatedEvents);
  } catch (error) {
    return toErrorResponse(error, { fallbackMessage: "Events query failed" });
  }
}
