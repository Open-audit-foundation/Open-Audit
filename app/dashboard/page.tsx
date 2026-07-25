import { Suspense } from "react";
import type { Metadata } from "next";
import { DashboardClient } from "./DashboardClient";
import { db } from "@/lib/db/client";
import { MOCK_RAW_EVENTS } from "@/lib/mock-data";
import type { RawEvent } from "@/lib/translator/types";

export const metadata: Metadata = {
  title: "Dashboard — Open-Audit",
  description:
    "Translate cryptic Soroban smart contract events into human-readable English. The Google Translate for Stellar.",
};

const INITIAL_EVENT_LIMIT = 100;

/**
 * Loads the initial event batch for the dashboard from the database.
 * Falls back to mock data (with a visible banner in the UI) when
 * DATABASE_URL isn't configured or the query fails, so the dashboard
 * still renders something in local/dev environments without a database.
 */
async function loadInitialEvents(): Promise<{ events: RawEvent[]; usingMockData: boolean }> {
  if (!process.env.DATABASE_URL) {
    return { events: MOCK_RAW_EVENTS, usingMockData: true };
  }

  try {
    const rows = await db.event.findMany({
      orderBy: { ledger: "desc" },
      take: INITIAL_EVENT_LIMIT,
    });

    const events: RawEvent[] = rows.map((row) => ({
      id: row.id,
      contractId: row.contractId,
      topics: row.topics as string[],
      data: row.data,
      ledger: row.ledger,
      timestamp: row.timestamp,
      txHash: row.txHash,
    }));

    return { events, usingMockData: false };
  } catch (error) {
    console.error("[dashboard] Failed to load initial events from database:", error);
    return { events: MOCK_RAW_EVENTS, usingMockData: true };
  }
}

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const { events: initialEvents, usingMockData } = await loadInitialEvents();

  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Event Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Search any Soroban contract to see its events translated into plain English.
        </p>
      </div>

      {/* Suspense is required by next/navigation's useSearchParams in a
          statically-rendered route. */}
      <Suspense fallback={null}>
        <DashboardClient initialEvents={initialEvents} usingMockData={usingMockData} />
      </Suspense>
    </main>
  );
}
