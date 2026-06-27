/**
 * Webhook delivery engine.
 *
 * Responsibilities:
 * - Fan-out translated events to matching active subscriptions
 * - POST with HMAC-SHA256 signature header within 5-second timeout
 * - Retry up to 3 times on failure with exponential backoff (1s, 4s, 16s)
 * - Deactivate subscription after 3 consecutive failures
 * - Record every attempt in WebhookDelivery
 */

import { db } from "@/lib/db/client";
import { signPayload } from "./sign";

/** Maximum delivery timeout per attempt (ms). */
const DELIVERY_TIMEOUT_MS = 5_000;

/** Backoff delays in milliseconds for attempt 1, 2, 3. Index 0 = first retry. */
const BACKOFF_MS = [1_000, 4_000, 16_000] as const;

/** Maximum consecutive failures before a subscription is deactivated. */
const MAX_ATTEMPTS = 3;

export interface TranslatedEventPayload {
  id: string;
  contractId: string;
  ledger: number;
  timestamp: number;
  txHash: string;
  status: string;
  eventType?: string | null;
  description?: string | null;
  blueprintName?: string | null;
  [key: string]: unknown;
}

/**
 * Sleeps for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Performs a single HTTP POST attempt to a webhook URL.
 *
 * @returns HTTP status code, or null if the request timed out / threw.
 */
async function postOnce(
  url: string,
  body: string,
  signature: string
): Promise<{ statusCode: number | null; success: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Open-Audit-Signature": signature,
        "User-Agent": "Open-Audit-Webhook/1.0",
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const success = response.status >= 200 && response.status < 300;
    return { statusCode: response.status, success };
  } catch (err) {
    clearTimeout(timer);
    // Network error or abort — no HTTP status code available
    return { statusCode: null, success: false };
  }
}

/**
 * Delivers a translated event to a single subscription with retries.
 *
 * On success or after MAX_ATTEMPTS failures a WebhookDelivery row is written.
 * On max failures the subscription is deactivated (active = false).
 */
async function deliverToSubscription(
  subscriptionId: string,
  url: string,
  secret: string,
  payload: TranslatedEventPayload
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);

  let lastStatusCode: number | null = null;
  let succeeded = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { statusCode, success } = await postOnce(url, body, signature);
    lastStatusCode = statusCode;

    if (success) {
      succeeded = true;
      // Record the successful delivery
      await db.webhookDelivery.create({
        data: {
          subscriptionId,
          payload: payload as object,
          statusCode,
          success: true,
          attemptCount: attempt,
        },
      });
      return;
    }

    // Not the last attempt — wait before retrying
    if (attempt < MAX_ATTEMPTS) {
      await sleep(BACKOFF_MS[attempt - 1]);
    }
  }

  // All attempts exhausted — record failure
  await db.webhookDelivery.create({
    data: {
      subscriptionId,
      payload: payload as object,
      statusCode: lastStatusCode,
      success: false,
      attemptCount: MAX_ATTEMPTS,
    },
  });

  if (!succeeded) {
    // Deactivate the subscription to stop further deliveries
    await db.webhookSubscription.update({
      where: { id: subscriptionId },
      data: { active: false },
    });

    console.warn(
      `[webhook-deliver] Subscription ${subscriptionId} deactivated after ${MAX_ATTEMPTS} consecutive failures (last status: ${lastStatusCode ?? "timeout"})`
    );
  }
}

/**
 * Fan-out a translated event to all active subscriptions that match its
 * contractId. Each delivery runs independently so one failure does not
 * block others.
 *
 * This function is designed to be called from the indexer's handleEvent()
 * pipeline. Errors are caught per-subscription and logged without
 * propagating to the caller.
 */
export async function dispatchWebhooks(
  payload: TranslatedEventPayload
): Promise<void> {
  const subscriptions = await db.webhookSubscription.findMany({
    where: {
      contractId: payload.contractId,
      active: true,
    },
    select: {
      id: true,
      url: true,
      secret: true,
    },
  });

  if (subscriptions.length === 0) return;

  // Fire deliveries concurrently — we don't await the overall race so that
  // the indexer pipeline is not blocked beyond the 5-second timeout already
  // embedded in postOnce().
  await Promise.allSettled(
    subscriptions.map((sub) =>
      deliverToSubscription(sub.id, sub.url, sub.secret, payload).catch(
        (err) => {
          console.error(
            `[webhook-deliver] Unhandled error for subscription ${sub.id}:`,
            err
          );
        }
      )
    )
  );
}
