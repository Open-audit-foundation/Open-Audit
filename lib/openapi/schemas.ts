/**
 * Reusable OpenAPI component schemas shared across routeDocs.
 * Property names mirror actual JSON responses / Prisma models.
 */

export const errorSchema = {
  type: "object",
  properties: {
    error: { type: "string" },
    message: { type: "string" },
  },
} as const;

export const eventSchema = {
  type: "object",
  description: "A persisted Soroban contract event (Prisma Event model).",
  properties: {
    id: { type: "string" },
    contractId: { type: "string" },
    ledger: { type: "integer" },
    timestamp: { type: "integer", description: "Unix timestamp (seconds)" },
    txHash: { type: "string" },
    topics: {
      type: "array",
      items: { type: "string" },
      description: "Topic strings stored as JSON",
    },
    data: { type: "string", description: "Hex-encoded event data" },
    description: { type: "string", nullable: true },
    status: { type: "string", enum: ["translated", "cryptic"] },
    blueprintName: { type: "string", nullable: true },
    eventType: { type: "string", nullable: true },
    schemaVersion: { type: "string", nullable: true },
    executionDagId: { type: "string", nullable: true },
    source: {
      type: "string",
      nullable: true,
      // nullable admits the type; enum must explicitly admit the legacy value too.
      enum: ["live", "historical", null],
      description: "live indexer vs historical backfill; null = pre-migration",
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export const paginationPageSchema = {
  type: "object",
  properties: {
    page: { type: "integer" },
    limit: { type: "integer" },
    total: { type: "integer" },
    hasMore: { type: "boolean" },
  },
} as const;

export const paginationCursorSchema = {
  type: "object",
  properties: {
    nextCursor: { type: "string", nullable: true },
    hasMore: { type: "boolean" },
    limit: { type: "integer" },
  },
} as const;

export const webhookSubscriptionSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    url: { type: "string", format: "uri" },
    contractId: { type: "string", nullable: true },
    isActive: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

/** Matches GET /api/v1/stats payload fields exactly. */
export const statsSchema = {
  type: "object",
  properties: {
    totalEvents: { type: "integer" },
    translatedCount: { type: "integer" },
    crypticCount: { type: "integer" },
    translationRate: { type: "integer", description: "Percent 0–100" },
    deadLetterQueueSize: { type: "integer" },
    lastIndexedLedger: { type: "integer", nullable: true },
    degraded: { type: "boolean" },
    error: { type: "string" },
  },
} as const;

export const componentSchemas = {
  Error: errorSchema,
  Event: eventSchema,
  PaginationPage: paginationPageSchema,
  PaginationCursor: paginationCursorSchema,
  WebhookSubscription: webhookSubscriptionSchema,
  Stats: statsSchema,
} as const;
