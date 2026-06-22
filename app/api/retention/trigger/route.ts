/**
 * POST /api/retention/trigger
 *
 * Manually triggers an immediate archive-and-purge run outside of the cron
 * schedule.  Intended for admin / maintenance use only — protect with your
 * authentication layer in production.
 *
 * Optional JSON body:
 *   { "dryRun": true }  — counts eligible rows without writing or deleting
 */

import { NextRequest, NextResponse } from "next/server";
import { triggerRetentionNow } from "@/lib/retention/scheduler";
import { getRetentionDays } from "@/lib/retention/archiver";
import { db } from "@/lib/db/client";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;

    if (dryRun) {
      const retentionDays = getRetentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const eligible = await db.event.count({ where: { createdAt: { lt: cutoff } } });

      return NextResponse.json({
        dryRun: true,
        retentionDays,
        cutoffDate: cutoff.toISOString(),
        eligibleRows: eligible,
        message: `Dry run complete. ${eligible} row(s) would be archived and deleted.`,
      });
    }

    const result = await triggerRetentionNow();

    if (result.success) {
      return NextResponse.json({
        ...result,
        message: `Archive run complete. ${result.rowsArchived} row(s) archived, ${result.rowsDeleted} deleted.`,
      });
    }

    return NextResponse.json({ error: result.error }, { status: 500 });
  } catch (err) {
    console.error("[retention/trigger] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
