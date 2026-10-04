import type { OperationDoc } from "../types";

/** GET /api/v1/events */
export const routeDoc: OperationDoc = {
  summary: "List translated contract events",
  description:
    "Paginated listing of persisted events with optional filters for " +
    "contractId, txHash, status, and ledger range.",
  operationId: "listEvents",
  tags: ["Events"],
  parameters: [
    {
      name: "contractId",
      in: "query",
      schema: { type: "string" },
      description: "Soroban contract address filter",
    },
    {
      name: "txHash",
      in: "query",
      schema: { type: "string" },
      description: "Transaction hash filter",
    },
    {
      name: "status",
      in: "query",
      schema: { type: "string", enum: ["translated", "cryptic"] },
    },
    {
      name: "startLedger",
      in: "query",
      schema: { type: "integer", minimum: 0 },
    },
    {
      name: "endLedger",
      in: "query",
      schema: { type: "integer", minimum: 0 },
    },
    {
      name: "page",
      in: "query",
      schema: { type: "integer", minimum: 1, default: 1 },
    },
    {
      name: "limit",
      in: "query",
      schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
    },
  ],
  responses: {
    "200": {
      description: "Paginated event list",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              events: {
                type: "array",
                items: { $ref: "#/components/schemas/Event" },
              },
              pagination: { $ref: "#/components/schemas/PaginationPage" },
            },
          },
        },
      },
    },
    "400": { description: "Invalid query parameters" },
    "401": { description: "Missing or invalid API key" },
    "422": { description: "startLedger exceeds endLedger" },
    "429": { description: "Rate limit exceeded" },
    "500": { description: "Internal server error" },
  },
};
