/**
 * GET /api/v1/bridge/matches
 *
 * Returns a paginated list of cross-chain transfer matches.
 *
 * Query params:
 *   status  — filter by "pending" | "matched" | "unmatched" | "disputed"
 *   chain   — filter by mint chain (e.g. "ethereum")
 *   limit   — page size (default 25, max 100)
 *   cursor  — ISO timestamp for cursor-based pagination (before this time)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;

  const status   = searchParams.get("status") ?? undefined;
  const chain    = searchParams.get("chain") ?? undefined;
  const rawLimit = parseInt(searchParams.get("limit") ?? "25", 10);
  const limit    = Math.min(Math.max(rawLimit, 1), 100);
  const cursor   = searchParams.get("cursor") ?? undefined;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (chain)  where.mintChain = chain;
  if (cursor) where.createdAt = { lt: new Date(cursor) };

  const matches = await db.crossChainMatch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      events: {
        select: {
          id: true,
          chain: true,
          eventType: true,
          txHash: true,
          blockNumber: true,
          timestamp: true,
          amount: true,
          token: true,
          sender: true,
          recipient: true,
          destinationChain: true,
          destinationProof: true,
        },
      },
    },
  });

  const nextCursor =
    matches.length === limit
      ? matches[matches.length - 1].createdAt.toISOString()
      : null;

  return NextResponse.json({
    data: matches,
    pagination: {
      limit,
      nextCursor,
      hasMore: nextCursor !== null,
    },
  });
}
