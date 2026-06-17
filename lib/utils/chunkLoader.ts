/**
 * chunkLoader
 *
 * Splits a large array into batches and schedules each batch via
 * `requestAnimationFrame`, yielding control back to the browser between
 * batches.  This prevents the main rendering thread from locking up when
 * more than CHUNK_THRESHOLD items are loaded into React state at once.
 *
 * Usage:
 *   const cancel = loadInChunks(bigArray, (chunk) => {
 *     setEvents((prev) => [...prev, ...chunk]);
 *   });
 *   // Call cancel() to abort remaining batches (e.g. on component unmount).
 */

/** Items processed per animation-frame tick. */
const CHUNK_SIZE = 100;

/**
 * Minimum array length that triggers chunked loading.
 * Arrays at or below this size are committed synchronously — no overhead.
 */
export const CHUNK_THRESHOLD = 500;

/**
 * Loads `items` into state in batches of `chunkSize`, scheduling each batch
 * via `requestAnimationFrame` so the browser can paint between batches.
 *
 * @param items      Full dataset to load.
 * @param onChunk    Called once per batch with the current slice.
 * @param onComplete Optional callback fired after all batches complete.
 * @param chunkSize  Items per batch (defaults to CHUNK_SIZE = 100).
 * @returns A cancel function — call it to abort remaining batches.
 */
export function loadInChunks<T>(
  items: T[],
  onChunk: (chunk: T[]) => void,
  onComplete?: () => void,
  chunkSize: number = CHUNK_SIZE,
): () => void {
  // For small datasets commit everything in one synchronous call.
  if (items.length <= CHUNK_THRESHOLD) {
    onChunk(items);
    onComplete?.();
    return () => {};
  }

  let index = 0;
  let rafId: number;
  let cancelled = false;

  function scheduleNext() {
    if (cancelled) return;

    rafId = requestAnimationFrame(() => {
      if (cancelled) return;

      const end = Math.min(index + chunkSize, items.length);
      onChunk(items.slice(index, end));
      index = end;

      if (index < items.length) {
        scheduleNext();
      } else {
        onComplete?.();
      }
    });
  }

  scheduleNext();

  return () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
  };
}
