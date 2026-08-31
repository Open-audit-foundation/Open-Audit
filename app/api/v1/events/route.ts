/**
 * Events List API
 *
 * GET /api/v1/events — Paginated listing of translated contract events.
 *
 * Query params:
 *   contractId    Soroban contract address (optional filter)
 *   txHash        Transaction hash (optional filter)
 *   status        "translated" | "cryptic" (optional filter)
 *   startLedger   integer, inclusive lower bound (optional)
 *   endLedger     integer, inclusive upper bound (optional)
 *   page          1-based page number (default: 1)
 *   limit         page size (default: 25, max: 100)
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db/client";
import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const STATUS_VALUES = ["translated", "cryptic"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

/** Parses a required positive integer, falling back when the param is absent. Returns null when present but invalid. */
function parsePositiveInt(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

/** Parses an optional non-negative integer. Undefined means absent; null means present but invalid. */
function parseOptionalNonNegativeInt(value: string | null): number | null | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const params = request.nextUrl.searchParams;

    const page = parsePositiveInt(params.get("page"), 1);
    if (page === null) return validationErrorResponse("page must be a positive integer");

    const limit = parsePositiveInt(params.get("limit"), DEFAULT_LIMIT);
    if (limit === null) return validationErrorResponse("limit must be a positive integer");
    if (limit > MAX_LIMIT) return validationErrorResponse(`limit must not exceed ${MAX_LIMIT}`);

    const startLedger = parseOptionalNonNegativeInt(params.get("startLedger"));
    if (startLedger === null) return validationErrorResponse("startLedger must be a non-negative integer");

    const endLedger = parseOptionalNonNegativeInt(params.get("endLedger"));
    if (endLedger === null) return validationErrorResponse("endLedger must be a non-negative integer");

    if (startLedger !== undefined && endLedger !== undefined && startLedger > endLedger) {
      return validationErrorResponse("startLedger must not exceed endLedger", 422);
    }

    const status = params.get("status");
    if (status !== null && !STATUS_VALUES.includes(status as StatusFilter)) {
      return validationErrorResponse(`status must be one of: ${STATUS_VALUES.join(", ")}`);
    }

    const contractId = params.get("contractId") ?? undefined;
    const txHash = params.get("txHash") ?? undefined;

    const where: Prisma.EventWhereInput = {};
    if (contractId) where.contractId = contractId;
    if (txHash) where.txHash = txHash;
    if (status) where.status = status;
    if (startLedger !== undefined || endLedger !== undefined) {
      const ledgerFilter: Prisma.IntFilter = {};
      if (startLedger !== undefined) ledgerFilter.gte = startLedger;
      if (endLedger !== undefined) ledgerFilter.lte = endLedger;
      where.ledger = ledgerFilter;
    }

    const [events, total] = await Promise.all([
      db.event.findMany({
        where,
        orderBy: [{ ledger: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.event.count({ where }),
    ]);

    return NextResponse.json({
      events,
      pagination: {
        page,
        limit,
        total,
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    return toErrorResponse(error, { fallbackMessage: "Events query failed" });
  }
}
