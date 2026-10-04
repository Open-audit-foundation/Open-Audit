import type { OperationDoc } from "../types";

/** GET /api/v1/events/export */
export const routeDoc: OperationDoc = {
  summary: "Stream event export",
  description:
    "Streams events as csv, json, or ndjson without loading the full " +
    "result set into memory. Uses keyset pagination under the hood.",
  operationId: "exportEvents",
  tags: ["Events"],
  parameters: [
    {
      name: "format",
      in: "query",
      schema: { type: "string", enum: ["csv", "json", "ndjson"], default: "csv" },
    },
    { name: "contractId", in: "query", schema: { type: "string" } },
    { name: "startLedger", in: "query", schema: { type: "integer" } },
    { name: "endLedger", in: "query", schema: { type: "integer" } },
    {
      name: "limit",
      in: "query",
      schema: { type: "integer", minimum: 1, maximum: 1000000, default: 100000 },
    },
  ],
  responses: {
    "200": {
      description: "Streaming export body",
      content: {
        "text/csv": { schema: { type: "string" } },
        "application/json": {
          schema: {
            type: "array",
            items: {
              type: "object",
              required: [
                "timestamp",
                "ledger_id",
                "contract_id",
                "tx_hash",
                "event_name",
                "status",
                "plain_english_translation",
                "proof_url",
                "schema_version",
              ],
              properties: {
                timestamp: { type: "string", format: "date-time" },
                ledger_id: { type: "integer" },
                contract_id: { type: "string" },
                tx_hash: { type: "string" },
                event_name: { type: "string" },
                status: { type: "string" },
                plain_english_translation: { type: "string" },
                proof_url: {
                  type: "string",
                  description:
                    "Relative proof URL, or an empty string when no transaction hash is available.",
                },
                schema_version: {
                  type: "string",
                  description: "Persisted schema version, or an empty string for legacy rows.",
                },
              },
            },
          },
        },
        "application/x-ndjson": { schema: { type: "string" } },
      },
    },
    "400": { description: "Invalid format" },
    "401": { description: "Missing or invalid API key" },
    "429": { description: "Rate limit exceeded" },
  },
};
