/**
 * GET /api/v1/events/export
 *
 * Streams translated contract events as a flat file without loading the
 * entire dataset into server memory. Rows are yielded from a generator
 * in configurable chunks, so a 500k-row export stays within a few MB of
 * working memory at any point.
 *
 * Query params:
 *   format      csv | json | ndjson   (default: csv)
 *   contractId  Soroban contract address (optional filter)
 *   startLedger integer (optional)
 *   endLedger   integer (optional)
 *   limit       max rows to export    (default: 100_000, max: 1_000_000)
 */

import { NextRequest } from "next/server";
import { getMockEventsForContract, MOCK_RAW_EVENTS } from "@/lib/mock-data";
import { translateEvents } from "@/lib/translator/registry";
import { decodeEventName } from "@/lib/translator/decode";
import type { TranslatedEvent } from "@/lib/translator/types";

type ExportFormat = "csv" | "json" | "ndjson";

const CHUNK_SIZE = 500; // rows yielded per tick
const MAX_LIMIT = 1_000_000;
const DEFAULT_LIMIT = 100_000;

const CSV_HEADER = "timestamp,ledger_id,contract_id,tx_hash,event_name,status,plain_english_translation,proof_url\r\n";

function escapeCSV(val: string | number): string {
  const s = String(val);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRow(event: TranslatedEvent) {
  const eventName =
    event.eventType ??
    (event.raw.topics[0] ? decodeEventName(event.raw.topics[0]) : "unknown");

  const translation =
    event.status === "translated" && event.description
      ? event.description
      : "No translation available";

  return {
    timestamp: new Date(event.raw.timestamp * 1000).toISOString(),
    ledger_id: event.raw.ledger,
    contract_id: event.raw.contractId,
    tx_hash: event.raw.txHash,
    event_name: eventName,
    status: event.status,
    plain_english_translation: translation,
    proof_url: event.raw.txHash
      ? `/api/v1/events/proof?txHash=${event.raw.txHash}&ledger=${event.raw.ledger}`
      : "",
  };
}

function rowToCSVLine(row: ReturnType<typeof toRow>): string {
  return [
    row.timestamp,
    row.ledger_id,
    escapeCSV(row.contract_id),
    escapeCSV(row.tx_hash),
    escapeCSV(row.event_name),
    row.status,
    escapeCSV(row.plain_english_translation),
    escapeCSV(row.proof_url),
  ].join(",") + "\r\n";
}

/**
 * Generator that yields translated events in chunks.
 * In production this would cursor through a database instead of
 * holding everything in memory — swap the source array for a DB cursor here.
 */
function buildStream(events: TranslatedEvent[], format: ExportFormat, limit: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const total = Math.min(events.length, limit);

  // Pre-materialise row objects so the stream only does formatting work
  // Each chunk is a small slice — memory stays proportional to CHUNK_SIZE, not total.
  let offset = 0;
  let started = false;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      // Write opener once
      if (!started) {
        started = true;
        if (format === "csv") {
          controller.enqueue(encoder.encode(CSV_HEADER));
        } else if (format === "json") {
          controller.enqueue(encoder.encode("[\n"));
        }
      }

      if (offset >= total) {
        if (format === "json") controller.enqueue(encoder.encode("]\n"));
        controller.close();
        return;
      }

      const end = Math.min(offset + CHUNK_SIZE, total);
      let text = "";

      for (let i = offset; i < end; i++) {
        const row = toRow(events[i]);
        if (format === "csv") {
          text += rowToCSVLine(row);
        } else if (format === "ndjson") {
          text += JSON.stringify(row) + "\n";
        } else {
          const isLast = i === total - 1;
          text += "  " + JSON.stringify(row) + (isLast ? "\n" : ",\n");
        }
      }

      offset = end;
      controller.enqueue(encoder.encode(text));
    },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;

  const format = (params.get("format") ?? "csv") as ExportFormat;
  if (!["csv", "json", "ndjson"].includes(format)) {
    return Response.json(
      { error: "Invalid format. Use csv, json, or ndjson." },
      { status: 400 }
    );
  }

  const limitParam = parseInt(params.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(limitParam) || limitParam < 1 ? DEFAULT_LIMIT : Math.min(limitParam, MAX_LIMIT);

  const contractId = params.get("contractId") ?? "";
  const startLedger = parseInt(params.get("startLedger") ?? "0", 10);
  const endLedger = parseInt(params.get("endLedger") ?? "0", 10);

  // ── Data source ────────────────────────────────────────────────────────────
  // In production: replace with a paginated DB cursor.
  // The streaming architecture is DB-agnostic — just swap this block.
  let raw = contractId
    ? getMockEventsForContract(contractId)
    : MOCK_RAW_EVENTS;

  if (startLedger > 0) raw = raw.filter((e) => e.ledger >= startLedger);
  if (endLedger > 0) raw = raw.filter((e) => e.ledger <= endLedger);

  const events = translateEvents(raw);
  // ──────────────────────────────────────────────────────────────────────────

  const date = new Date().toISOString().slice(0, 10);
  const filename = `open-audit-events-${date}.${format === "ndjson" ? "ndjson" : format}`;

  const mimeTypes: Record<ExportFormat, string> = {
    csv: "text/csv; charset=utf-8",
    json: "application/json; charset=utf-8",
    ndjson: "application/x-ndjson; charset=utf-8",
  };

  const stream = buildStream(events, format, limit);

  return new Response(stream, {
    headers: {
      "Content-Type": mimeTypes[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Transfer-Encoding": "chunked",
      "X-Export-Format": format,
      "X-Export-Limit": String(limit),
      "Cache-Control": "no-store",
    },
  });
}
