import type { OperationDoc } from "../types";

/** GET /api/v1/stats — public (middleware allowlist). */
export const routeDoc: OperationDoc = {
  summary: "Indexer aggregate statistics",
  description:
    "Returns cached event counts, translation rate, DLQ size, and last " +
    "indexed ledger. Public route (no API key required).",
  operationId: "getStats",
  tags: ["Stats"],
  security: [],
  responses: {
    "200": {
      description: "Stats payload (may include degraded flag when serving stale cache)",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Stats" },
        },
      },
    },
    "503": {
      description: "Database unavailable and no stale cache",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
  },
};
