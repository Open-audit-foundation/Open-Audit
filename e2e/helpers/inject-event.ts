import type { RawEvent, TranslatedEvent } from "../../lib/translator/types";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/**
 * Posts a mock Soroban RPC raw event to the E2E test hook, which translates
 * and broadcasts it over the WebSocket server.
 */
export async function injectMockSorobanEvent(
  rawEvent: RawEvent
): Promise<TranslatedEvent> {
  const response = await fetch(`${BASE_URL}/e2e/inject-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rawEvent),
  });

  if (!response.ok) {
    throw new Error(`Failed to inject event: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as TranslatedEvent;
}
