/**
 * useEventTranslator
 *
 * React hook that translates a batch of raw Soroban events into
 * TranslatedEvents without blocking the main rendering thread.
 *
 * Strategy
 * ────────
 * • Small batches  (≤ 500 events): translated synchronously — no overhead.
 * • Large batches  (> 500 events): handed off to a Web Worker so the browser
 *   can keep painting while the work happens off-thread.  The translated
 *   results are then loaded into state via `loadInChunks` (requestAnimationFrame
 *   batches) to avoid a large synchronous state update on the way back.
 *
 * Fallback
 * ────────
 * If `Worker` is not available (SSR, older browsers, test environments) the
 * hook falls back transparently to the synchronous path.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useDeferredValue,
} from "react";
import { translateEvents } from "../translator/registry";
import type { RawEvent, TranslatedEvent, TranslationBlueprint } from "../translator/types";
import { loadInChunks, CHUNK_THRESHOLD } from "../utils/chunkLoader";
import type {
  TranslateRequest,
  TranslateResponse,
} from "../workers/eventTranslator.worker";

function isWorkerSupported(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

interface UseEventTranslatorOptions {
  rawEvents: RawEvent[];
  customBlueprints?: Map<string, TranslationBlueprint>;
}

interface UseEventTranslatorResult {
  /** The translated events ready for rendering. */
  events: TranslatedEvent[];
  /** True while a large batch is being processed or loaded into state. */
  isTranslating: boolean;
}

export function useEventTranslator({
  rawEvents,
  customBlueprints,
}: UseEventTranslatorOptions): UseEventTranslatorResult {
  const [events, setEvents] = useState<TranslatedEvent[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);

  // Defer the raw events so React can commit cheaper renders first.
  const deferredRawEvents = useDeferredValue(rawEvents);

  const workerRef = useRef<Worker | null>(null);
  const cancelChunkRef = useRef<(() => void) | null>(null);

  /** Lazily create (or reuse) the worker. */
  const getWorker = useCallback((): Worker | null => {
    if (!isWorkerSupported()) return null;
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../workers/eventTranslator.worker.ts", import.meta.url),
        { type: "module" },
      );
    }
    return workerRef.current;
  }, []);

  useEffect(() => {
    // Cancel any in-flight chunk load from a previous render.
    cancelChunkRef.current?.();

    if (deferredRawEvents.length === 0) {
      setEvents([]);
      setIsTranslating(false);
      return;
    }

    // ── Small batch: translate synchronously ──────────────────────────────
    if (deferredRawEvents.length <= CHUNK_THRESHOLD || !isWorkerSupported()) {
      setIsTranslating(true);
      const translated = translateEvents(deferredRawEvents, customBlueprints);
      const cancel = loadInChunks<TranslatedEvent>(
        translated,
        (chunk) => setEvents((prev) => [...prev, ...chunk]),
        () => setIsTranslating(false),
      );
      cancelChunkRef.current = cancel;
      return () => cancel();
    }

    // ── Large batch: offload to Web Worker ────────────────────────────────
    const worker = getWorker();
    if (!worker) {
      // Fallback: sync translation + chunked state load.
      setIsTranslating(true);
      const translated = translateEvents(deferredRawEvents, customBlueprints);
      setEvents([]);
      const cancel = loadInChunks<TranslatedEvent>(
        translated,
        (chunk) => setEvents((prev) => [...prev, ...chunk]),
        () => setIsTranslating(false),
      );
      cancelChunkRef.current = cancel;
      return () => cancel();
    }

    setIsTranslating(true);
    setEvents([]); // Clear stale results before new batch.

    const requestId = `${Date.now()}-${Math.random()}`;

    const handleMessage = (e: MessageEvent<TranslateResponse>) => {
      if (e.data.type !== "TRANSLATE_RESULT" || e.data.requestId !== requestId) return;

      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);

      // Load the translated results into state in RAF batches.
      const cancel = loadInChunks<TranslatedEvent>(
        e.data.translated,
        (chunk) => setEvents((prev) => [...prev, ...chunk]),
        () => setIsTranslating(false),
      );
      cancelChunkRef.current = cancel;
    };

    const handleError = () => {
      // Worker error: fall back to synchronous translation.
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      const translated = translateEvents(deferredRawEvents, customBlueprints);
      setEvents(translated);
      setIsTranslating(false);
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);

    const request: TranslateRequest = {
      type: "TRANSLATE",
      requestId,
      events: deferredRawEvents,
    };
    worker.postMessage(request);

    return () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      cancelChunkRef.current?.();
    };
  }, [deferredRawEvents, customBlueprints, getWorker]);

  // Terminate the worker when the hook unmounts.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  return { events, isTranslating };
}
