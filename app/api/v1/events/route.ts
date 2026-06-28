/**
 * GET /api/v1/events
 *
 * Server-side filtered and paginated event listing.
 *
 * Query params:
 *   contractId  — filter by Soroban contract address
 *   eventType   — filter by event topic/type (case-insensitive contains)
 *   network     — "testnet" | "mainnet" (informational, stored contextually)
 *   page        — 1-indexed page number (default: 1)
 *   limit       — page size (default: 20, max: 100)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { MOCK_RAW_EVENTS } from "@/lib/mock-data";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;

  const contractId = searchParams.get("contractId") || undefined;
  const eventType = searchParams.get("eventType") || undefined;
  const network = searchParams.get("network") || "testnet";

  const rawPage = parseInt(searchParams.get("page") || "1", 10);
  const rawLimit = parseInt(searchParams.get("limit") || "20", 10);
  const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
  const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 20 : rawLimit));
  const skip = (page - 1) * limit;

  // Build Prisma where clause
  const where: Record<string, unknown> = {};
  if (contractId) {
    where.contractId = contractId;
  }
  if (eventType) {
    where.eventType = {
      contains: eventType,
      mode: "insensitive",
    };
  }

  try {
    const [totalCount, events] = await Promise.all([
      db.event.count({ where }),
      db.event.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip,
        take: limit,
      }),
    ]);

    // Map database Event model to the client-facing RawEvent shape
    const formattedEvents = events.map((ev) => ({
      id: ev.id,
      contractId: ev.contractId,
      topics: (ev.topics as string[]) || [],
      data: ev.data,
      ledger: ev.ledger,
      timestamp: ev.timestamp,
      txHash: ev.txHash,
      // Pass through translated fields so the client can display them
      description: ev.description,
      status: ev.status,
      eventType: ev.eventType,
      blueprintName: ev.blueprintName,
    }));

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    return NextResponse.json({
      events: formattedEvents,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      meta: { network },
    });
  } catch (error: unknown) {
    console.error("Failed to query database events, falling back to mock data:", error);

    // ── Fallback: use in-memory MOCK_RAW_EVENTS when DB is unavailable ──
    let filtered = [...MOCK_RAW_EVENTS];

    if (contractId) {
      filtered = filtered.filter((e) => e.contractId === contractId);
    }
    if (eventType) {
      filtered = filtered.filter((e) => {
        const firstTopic = e.topics[0] || "";
        const name = firstTopic.includes("74726e73")
          ? "Transfer"
          : firstTopic.includes("6d696e74")
            ? "Mint"
            : firstTopic.includes("6275726e")
              ? "Burn"
              : firstTopic.includes("7377617073")
                ? "Swap"
                : "Unknown";
        return name.toLowerCase().includes(eventType.toLowerCase());
      });
    }

    const totalCount = filtered.length;
    const paginated = filtered.slice(skip, skip + limit);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    return NextResponse.json({
      events: paginated,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      meta: { network, fallback: true },
    });
  }
}
