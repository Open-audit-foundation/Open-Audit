import type { OperationDoc } from "../types";

/** POST /api/v1/events/search */
export const routeDoc: OperationDoc = {
  summary: "Search events",
  description:
    "Full-text description search plus filters, with cursor pagination.",
  operationId: "searchEvents",
  tags: ["Events"],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Case-insensitive description substring",
            },
            contractId: { type: "string" },
            eventType: { type: "string" },
            startLedger: { type: "integer", minimum: 0 },
            endLedger: { type: "integer", minimum: 0 },
            status: { type: "string", enum: ["translated", "cryptic"] },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            cursor: {
              type: "string",
              description: "Event id cursor from a prior response",
            },
          },
        },
      },
    },
  },
  responses: {
    "200": {
      description: "Search results with next cursor",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              events: {
                type: "array",
                items: { $ref: "#/components/schemas/Event" },
              },
              pagination: { $ref: "#/components/schemas/PaginationCursor" },
            },
          },
        },
      },
    },
    "400": { description: "Invalid JSON body or parameters" },
    "401": { description: "Missing or invalid API key" },
    "429": { description: "Rate limit exceeded" },
    "500": { description: "Internal server error" },
  },
};
