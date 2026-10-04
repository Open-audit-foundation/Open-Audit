import type { OperationDoc } from "../types";
import type { RouteDoc } from "../types";

/** GET+POST /api/webhooks */
export const routeDoc: RouteDoc = {
  get: {
    summary: "List webhook subscriptions",
    description: "Returns webhook subscriptions, optionally filtered by contractId / isActive.",
    operationId: "listWebhooks",
    tags: ["Webhooks"],
    parameters: [
      { name: "contractId", in: "query", schema: { type: "string" } },
      { name: "isActive", in: "query", schema: { type: "string", enum: ["true", "false"] } },
    ],
    responses: {
      "200": {
        description: "Subscription list",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                count: { type: "integer" },
                subscriptions: {
                  type: "array",
                  items: { $ref: "#/components/schemas/WebhookSubscription" },
                },
              },
            },
          },
        },
      },
      "401": { description: "Missing or invalid API key" },
      "429": { description: "Rate limit exceeded" },
      "500": { description: "Internal server error" },
    },
  },
  post: {
    summary: "Create webhook subscription",
    description:
      "Registers a new webhook URL after SSRF validation. Returns the " +
      "subscription plus a one-time plaintext signing secret.",
    operationId: "createWebhook",
    tags: ["Webhooks"],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string", format: "uri" },
              contractId: { type: "string", nullable: true },
            },
          },
        },
      },
    },
    responses: {
      "201": {
        description: "Subscription created",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                subscription: { $ref: "#/components/schemas/WebhookSubscription" },
                secret: { type: "string", description: "HMAC signing secret (shown once)" },
              },
            },
          },
        },
      },
      "400": { description: "Validation or SSRF failure" },
      "401": { description: "Missing or invalid API key" },
      "429": { description: "Rate limit exceeded" },
      "500": { description: "Internal server error" },
    },
  },
};
