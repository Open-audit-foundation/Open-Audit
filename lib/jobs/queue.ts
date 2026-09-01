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
}
