export async function triggerWebhooksForEvent(_event: unknown): Promise<void> {
  // Webhook delivery is not wired up in this build yet.
  // Keep the persistence pipeline non-blocking until a concrete queue worker is added.
}
