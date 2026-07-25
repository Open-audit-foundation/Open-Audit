/**
 * Events Search API
 *
 * POST /api/v1/events/search — Full-text + filter search across historical events.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { authenticateAndRateLimit } from "@/lib/api/middleware";
import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";

interface SearchBody {
  query?: string;
  contractId?: string;
  eventType?: string;
  startLedger?: number;
  endLedger?: number;
  status?: "translated" | "cryptic";
  limit?: number;
  cursor?: string;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    let body: SearchBody;
    try {
      body = await request.json();
    } catch {
      return validationErrorResponse("Invalid JSON body");
    }

    // --- Validate ---
    const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    if ((body.limit ?? DEFAULT_LIMIT) < 1) {
      return validationErrorResponse("limit must be >= 1");
    }

    if (body.startLedger !== undefined && (typeof body.startLedger !== "number" || body.startLedger < 0)) {
      return validationErrorResponse("startLedger must be a non-negative number");
    }
    if (body.endLedger !== undefined && (typeof body.endLedger !== "number" || body.endLedger < 0)) {
      return validationErrorResponse("endLedger must be a non-negative number");
    }
    if (body.startLedger !== undefined && body.endLedger !== undefined && body.startLedger > body.endLedger) {
      return validationErrorResponse("startLedger must be <= endLedger");
    }

    if (body.status && !["translated", "cryptic"].includes(body.status)) {
      return validationErrorResponse('status must be "translated" or "cryptic"');
    }

    // --- Build Prisma where clause ---
    const where: Record<string, unknown> = {};
    const AND: Record<string, unknown>[] = [];

    if (body.query) {
      AND.push({ description: { contains: body.query, mode: "insensitive" } });
    }
    if (body.contractId) {
      AND.push({ contractId: body.contractId });
    }
    if (body.eventType) {
      AND.push({ eventType: body.eventType });
    }
    if (body.status) {
      AND.push({ status: body.status });
    }
    if (body.startLedger !== undefined || body.endLedger !== undefined) {
      const ledgerFilter: Record<string, number> = {};
      if (body.startLedger !== undefined) ledgerFilter.gte = body.startLedger;
      if (body.endLedger !== undefined) ledgerFilter.lte = body.endLedger;
      AND.push({ ledger: ledgerFilter });
    }

    if (AND.length > 0) {
      where.AND = AND;
    }

    // --- Pagination ---
    const take = limit + 1; // fetch one extra to detect next page
    const queryArgs: Record<string, unknown> = {
      where,
      orderBy: [{ ledger: "desc" }, { timestamp: "desc" }],
      take,
    };

    if (body.cursor) {
      queryArgs.cursor = { id: body.cursor };
      queryArgs.skip = 1;
    }

    const events = await db.event.findMany(queryArgs);

    // --- Build response with next cursor ---
    const hasMore = events.length > limit;
    const results = hasMore ? events.slice(0, limit) : events;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    return NextResponse.json({
      events: results,
      pagination: {
        nextCursor,
        hasMore,
        limit,
      },
    });
  } catch (error) {
    return toErrorResponse(error, { fallbackMessage: "Failed to search events" });
  }
}
