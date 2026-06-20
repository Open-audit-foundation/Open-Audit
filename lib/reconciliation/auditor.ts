/**
 * Reconciliation Auditor
 *
 * Records audit trail of all reconciliation actions for administrator oversight
 * and compliance tracking.
 */

import { db } from "@/lib/db/client";

export interface AuditLogEntry {
  jobId: string;
  action: "detected" | "fixed" | "flagged" | "verified";
  eventId?: string;
  ledger?: number;
  details?: any;
  metadata?: any;
}

/**
 * Record an audit log entry
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        jobId: entry.jobId,
        action: entry.action,
        eventId: entry.eventId,
        ledger: entry.ledger,
        details: entry.details || {},
        metadata: entry.metadata,
      },
    });

    console.log(
      `[audit] Logged ${entry.action} for job ${entry.jobId}${entry.eventId ? ` (event: ${entry.eventId})` : ""}`
    );
  } catch (error) {
    console.error("[audit] Failed to record log entry:", error);
  }
}

/**
 * Get audit logs for a reconciliation job
 */
export async function getJobAuditLog(jobId: string) {
  const logs = await db.auditLog.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
  });

  return logs;
}

/**
 * Get audit logs by action type
 */
export async function getAuditLogsByAction(action: string, limit = 100) {
  const logs = await db.auditLog.findMany({
    where: { action },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return logs;
}

/**
 * Get audit statistics for a date range
 */
export async function getAuditStatistics(startDate: Date, endDate: Date) {
  const logs = await db.auditLog.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  const stats = {
    total: logs.length,
    detected: logs.filter((l) => l.action === "detected").length,
    fixed: logs.filter((l) => l.action === "fixed").length,
    flagged: logs.filter((l) => l.action === "flagged").length,
    verified: logs.filter((l) => l.action === "verified").length,
  };

  return stats;
}

/**
 * Get events with discrepancies from audit trail
 */
export async function getDiscrepancyEvents() {
  const logs = await db.auditLog.findMany({
    where: {
      action: "detected",
      eventId: { not: null },
    },
    distinct: ["eventId"],
    orderBy: { createdAt: "desc" },
  });

  return logs.map((log) => ({
    eventId: log.eventId,
    issue: log.details?.issue,
    action: log.details?.action,
    detectedAt: log.createdAt,
  }));
}

/**
 * Generate an audit trail report
 */
export async function generateAuditReport(jobId: string) {
  const logs = await getJobAuditLog(jobId);

  // Group by action
  const byAction = {
    detected: logs.filter((l) => l.action === "detected"),
    fixed: logs.filter((l) => l.action === "fixed"),
    flagged: logs.filter((l) => l.action === "flagged"),
    verified: logs.filter((l) => l.action === "verified"),
  };

  // Count discrepancies by type
  const discrepanciesByType = new Map<string, number>();
  for (const log of byAction.detected) {
    if (log.details?.issue) {
      const count = discrepanciesByType.get(log.details.issue) || 0;
      discrepanciesByType.set(log.details.issue, count + 1);
    }
  }

  // Build report
  const report = {
    jobId,
    generatedAt: new Date().toISOString(),
    summary: {
      totalActions: logs.length,
      discrepanciesDetected: byAction.detected.length,
      discrepanciesFixed: byAction.fixed.length,
      flaggedForReview: byAction.flagged.length,
      verifiedLedgers: byAction.verified.length,
    },
    discrepanciesByType: Object.fromEntries(discrepanciesByType),
    timeline: logs.map((log) => ({
      timestamp: log.createdAt,
      action: log.action,
      eventId: log.eventId,
      ledger: log.ledger,
      details: log.details,
    })),
  };

  return report;
}

/**
 * Export audit logs to JSON
 */
export async function exportAuditLogs(
  startDate: Date,
  endDate: Date,
  format: "json" | "csv" = "json"
) {
  const logs = await db.auditLog.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (format === "csv") {
    // Convert to CSV
    const headers = ["timestamp", "jobId", "action", "eventId", "ledger", "details"];
    const rows = logs.map((log) => [
      log.createdAt.toISOString(),
      log.jobId,
      log.action,
      log.eventId || "",
      log.ledger || "",
      JSON.stringify(log.details),
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    return csv;
  } else {
    // Return as JSON
    return {
      exportedAt: new Date().toISOString(),
      dateRange: { startDate, endDate },
      count: logs.length,
      logs,
    };
  }
}
