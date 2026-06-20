/**
 * Export utilities for the Open-Audit event feed.
 *
 * Converts the currently filtered list of translated events into either
 * a downloadable CSV or JSON file, containing the five required audit columns:
 *   Timestamp | Ledger ID | Contract ID | Event Name | Plain English Translation
 */

import type { TranslatedEvent } from "./translator/types";
import { decodeEventName } from "./translator/decode";

/** Shape of one row in the exported dataset. */
export interface ExportRow {
  timestamp: string;
  ledger_id: number;
  contract_id: string;
  event_name: string;
  plain_english_translation: string;
}

/**
 * Converts an ISO timestamp string from a Unix seconds value.
 */
function toISOTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * Maps a TranslatedEvent to the standard ExportRow format.
 */
function toExportRow(event: TranslatedEvent): ExportRow {
  const eventName =
    event.eventType ??
    (event.raw.topics[0] ? decodeEventName(event.raw.topics[0]) : "unknown");

  const translation =
    event.status === "translated" && event.description
      ? event.description
      : "No translation available";

  return {
    timestamp: toISOTimestamp(event.raw.timestamp),
    ledger_id: event.raw.ledger,
    contract_id: event.raw.contractId,
    event_name: eventName,
    plain_english_translation: translation,
  };
}

/**
 * Serialises a list of translated events to a CSV string.
 *
 * Values that contain commas, double-quotes, or newlines are quoted and
 * internal double-quotes are escaped per RFC 4180.
 */
export function eventsToCSV(events: TranslatedEvent[]): string {
  const headers: Array<keyof ExportRow> = [
    "timestamp",
    "ledger_id",
    "contract_id",
    "event_name",
    "plain_english_translation",
  ];

  function escapeCSV(value: string | number): string {
    const str = String(value);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const headerLine = headers.join(",");
  const rows = events.map(function (event) {
    const row = toExportRow(event);
    return headers.map(function (h) {
      return escapeCSV(row[h]);
    }).join(",");
  });

  return [headerLine, ...rows].join("\r\n");
}

/**
 * Serialises a list of translated events to a pretty-printed JSON string.
 * Each element in the array is one ExportRow object.
 */
export function eventsToJSON(events: TranslatedEvent[]): string {
  const rows = events.map(toExportRow);
  return JSON.stringify(rows, null, 2);
}

/**
 * Triggers a browser file download for the given content.
 *
 * @param content   - The file content as a string.
 * @param filename  - The suggested filename including extension.
 * @param mimeType  - MIME type of the content.
 */
export function triggerDownload(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Generates a filename with the current UTC date, e.g.
 * "open-audit-events-2024-06-17.csv"
 */
export function buildFilename(format: "csv" | "json" | "ndjson"): string {
  const date = new Date().toISOString().slice(0, 10);
  return `open-audit-events-${date}.${format}`;
}

/**
 * Builds a URL to the streaming export endpoint.
 * Used for large datasets that should bypass in-browser blob creation.
 */
export function buildExportUrl(
  format: "csv" | "json" | "ndjson",
  options: { contractId?: string; startLedger?: number; endLedger?: number; limit?: number } = {}
): string {
  const params = new URLSearchParams({ format });
  if (options.contractId) params.set("contractId", options.contractId);
  if (options.startLedger) params.set("startLedger", String(options.startLedger));
  if (options.endLedger) params.set("endLedger", String(options.endLedger));
  if (options.limit) params.set("limit", String(options.limit));
  return `/api/v1/events/export?${params.toString()}`;
}
