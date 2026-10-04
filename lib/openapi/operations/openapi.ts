import type { OperationDoc } from "../types";

/** GET /api/openapi — public OpenAPI 3.0 document. */
export const routeDoc: OperationDoc = {
  summary: "OpenAPI 3.0 specification",
  description:
    "Returns the aggregated OpenAPI 3.0 document describing every route " +
    "under /api that exports a routeDoc. Intended for Swagger UI at /docs.",
  operationId: "getOpenApiSpec",
  tags: ["System"],
  security: [],
  responses: {
    "200": {
      description: "OpenAPI 3.0 document",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["openapi", "info", "paths"],
            properties: {
              openapi: { type: "string", example: "3.0.3" },
              info: { type: "object" },
              paths: { type: "object" },
              components: { type: "object" },
            },
          },
        },
      },
    },
  },
};
