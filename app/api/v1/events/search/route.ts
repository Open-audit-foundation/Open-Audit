/**
 * Events Search API
 *
 * POST /api/v1/events/search — Full-text + filter search across historical events.
 *
 * Text matching uses Postgres full-text search (tsvector/tsquery) backed by the
 * GIN-indexed "searchVector" column maintained by a DB trigger — see migration
 * 20260904000000_add_event_full_text_search (issue #409). Multi-word queries are
 * parsed with websearch_to_tsquery, so terms match in any order and results are
 * ranked by ts_rank. Without a text query the endpoint keeps its previous
 * ledger/timestamp ordering and Prisma query path unchanged.
 */
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNs } from "@prisma/client";
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

/** Column list kept in sync with the Event model so raw rows match findMany output. */
const EVENT_COLUMNS = PrismaNs.sql`"id", "contractId", "ledger", "timestamp", "txHash", "topics", "data", "description", "status", "blueprintName", "eventType", "schemaVersion", "executionDagId", "createdAt", "updatedAt"`;

/**
 * Full-text search path: relevance-ranked via ts_rank over the GIN-indexed
 * searchVector. Filters (contractId, eventType, status, ledger range) and
 * id-based cursor pagination behave exactly as on the non-text path.
 */
async function fullTextSearch(body: SearchBody, query: string, limit: number) {
  const filters: PrismaNs.Sql[] = [];
  if (body.contractId) filters.push(PrismaNs.sql`e."contractId" = ${body.contractId}`);
  if (body.eventType) filters.push(PrismaNs.sql`e."eventType" = ${body.eventType}`);
  if (body.status) filters.push(PrismaNs.sql`e."status" = ${body.status}`);
  if (body.startLedger !== undefined) filters.push(PrismaNs.sql`e."ledger" >= ${body.startLedger}`);
  if (body.endLedger !== undefined) filters.push(PrismaNs.sql`e."ledger" <= ${body.endLedger}`);
  const filterClause =
    filters.length > 0 ? PrismaNs.sql`AND ${PrismaNs.join(filters, " AND ")}` : PrismaNs.sql``;

  const take = limit + 1; // fetch one extra to detect next page
  const cursor: string | null = body.cursor ?? null;

  // CTE ladder: scored (FTS match + rank) -> ranked (stable total order).
  // Cursor seek uses row_number so the opaque cursor stays a plain event id;
  // the matched set is bounded by the GIN-indexed @@ predicate.
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>(
    PrismaNs.sql`
      WITH scored AS (
        SELECT e.*, ts_rank(e."searchVector", websearch_to_tsquery('english', ${query})) AS rank
        FROM "Event" e
        WHERE e."searchVector" @@ websearch_to_tsquery('english', ${query})
        ${filterClause}
      ),
      ranked AS (
        SELECT *, row_number() OVER (ORDER BY rank DESC, "ledger" DESC, "id" ASC) AS rn
        FROM scored
      )
      SELECT ${EVENT_COLUMNS}
      FROM ranked
      WHERE ${cursor}::text IS NULL OR rn > (SELECT rn FROM ranked WHERE "id" = ${cursor})
      ORDER BY rn
      LIMIT ${take}
    `
  );

  return rows;
}

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

    const textQuery = typeof body.query === "string" ? body.query.trim() : "";
    const take = limit + 1; // fetch one extra to detect next page

    // --- Text query: Postgres full-text search path ---
    if (textQuery) {
      const rows = await fullTextSearch(body, textQuery, limit);
      const hasMore = rows.length > limit;
      const results = hasMore ? rows.slice(0, limit) : rows;
      const last = results[results.length - 1] as { id?: string } | undefined;
      const nextCursor = hasMore && last ? (last.id as string) : null;

      return NextResponse.json({
        events: results,
        pagination: {
          nextCursor,
          hasMore,
          limit,
        },
      });
    }

    // --- No text query: unchanged Prisma filter/ledger-order path ---
    const where: Prisma.EventWhereInput = {};
    const AND: Prisma.EventWhereInput[] = [];

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
      const ledgerFilter: Prisma.IntFilter = {};
      if (body.startLedger !== undefined) ledgerFilter.gte = body.startLedger;
      if (body.endLedger !== undefined) ledgerFilter.lte = body.endLedger;
      AND.push({ ledger: ledgerFilter });
    }

    if (AND.length > 0) {
      where.AND = AND;
    }

    // --- Pagination ---
    const queryArgs: Prisma.EventFindManyArgs = {
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
