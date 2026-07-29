/**
 * GET /api/metrics
 *
 * Prometheus-compatible scrape endpoint.
 *
 * Authentication: Bearer token via the METRICS_TOKEN environment variable.
 * If METRICS_TOKEN is not set the endpoint is open (useful for local dev).
 *
 * Gauges that depend on live DB state (DLQ size, last indexed ledger) are
 * refreshed on every scrape so Prometheus always receives current values.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  register,
  deadLetterQueueSize,
  lastIndexedLedger,
} from "@/lib/metrics";

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function isAuthorized(request: NextRequest): boolean {
  const token = process.env.METRICS_TOKEN;
  // If no token is configured, allow all scrapes (local / dev environments).
  if (!token) return true;

  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${token}`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Refresh DB-backed gauges so values are current at scrape time.
  try {
    const [dlqCount, cursor] = await Promise.all([
      db.deadLetterEvent.count(),
      db.indexerCursor.findFirst({
        select: { lastLedger: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    deadLetterQueueSize.set(dlqCount);
    if (cursor?.lastLedger != null) {
      lastIndexedLedger.set(cursor.lastLedger);
    }
  } catch (err) {
    // Non-fatal: return stale/zero gauge values rather than a 500.
    console.warn("[metrics] DB refresh failed:", err);
  }

  const metrics = await register.metrics();

  return new Response(metrics, {
    status: 200,
    headers: {
      "Content-Type": register.contentType,
      // Tell Prometheus / CDN not to cache the scrape response.
      "Cache-Control": "no-store",
    },
  });
}
