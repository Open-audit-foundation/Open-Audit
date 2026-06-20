/**
 * Reconciliation Report API
 * GET /api/reconciliation/report/[jobId]
 */

import { NextRequest, NextResponse } from "next/server";
import { generateAuditReport, getJobAuditLog } from "@/lib/reconciliation/auditor";

export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const { jobId } = params;
    const format = new URL(request.url).searchParams.get("format") || "json";

    // Generate report
    const report = await generateAuditReport(jobId);

    if (format === "json") {
      return NextResponse.json(report);
    } else if (format === "html") {
      // Generate HTML version
      const html = generateHTMLReport(report);
      return new NextResponse(html, {
        headers: { "Content-Type": "text/html" },
      });
    } else {
      return NextResponse.json({ error: 'Format must be "json" or "html"' }, { status: 400 });
    }
  } catch (error) {
    console.error("[reconciliation/report] Error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Generate HTML version of the audit report
 */
function generateHTMLReport(report: any): string {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Reconciliation Report - ${report.jobId}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; }
          .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
          table { border-collapse: collapse; width: 100%; margin: 20px 0; }
          th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
          th { background: #4CAF50; color: white; }
          .positive { color: green; }
          .negative { color: red; }
        </style>
      </head>
      <body>
        <h1>Reconciliation Report</h1>
        <p><strong>Job ID:</strong> ${report.jobId}</p>
        <p><strong>Generated:</strong> ${report.generatedAt}</p>

        <div class="summary">
          <h2>Summary</h2>
          <ul>
            <li>Total Actions: ${report.summary.totalActions}</li>
            <li class="negative">Discrepancies Detected: ${report.summary.discrepanciesDetected}</li>
            <li class="positive">Discrepancies Fixed: ${report.summary.discrepanciesFixed}</li>
            <li>Flagged for Review: ${report.summary.flaggedForReview}</li>
            <li class="positive">Verified Ledgers: ${report.summary.verifiedLedgers}</li>
          </ul>
        </div>

        <h2>Discrepancies by Type</h2>
        <table>
          <tr>
            <th>Issue Type</th>
            <th>Count</th>
          </tr>
          ${Object.entries(report.discrepanciesByType)
            .map(([type, count]) => `<tr><td>${type}</td><td class="negative">${count}</td></tr>`)
            .join("")}
        </table>

        <h2>Audit Trail</h2>
        <table>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Event ID</th>
            <th>Ledger</th>
            <th>Details</th>
          </tr>
          ${report.timeline
            .map(
              (entry: any) =>
                `<tr>
                  <td>${entry.timestamp}</td>
                  <td>${entry.action}</td>
                  <td>${entry.eventId || "-"}</td>
                  <td>${entry.ledger || "-"}</td>
                  <td>${JSON.stringify(entry.details || {})}</td>
                </tr>`
            )
            .join("")}
        </table>
      </body>
    </html>
  `;

  return html;
}
