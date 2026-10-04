import type { OperationDoc } from "../types";

/** GET /api/health */
export const routeDoc: OperationDoc = {
  summary: "Liveness / readiness health check",
  description:
    "Returns process uptime and optional Redis / database / indexer probes. " +
    "Responds 200 when healthy or degraded; 503 when the check itself fails.",
  operationId: "getHealth",
  tags: ["System"],
  responses: {
    "200": {
      description: "Service is healthy or degraded but responding",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["healthy", "degraded"] },
              service: { type: "string" },
              timestamp: { type: "string", format: "date-time" },
              uptime: { type: "number" },
              environment: { type: "string" },
              version: { type: "string" },
              redis: {
                type: "object",
                properties: {
                  connected: { type: "boolean" },
                  error: { type: "string" },
                },
              },
              database: { type: "object", additionalProperties: true },
              indexer: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    "401": { description: "Missing or invalid API key (middleware)" },
    "429": { description: "Rate limit exceeded" },
    "503": {
      description: "Health check failed",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              status: { type: "string", example: "unhealthy" },
              service: { type: "string" },
              error: { type: "string" },
              timestamp: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
  },
};
