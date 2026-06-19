/**
 * GET /api/portfolio/[address]/performance
 *
 * Returns performance metrics for a specific wallet address.
 * Query params:
 *   - from: Unix timestamp (seconds) — start of window (default: 24h ago)
 *   - to:   Unix timestamp (seconds) — end of window   (default: now)
 */

import { NextRequest, NextResponse } from "next/server";
import { MOCK_RAW_EVENTS } from "@/lib/mock-data";

export interface AddressPerformance {
  address: string;
  totalEvents: number;
  uniqueContracts: number;
  recentActivity: { contractId: string; eventId: string; timestamp: number }[];
  window: { from: number; to: number };
}

interface RouteContext {
  params: { address: string };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { address } = context.params;

  if (!address || typeof address !== "string" || address.trim().length === 0) {
    return NextResponse.json({ error: "Missing or invalid address parameter" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const from = parseInt(searchParams.get("from") ?? String(now - 86400), 10);
  const to = parseInt(searchParams.get("to") ?? String(now), 10);

  if (isNaN(from) || isNaN(to) || from > to) {
    return NextResponse.json(
      { error: "Invalid time window: 'from' must be <= 'to' and both must be valid Unix timestamps" },
      { status: 400 }
    );
  }

  // Filter events involving the address in topics (case-insensitive substring match)
  const addrLower = address.toLowerCase();
  const events = MOCK_RAW_EVENTS.filter(
    (e) =>
      e.timestamp >= from &&
      e.timestamp <= to &&
      e.topics.some((t) => t.toLowerCase().includes(addrLower))
  );

  const contractIds = new Set(events.map((e) => e.contractId));
  const recentActivity = events
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10)
    .map((e) => ({ contractId: e.contractId, eventId: e.id, timestamp: e.timestamp }));

  const result: AddressPerformance = {
    address,
    totalEvents: events.length,
    uniqueContracts: contractIds.size,
    recentActivity,
    window: { from, to },
  };

  return NextResponse.json(result);
}
