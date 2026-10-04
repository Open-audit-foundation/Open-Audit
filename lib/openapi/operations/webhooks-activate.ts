import type { OperationDoc } from "../types";

/** POST /api/webhooks/{id}/activate */
export const routeDoc: OperationDoc = {
  summary: "Activate webhook subscription",
  description: "Reactivates a previously deactivated subscription.",
  operationId: "activateWebhook",
  tags: ["Webhooks"],
  parameters: [
    { name: "id", in: "path", required: true, schema: { type: "string" } },
  ],
  responses: {
    "200": {
      description: "Activated",
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
    "409": { description: "Subscription is already active" },
    "429": { description: "Rate limit exceeded" },
    "500": { description: "Internal server error" },
  },
};
