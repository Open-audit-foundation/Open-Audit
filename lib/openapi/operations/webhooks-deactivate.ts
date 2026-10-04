import type { OperationDoc } from "../types";

/** POST /api/webhooks/{id}/deactivate */
export const routeDoc: OperationDoc = {
  summary: "Deactivate webhook subscription",
  description: "Deactivates an active subscription without deleting it.",
  operationId: "deactivateWebhook",
  tags: ["Webhooks"],
  parameters: [
    { name: "id", in: "path", required: true, schema: { type: "string" } },
  ],
  responses: {
    "200": {
      description: "Deactivated",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
              subscription: { $ref: "#/components/schemas/WebhookSubscription" },
            },
          },
        },
      },
    },
    "401": { description: "Missing or invalid API key" },
    "404": { description: "Webhook subscription not found" },
    "409": { description: "Subscription is already deactivated" },
    "429": { description: "Rate limit exceeded" },
    "500": { description: "Internal server error" },
  },
};
