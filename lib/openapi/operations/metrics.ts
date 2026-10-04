import type { OperationDoc } from "../types";

/** GET /api/metrics */
export const routeDoc: OperationDoc = {
  summary: "Prometheus metrics scrape",
  description:
    "Returns Prometheus text exposition format. Requires middleware API key. " +
    "When METRICS_TOKEN is set, also requires Authorization: Bearer <token>.",
  operationId: "getMetrics",
  tags: ["System"],
  // buildOpenApiDocument supplies the configured security requirement.
  // Authorization must use MetricsBearer; OpenAPI ignores it as a parameter.
  responses: {
    "200": {
      description: "Prometheus metrics body",
      content: {
        "text/plain": {
          schema: { type: "string" },
        },
      },
    },
    "401": { description: "Missing API key or invalid metrics bearer token" },
    "429": { description: "Rate limit exceeded" },
  },
};
