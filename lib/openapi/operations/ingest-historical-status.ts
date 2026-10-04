import type { OperationDoc } from "../types";

/** GET /api/ingest-historical/status — preserved from the original inline routeDoc. */
export const routeDoc: OperationDoc = {
  summary: "Query historical ingestion status",
  description:
    "Returns cursor progress, event count, and a queryable sample of backfilled " +
    "events for the given contract.  Proves that POST /api/ingest-historical " +
    "data lands in a path readable by the rest of the application.",
  parameters: [
    {
      name: "contractId",
      in: "query",
      required: true,
      schema: { type: "string" },
      description: "Soroban contract address to inspect.",
    },
    {
      name: "startLedger",
      in: "query",
      required: false,
      schema: { type: "integer" },
      description: "Lower ledger bound for the event count and sample.",
    },
    {
      name: "endLedger",
      in: "query",
      required: false,
      schema: { type: "integer" },
      description: "Upper ledger bound for the event count and sample.",
    },
    {
      name: "sampleSize",
      in: "query",
      required: false,
      schema: { type: "integer", default: 10, maximum: 100 },
      description: "Maximum number of events to return as proof of queryability.",
    },
  ],
  responses: {
    200: { description: "Status retrieved successfully" },
    400: { description: "Invalid query parameters" },
    401: { description: "Missing or invalid API key" },
    429: { description: "Rate limit exceeded" },
    500: { description: "Internal server error" },
  },
} as OperationDoc;
