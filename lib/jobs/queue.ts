/**
 * Job Queue stub
 *
 * Referenced by lib/translator/persistence.ts. Provides a no-op
 * implementation until a full job queue (Bull/BullMQ) is wired up.
 */

export interface QueuedEvent {
  id: string;
  contractId: string;
  [key: string]: unknown;
}

/**
 * Triggers registered webhooks for a persisted event.
 * Currently a no-op — implement when webhook delivery is added.
 */
export async function triggerWebhooksForEvent(
  _event: QueuedEvent | Record<string, unknown>
): Promise<void> {
  // No-op stub — webhook delivery not yet implemented.
 * Webhook Delivery Queue
 *
 * Implements signed webhook delivery with exponential-backoff retries,
 * 4xx no-retry semantics, and automatic subscription deactivation after
 * exhausting all retry attempts.
 *
 * Exports consumed by the integration tests:
 *   - WebhookPayload
 *   - deliverWebhookWithRetries
 *   - computeWebhookSignature   (re-export from signing)
 *   - buildSignatureHeader      (re-export from signing)
 *   - triggerWebhooksForEvent
 */

import { db } from "../db/client";
import {
  computeWebhookSignature,
  buildSignatureHeader,
} from "../webhooks/signing";

// Re-export so callers can import everything from this module.
export { computeWebhookSignature, buildSignatureHeader };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the JSON body delivered to a webhook endpoint. */
export interface WebhookPayload {
  eventId: string;
  contractId: string;
  ledger: number;
  timestamp: number;
  txHash: string;
  topics: string[];
  data: string;
  description: string | null;
  status: string;
  blueprintName: string | null;
  eventType: string | null;
  createdAt: string;
}

/** Result returned by a single deliverWebhookWithRetries call. */
export interface DeliveryResult {
  succeeded: boolean;
  httpStatus: number | null;
  attempts: number;
}

/** Options controlling retry / timeout behaviour. */
export interface DeliveryOptions {
  /** Maximum total attempts (first attempt + retries). Default: 5 */
  maxAttempts?: number;
  /** Initial backoff in milliseconds before the second attempt. Default: 1000 */
  initialBackoffMs?: number;
  /** Per-request fetch timeout in milliseconds. Default: 10_000 */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Core delivery logic
// ---------------------------------------------------------------------------

/**
 * Delivers a signed webhook payload to a single URL with exponential backoff.
 *
 * Retry policy:
 *  - 5xx / network errors: retry up to maxAttempts total
 *  - 4xx: fail immediately, no retry
 *  - 2xx / 3xx: success
 *
 * The raw JSON body is fixed before the first attempt and reused on every
 * retry so that the signature remains identical across all attempts.
 */
export async function deliverWebhookWithRetries(
  subscriptionId: string,
  url: string,
  secret: string,
  payload: WebhookPayload,
  options: DeliveryOptions = {}
): Promise<DeliveryResult> {
  const maxAttempts = options.maxAttempts ?? 5;
  const initialBackoffMs = options.initialBackoffMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 10_000;

  // Serialise once — signature must be stable across retries.
  const rawBody = JSON.stringify(payload);
  const signatureHeader = buildSignatureHeader(rawBody, secret);

  let attempts = 0;
  let lastHttpStatus: number | null = null;

  while (attempts < maxAttempts) {
    attempts += 1;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Open-Audit-Webhook/1.0",
            "X-Open-Audit-Signature": signatureHeader,
          },
          body: rawBody,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      lastHttpStatus = response.status;

      // 2xx → success
      if (response.status >= 200 && response.status < 300) {
        return { succeeded: true, httpStatus: lastHttpStatus, attempts };
      }

      // 4xx → permanent failure, do not retry
      if (response.status >= 400 && response.status < 500) {
        return { succeeded: false, httpStatus: lastHttpStatus, attempts };
      }

      // 5xx / anything else → fall through to retry
    } catch {
      // Network error / timeout — treat as retriable
      lastHttpStatus = null;
    }

    // Exponential backoff before the next attempt (skip after last)
    if (attempts < maxAttempts) {
      const backoff = initialBackoffMs * 2 ** (attempts - 1);
      await sleep(backoff);
    }
  }

  return { succeeded: false, httpStatus: lastHttpStatus, attempts };
}

// ---------------------------------------------------------------------------
// Event-driven fan-out
// ---------------------------------------------------------------------------

/**
 * Finds all active webhook subscriptions that match the given event's
 * contractId (exact match or null/"subscribe to all"), then delivers the
 * payload to each one in parallel.
 *
 * Side effects:
 *  - Creates a WebhookDelivery row for every subscription attempted.
 *  - Deactivates the subscription when all retry attempts are exhausted
 *    (i.e. max retries hit on 5xx / network). A 4xx failure does NOT
 *    deactivate the subscription.
 */
export async function triggerWebhooksForEvent(
  event: {
    id: string;
    contractId: string;
    ledger: number;
    timestamp: number;
    txHash: string;
    topics: unknown;
    data: string;
    description?: string | null;
    status: string;
    blueprintName?: string | null;
    eventType?: string | null;
    createdAt?: Date | string;
  },
  options: DeliveryOptions = {}
): Promise<void> {
  // Query active subscriptions that are either global (contractId IS NULL)
  // or bound to this specific contract.
  let subscriptions: Array<{
    id: string;
    url: string;
    secretHash: string;
    isActive: boolean;
  }>;

  try {
    subscriptions = await db.webhookSubscription.findMany({
      where: {
        isActive: true,
        OR: [
          { contractId: null },
          { contractId: event.contractId },
        ],
      },
    });
  } catch (err) {
    console.error("[webhooks] Failed to query subscriptions:", err);
    return;
  }

  if (subscriptions.length === 0) {
    return;
  }

  // Build the payload once for all subscribers.
  const payload: WebhookPayload = {
    eventId: event.id,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.timestamp,
    txHash: event.txHash,
    topics: Array.isArray(event.topics) ? (event.topics as string[]) : [],
    data: event.data,
    description: event.description ?? null,
    status: event.status,
    blueprintName: event.blueprintName ?? null,
    eventType: event.eventType ?? null,
    createdAt:
      event.createdAt instanceof Date
        ? event.createdAt.toISOString()
        : (event.createdAt ?? new Date().toISOString()),
  };

  // Deliver to all matching subscriptions concurrently.
  await Promise.all(
    subscriptions.map((sub) =>
      deliverToSubscription(sub, event.id, payload, options)
    )
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function deliverToSubscription(
  sub: { id: string; url: string; secretHash: string; isActive: boolean },
  eventId: string,
  payload: WebhookPayload,
  options: DeliveryOptions
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 5;

  let result: DeliveryResult;
  try {
    result = await deliverWebhookWithRetries(
      sub.id,
      sub.url,
      sub.secretHash,
      payload,
      options
    );
  } catch (err) {
    console.error(`[webhooks] Unexpected error delivering to ${sub.url}:`, err);
    result = { succeeded: false, httpStatus: null, attempts: 1 };
  }

  // Persist the delivery record.
  try {
    await db.webhookDelivery.create({
      data: {
        subscriptionId: sub.id,
        eventId,
        httpStatus: result.httpStatus,
        succeeded: result.succeeded,
        attempts: result.attempts,
      },
    });
  } catch (err) {
    console.error("[webhooks] Failed to persist delivery record:", err);
  }

  // Deactivate the subscription only when we exhausted all retry attempts
  // (i.e. 5xx / network failure used up every attempt).
  // 4xx failures stop at attempt 1 but should NOT deactivate.
  const exhaustedRetries =
    !result.succeeded &&
    result.attempts >= maxAttempts &&
    result.httpStatus !== null &&
    result.httpStatus >= 500;

  const networkExhausted =
    !result.succeeded &&
    result.attempts >= maxAttempts &&
    result.httpStatus === null;

  if (exhaustedRetries || networkExhausted) {
    try {
      await db.webhookSubscription.update({
        where: { id: sub.id },
        data: { isActive: false },
      });
      // Reflect the change in the in-memory object so callers that hold a
      // reference (e.g. test assertions) see the updated state.
      sub.isActive = false;
    } catch (err) {
      console.error(
        `[webhooks] Failed to deactivate subscription ${sub.id}:`,
        err
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
