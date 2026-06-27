-- Migration: add_webhook_delivery_system
-- Replaces the previous WebhookSubscription/WebhookDelivery models with the
-- spec-compliant versions that include HMAC secrets, statusCode, and proper
-- relation naming.

-- Drop old tables if they exist from any prior prototype
DROP TABLE IF EXISTS "WebhookDelivery";
DROP TABLE IF EXISTS "WebhookSubscription";

-- WebhookSubscription
CREATE TABLE "WebhookSubscription" (
    "id"         TEXT NOT NULL,
    "url"        TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "secret"     TEXT NOT NULL,
    "active"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookSubscription_contractId_idx" ON "WebhookSubscription"("contractId");
CREATE INDEX "WebhookSubscription_active_idx"     ON "WebhookSubscription"("active");

-- WebhookDelivery
CREATE TABLE "WebhookDelivery" (
    "id"             TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "payload"        JSONB NOT NULL,
    "statusCode"     INTEGER,
    "success"        BOOLEAN NOT NULL,
    "attemptCount"   INTEGER NOT NULL DEFAULT 1,
    "deliveredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDelivery_subscriptionId_idx" ON "WebhookDelivery"("subscriptionId");

ALTER TABLE "WebhookDelivery"
    ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId")
    REFERENCES "WebhookSubscription"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
