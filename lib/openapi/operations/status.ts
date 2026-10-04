import type { OperationDoc } from "../types";

/** GET /api/status */
export const routeDoc: OperationDoc = {
  summary: "Comprehensive system status",
  description:
    "Parallel health checks for Stellar RPC, database, Redis, and worker " +
    "heartbeat, plus recent indexer metrics. Returns HTTP 200 for healthy/" +
    "degraded and 503 when overall status is down.",
  operationId: "getStatus",
  tags: ["System"],
  responses: {
    "200": {
      description: "Status payload (overall healthy or degraded)",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["healthy", "degraded", "down"] },
              timestamp: { type: "string", format: "date-time" },
              components: {
                type: "object",
                properties: {
                  stellarRpc: { type: "object", additionalProperties: true },
                  database: { type: "object", additionalProperties: true },
                  redis: { type: "object", additionalProperties: true },
                  worker: { type: "object", additionalProperties: true },
                },
              },
              metrics: {
                type: "object",
                properties: {
                  eventsIndexedLast1h: { type: "integer" },
                  eventsIndexedLast24h: { type: "integer" },
                  translationSuccessRate1h: { type: "number" },
                  translationSuccessRate24h: { type: "number" },
                  averageTranslationLatencyMs: { type: "number" },
                  activeWebSocketConnections: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
    "401": { description: "Missing or invalid API key" },
    "429": { description: "Rate limit exceeded" },
    "503": { description: "Overall status is down" },
  },
};
