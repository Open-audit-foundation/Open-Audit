import type { RouteDoc } from "../types";

/** GET+DELETE /api/webhooks/{id} */
export const routeDoc: RouteDoc = {
  get: {
    summary: "Get webhook subscription",
    operationId: "getWebhook",
    tags: ["Webhooks"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: {
      "200": {
        description: "Subscription",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/WebhookSubscription" },
          },
        },
      },
      "401": { description: "Missing or invalid API key" },
      "404": { description: "Webhook subscription not found" },
      "429": { description: "Rate limit exceeded" },
      "500": { description: "Internal server error" },
    },
  },
  delete: {
    summary: "Delete webhook subscription",
    operationId: "deleteWebhook",
    tags: ["Webhooks"],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: {
      "200": {
        description: "Deleted",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                message: { type: "string" },
              },
            },
          },
        },
      },
      "401": { description: "Missing or invalid API key" },
      "404": { description: "Webhook subscription not found" },
      "429": { description: "Rate limit exceeded" },
      "500": { description: "Internal server error" },
    },
  },
};
