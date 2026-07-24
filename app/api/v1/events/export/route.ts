/**
 * GET /api/v1/events/export
 *
 * Streams translated contract events as a flat file without loading the
 * entire dataset into server memory. Rows are yielded from a database
 * cursor in configurable chunks, so a 500k-row export stays within a few
 * MB of working memory at any point.
 *
 * Query params:
 *   format      csv | json | ndjson   (default: csv)
 *   contractId  Soroban contract address (optional filter)
 *   startLedger integer (optional)
 *   endLedger   integer (optional)
 *   limit       max rows to export    (default: 100_000, max: 1_000_000)
 */

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db/client";
import { decodeEventName } from "@/lib/translator/decode";
import type { TranslatedEvent, TranslationStatus } from "@/lib/translator/types";

type ExportFormat = "csv" | "json" | "ndjson";

/** The Event columns we need to build an export row. */
type ExportEventRow = {
  id: string;
  contractId: string;
  ledger: number;
  timestamp: number;
  txHash: string;
  topics: Prisma.JsonValue;
  data: string;
  description: string | null;
  status: string;
  blueprintName: string | null;
  eventType: string | null;
};

const CHUNK_SIZE = 500; // rows fetched from the DB and flushed per tick
const MAX_LIMIT = 1_000_000;
const DEFAULT_LIMIT = 100_000;

const CSV_HEADER = "timestamp,ledger_id,contract_id,tx_hash,event_name,status,plain_english_translation,proof_url\r\n";

function escapeCSV(val: string | number): string {
  const s = String(val);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Maps a persisted Event row onto the TranslatedEvent shape the row
 * formatter expects. Translation fields are already stored on the row by
 * the indexer, so no re-translation happens here.
 */
function rowToTranslatedEvent(row: ExportEventRow): TranslatedEvent {
  return {
    raw: {
      id: row.id,
      contractId: row.contractId,
      topics: Array.isArray(row.topics) ? (row.topics as string[]) : [],
      data: row.data,
      ledger: row.ledger,
      timestamp: row.timestamp,
      txHash: row.txHash,
    },
    description: row.description,
    status: (row.status as TranslationStatus) ?? "cryptic",
    blueprintName: row.blueprintName,
    eventType: row.eventType,
    schemaVersion: null,
  };
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
 * Cursors through the Event table in ascending (ledger, id) order, yielding
 * one page of rows at a time. Keyset pagination on the unique `id` keeps
 * memory bounded to CHUNK_SIZE regardless of how large the result set is,
 * and avoids the growing-offset cost of skip/take pagination.
 */
async function* fetchEventPages(
  where: Prisma.EventWhereInput,
  limit: number
): AsyncGenerator<ExportEventRow[]> {
  let remaining = limit;
  let cursorId: string | undefined;

  while (remaining > 0) {
    const take = Math.min(CHUNK_SIZE, remaining);

    const page = (await db.event.findMany({
      where,
      orderBy: [{ ledger: "asc" }, { id: "asc" }],
      take,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: {
        id: true,
        contractId: true,
        ledger: true,
        timestamp: true,
        txHash: true,
        topics: true,
        data: true,
        description: true,
        status: true,
        blueprintName: true,
        eventType: true,
      },
    })) as ExportEventRow[];

    if (page.length === 0) return;

    yield page;

    remaining -= page.length;
    cursorId = page[page.length - 1].id;

    // A short page means the table is exhausted — stop before an empty query.
    if (page.length < take) return;
  }
}

/**
 * Wraps the DB page generator in a ReadableStream that formats each chunk
 * on demand. Backpressure is handled by the stream: the next page is only
 * fetched when the consumer pulls, so at most one page is resident at a time.
 */
function buildStream(
  pages: AsyncGenerator<ExportEventRow[]>,
  format: ExportFormat
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let started = false;
  let closed = false;
  let firstJsonRow = true; // tracks comma placement for the JSON array

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Write opener once, before the first data chunk.
        if (!started) {
          started = true;
          if (format === "csv") {
            controller.enqueue(encoder.encode(CSV_HEADER));
          } else if (format === "json") {
            controller.enqueue(encoder.encode("[\n"));
          }
        }

        const { value: page, done } = await pages.next();

        if (done || !page) {
          if (!closed) {
            closed = true;
            if (format === "json") {
              controller.enqueue(encoder.encode(firstJsonRow ? "]\n" : "\n]\n"));
            }
            controller.close();
          }
          return;
        }

        let text = "";
        for (const dbRow of page) {
          const row = toRow(rowToTranslatedEvent(dbRow));
          if (format === "csv") {
            text += rowToCSVLine(row);
          } else if (format === "ndjson") {
            text += JSON.stringify(row) + "\n";
          } else {
            text += (firstJsonRow ? "  " : ",\n  ") + JSON.stringify(row);
            firstJsonRow = false;
          }
        }

        controller.enqueue(encoder.encode(text));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      // Consumer went away — let the generator release its DB resources.
      await pages.return(undefined);
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
  // Build the Prisma filter from the request params. Rows are streamed
  // straight from the Event table via a keyset cursor (see fetchEventPages).
  const where: Prisma.EventWhereInput = {};
  if (contractId) where.contractId = contractId;

  const ledgerFilter: Prisma.IntFilter = {};
  if (!isNaN(startLedger) && startLedger > 0) ledgerFilter.gte = startLedger;
  if (!isNaN(endLedger) && endLedger > 0) ledgerFilter.lte = endLedger;
  if (ledgerFilter.gte !== undefined || ledgerFilter.lte !== undefined) {
    where.ledger = ledgerFilter;
  }

  const pages = fetchEventPages(where, limit);
  const stream = buildStream(pages, format);
  // ──────────────────────────────────────────────────────────────────────────

  const date = new Date().toISOString().slice(0, 10);
  const filename = `open-audit-events-${date}.${format === "ndjson" ? "ndjson" : format}`;

  const mimeTypes: Record<ExportFormat, string> = {
    csv: "text/csv; charset=utf-8",
    json: "application/json; charset=utf-8",
    ndjson: "application/x-ndjson; charset=utf-8",
  };

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
