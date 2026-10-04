import type { OperationDoc } from "../types";

/** GET /api/v1/dag */
export const routeDoc: OperationDoc = {
  summary: "Fetch execution DAG",
  description:
    "Look up an execution DAG by txHash, id, or ledger, or list recent " +
    "reentrancy-flagged DAGs when reentrancy=true.",
  operationId: "getExecutionDag",
  tags: ["DAG"],
  parameters: [
    { name: "txHash", in: "query", schema: { type: "string" } },
    { name: "id", in: "query", schema: { type: "string" } },
    { name: "ledger", in: "query", schema: { type: "integer", minimum: 0 } },
    { name: "reentrancy", in: "query", schema: { type: "string", enum: ["true"] } },
    { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }, description: "Only used with reentrancy=true" },
  ],
  responses: {
    "200": {
      description: "DAG object or list of reentrancy DAGs",
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    "400": { description: "Missing or invalid query parameters" },
    "401": { description: "Missing or invalid API key" },
    "404": { description: "DAG not found" },
    "429": { description: "Rate limit exceeded" },
    "500": { description: "Internal server error" },
  },
};
