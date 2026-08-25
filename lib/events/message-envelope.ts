import type { RawEvent, TranslatedEvent } from "../translator/types";

/** Message published by the indexer worker to Redis pub/sub. */
export interface EventMessageEnvelope {
  type: "event";
  timestamp: number;
  workerId: string;
  raw: RawEvent;
  translated: TranslatedEvent;
}

export function serializeEventMessage(payload: EventMessageEnvelope): string {
  return JSON.stringify(payload);
}

export function createEventMessage(
  workerId: string,
  raw: RawEvent,
  translated: TranslatedEvent
): EventMessageEnvelope {
  return {
    type: "event",
    timestamp: Date.now(),
    workerId,
    raw,
    translated,
  };
}

/**
 * Parse a Redis pub/sub payload into an event envelope.
 * Returns null for invalid or non-event messages.
 */
export function parseEventMessage(payload: string): EventMessageEnvelope | null {
  try {
    const parsed = JSON.parse(payload) as Partial<EventMessageEnvelope>;
    if (parsed.type !== "event" || !parsed.translated || !parsed.raw) {
      return null;
    }
    return parsed as EventMessageEnvelope;
  } catch {
    return null;
  }
}

/** Extract the WebSocket payload expected by the dashboard live feed. */
export function toWebSocketPayload(envelope: EventMessageEnvelope): TranslatedEvent {
  return envelope.translated;
}
