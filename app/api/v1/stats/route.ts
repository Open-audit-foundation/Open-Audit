import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getCachedStats, setCachedStats } from "@/lib/cache/redisCache";

export async function GET(): Promise<NextResponse> {
  try {
    let cached: Awaited<ReturnType<typeof getCachedStats>> = null;
    try {
      cached = await getCachedStats();
    } catch {
      cached = null;
    }
    if (cached) {
      return NextResponse.json(cached);
    }

    const [totalEvents, translatedCount, crypticCount, dlqSize, lastCursor] =
      await Promise.all([
        db.event.count(),
        db.event.count({ where: { status: "translated" } }),
        db.event.count({ where: { status: "cryptic" } }),
        db.deadLetterEvent.count(),
        db.indexerCursor.findFirst({
          select: { lastLedger: true },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

    const translationRate =
      totalEvents > 0 ? Math.round((translatedCount / totalEvents) * 100) : 0;

    const payload = {
      totalEvents,
      translatedCount,
      crypticCount,
      translationRate,
      deadLetterQueueSize: dlqSize,
      lastIndexedLedger: lastCursor?.lastLedger ?? null,
    };

    await setCachedStats(payload);

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[stats] Failed to compute stats:", error);

    const stale = await Promise.resolve(getCachedStats()).catch(() => null);
    if (stale) {
      return NextResponse.json({
        ...stale,
        degraded: true,
        error: "Serving stale data; database unreachable",
      });
    }

    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 503 }
    );
  }
}
