/**
 * GET /api/retention/status
 *
 * Returns the current state of the data-retention scheduler and a preview
 * of how many rows are eligible for archival under the current policy.
 */

import { NextResponse } from "next/server";
import { getRetentionSchedulerStatus } from "@/lib/retention/scheduler";
import { getRetentionDays } from "@/lib/retention/archiver";
import { db } from "@/lib/db/client";

export async function GET(): Promise<NextResponse> {
  try {
    const retentionDays = getRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const [schedulerStatus, eligibleCount, totalCount] = await Promise.all([
      Promise.resolve(getRetentionSchedulerStatus()),
      db.event.count({ where: { createdAt: { lt: cutoff } } }),
      db.event.count(),
    ]);

    return NextResponse.json({
      scheduler: schedulerStatus,
      policy: {
        retentionDays,
        cutoffDate: cutoff.toISOString(),
      },
      stats: {
        totalEvents: totalCount,
        eligibleForArchival: eligibleCount,
        retainedEvents: totalCount - eligibleCount,
      },
    });
  } catch (err) {
    console.error("[retention/status] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
