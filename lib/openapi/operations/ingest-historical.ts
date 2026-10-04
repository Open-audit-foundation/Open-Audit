import type { OperationDoc } from "../types";

/** POST /api/ingest-historical — preserved from the original inline routeDoc. */
export const routeDoc: OperationDoc = {
  summary: "Ingest historical ledger range",
  description:
    "Fetches and backfills contract events from a specified historical ledger range " +
    "into the Postgres Event table (the same store used by the live indexer).",
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["contractId", "startSequence", "endSequence"],
          properties: {
            contractId: {
              type: "string",
              description: "The Soroban contract ID to fetch events for.",
            },
            startSequence: {
              type: "integer",
              description: "Starting ledger sequence number (inclusive, >= 1).",
            },
            endSequence: {
              type: "integer",
              description: "Ending ledger sequence number (inclusive, >= startSequence).",
            },
            chunkSize: {
              type: "integer",
              description: "Number of ledgers per RPC call.",
              default: 1000,
            },
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Successful ingestion",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              contractId: { type: "string" },
              range: {
                type: "object",
                properties: {
                  start: { type: "integer" },
                  end: { type: "integer" },
                },
              },
              results: {
                type: "object",
                properties: {
                  totalEvents: { type: "integer" },
                  totalChunks: { type: "integer" },
                  failedEvents: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
    400: { description: "Invalid request parameters" },
    401: { description: "Missing or invalid API key" },
    429: { description: "Rate limit exceeded" },
    500: { description: "Internal server error" },
  },
} as OperationDoc;
