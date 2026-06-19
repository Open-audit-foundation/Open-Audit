/**
 * GET /api/portfolio/performance
 *
 * Returns aggregated portfolio performance metrics across all tracked contracts.
 * Query params:
 *   - from: Unix timestamp (seconds) — start of window (default: 24h ago)
 *   - to:   Unix timestamp (seconds) — end of window   (default: now)
 */

import { NextRequest, NextResponse } from "next/server";
import { MOCK_RAW_EVENTS } from "@/lib/mock-data";

export interface PortfolioPerformance {
  totalEvents: number;
  translatedEvents: number;
  crypticEvents: number;
  uniqueContracts: number;
  topContracts: { contractId: string; eventCount: number }[];
  window: { from: number; to: number };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
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

  const events = MOCK_RAW_EVENTS.filter((e) => e.timestamp >= from && e.timestamp <= to);

  const contractCounts = new Map<string, number>();
  for (const event of events) {
    contractCounts.set(event.contractId, (contractCounts.get(event.contractId) ?? 0) + 1);
  }

  const topContracts = Array.from(contractCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([contractId, eventCount]) => ({ contractId, eventCount }));

  const result: PortfolioPerformance = {
    totalEvents: events.length,
    translatedEvents: 0, // placeholder — real impl would run translateEvents()
    crypticEvents: 0,
    uniqueContracts: contractCounts.size,
    topContracts,
    window: { from, to },
  };

  return NextResponse.json(result);
}
