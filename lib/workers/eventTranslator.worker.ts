/**
 * Event Translator Web Worker
 *
 * Offloads the CPU-intensive work of XDR decoding and translation-registry
 * lookups off the main browser rendering thread.  When more than 500 raw
 * events arrive at once the main thread posts them here; this worker
 * translates the full batch and posts the results back.
 *
 * The worker is instantiated with the `{ type: 'module' }` option so it can
 * import from the existing translator modules without duplication.
 *
 * Message protocol
 * ────────────────
 * Incoming  →  TranslateRequest
 * Outgoing  ←  TranslateResponse
 */

import { translateEvents } from "../translator/registry";
import type { RawEvent, TranslatedEvent } from "../translator/types";

export interface TranslateRequest {
  type: "TRANSLATE";
  /** Unique identifier so callers can match responses to requests. */
  requestId: string;
  events: RawEvent[];
}

export interface TranslateResponse {
  type: "TRANSLATE_RESULT";
  requestId: string;
  translated: TranslatedEvent[];
}

self.onmessage = (event: MessageEvent<TranslateRequest>) => {
  const { type, requestId, events } = event.data;

  if (type !== "TRANSLATE") return;

  try {
    // translateEvents is a pure synchronous function — safe to run in a worker.
    const translated = translateEvents(events);

    const response: TranslateResponse = {
      type: "TRANSLATE_RESULT",
      requestId,
      translated,
    };

    self.postMessage(response);
  } catch (err) {
    // Surface errors back to the main thread so the hook can fall back.
    self.postMessage({
      type: "TRANSLATE_ERROR",
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
