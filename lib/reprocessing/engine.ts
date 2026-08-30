/**
 * Shared Event Reprocessing Engine
 *
 * Provides a generic, bounded batch-processing abstraction for reprocessing
 * event-like records. This is the foundation for both DLQ replay and historical
 * backfill operations.
 *
 * Key Features:
 * - Configurable batch size (prevents unbounded processing)
 * - Dry-run mode (structurally incapable of mutation when enabled)
 * - Deterministic result reporting
 * - Individual item failure handling (one failure doesn't abort the batch)
 * - Separated processing and persistence concerns
 *
 * Design Philosophy:
 * This engine is intentionally generic and does NOT contain DLQ-specific or
 * backfill-specific logic. Persistence decisions, idempotency guarantees, and
 * database operations belong in the handlers that consume this engine.
 */

/**
 * A single item to be reprocessed.
 * Generic enough to represent either a DeadLetterEvent or an Event record.
 */
export interface ReprocessItem<T = unknown> {
  /**
   * Unique identifier for this item.
   * Used for deterministic error reporting and idempotency tracking.
   */
  id: string;

  /**
   * The actual data payload.
   * For DLQ replay: the DeadLetterEvent record.
   * For backfill: the Event record.
   */
  data: T;
}

/**
 * Result of processing a single item.
 */
export interface ProcessItemResult {
  /**
   * The item ID that was processed.
   */
  id: string;

  /**
   * Whether processing succeeded.
   */
  success: boolean;

  /**
   * Error details if processing failed.
   */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };

  /**
   * Optional metadata about the processing result.
   * For DLQ: might include the translated event.
   * For backfill: might include the diff of changed fields.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Callbacks for processing and persisting items.
 *
 * The engine separates processing logic from persistence logic to support
 * dry-run mode and give callers full control over database operations.
 */
export interface ReprocessCallbacks<T> {
  /**
   * Process a single item and return the result.
   *
   * This callback should:
   * - Perform the core processing logic (e.g., re-run translation)
   * - Return success/failure status
   * - NOT perform database writes (that's the persist callback's job)
   *
   * @param item - The item to process
   * @returns Processing result
   */
  process: (item: ReprocessItem<T>) => Promise<ProcessItemResult>;

  /**
   * Persist the results of successfully processed items.
   *
   * This callback is ONLY called when dryRun === false.
   * It receives a batch of successful results and should perform the
   * appropriate database operations (insert, update, delete).
   *
   * @param results - Array of successful processing results
   * @returns Promise that resolves when persistence is complete
   */
  persist: (results: ProcessItemResult[]) => Promise<void>;
}

/**
 * Configuration for the reprocessing engine.
 */
export interface ReprocessConfig {
  /**
   * Maximum number of items to process per batch.
   *
   * The engine will never process more than this number in a single batch.
   * Larger datasets will be split into multiple batches.
   *
   * @default 50
   */
  batchSize?: number;

  /**
   * Dry-run mode: when true, the engine will process items but skip
   * the persist callback entirely.
   *
   * Use this to preview what would happen without making database changes.
   *
   * @default false
   */
  dryRun?: boolean;
}

/**
 * Statistics for a single batch of processing.
 */
export interface BatchStats {
  /**
   * Number of items in this batch.
   */
  total: number;

  /**
   * Number of items successfully processed.
   */
  succeeded: number;

  /**
   * Number of items that failed processing.
   */
  failed: number;

  /**
   * Details of failed items.
   */
  failures: Array<{
    id: string;
    error: string;
    code?: string;
  }>;
}

/**
 * Complete result of a reprocessing run.
 */
export interface ReprocessResult {
  /**
   * Total number of items discovered/attempted.
   */
  totalDiscovered: number;

  /**
   * Total number of items successfully processed.
   */
  totalSucceeded: number;

  /**
   * Total number of items that failed processing.
   */
  totalFailed: number;

  /**
   * Number of batches processed.
   */
  batchCount: number;

  /**
   * Whether this was a dry-run (no persistence).
   */
  dryRun: boolean;

  /**
   * Per-batch statistics.
   */
  batches: BatchStats[];

  /**
   * All failures across all batches.
   */
  failures: Array<{
    id: string;
    error: string;
    code?: string;
  }>;
}

/**
 * Process a collection of items in bounded batches.
 *
 * This is the core reprocessing engine. It:
 * 1. Splits items into batches of configurable size
 * 2. Processes each item via the process callback
 * 3. Persists successful results (unless dry-run is enabled)
 * 4. Collects comprehensive statistics and error details
 *
 * Individual item failures DO NOT abort the batch. All items are processed,
 * and failures are reported in the result.
 *
 * @param items - The items to reprocess
 * @param callbacks - Processing and persistence callbacks
 * @param config - Engine configuration
 * @returns Complete reprocessing result with statistics
 *
 * @example
 * ```typescript
 * const result = await reprocessItems(
 *   deadLetterEvents.map(e => ({ id: e.id, data: e })),
 *   {
 *     process: async (item) => {
 *       const translated = translateEvent(item.data.rawEvent);
 *       return { id: item.id, success: true, metadata: { translated } };
 *     },
 *     persist: async (results) => {
 *       await db.event.createMany({
 *         data: results.map(r => r.metadata.translated)
 *       });
 *     }
 *   },
 *   { batchSize: 50, dryRun: false }
 * );
 * ```
 */
export async function reprocessItems<T>(
  items: ReprocessItem<T>[],
  callbacks: ReprocessCallbacks<T>,
  config: ReprocessConfig = {}
): Promise<ReprocessResult> {
  const { batchSize = 50, dryRun = false } = config;

  // Validate configuration
  if (batchSize <= 0) {
    throw new Error("batchSize must be positive");
  }

  // Initialize result structure
  const result: ReprocessResult = {
    totalDiscovered: items.length,
    totalSucceeded: 0,
    totalFailed: 0,
    batchCount: 0,
    dryRun,
    batches: [],
    failures: [],
  };

  // Handle empty input
  if (items.length === 0) {
    return result;
  }

  // Process items in batches
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));
    const batchStats: BatchStats = {
      total: batch.length,
      succeeded: 0,
      failed: 0,
      failures: [],
    };

    // Process all items in the batch
    const processResults: ProcessItemResult[] = [];

    for (const item of batch) {
      try {
        const processResult = await callbacks.process(item);
        processResults.push(processResult);

        if (processResult.success) {
          batchStats.succeeded++;
        } else {
          batchStats.failed++;
          const failureRecord = {
            id: processResult.id,
            error: processResult.error?.message || "Unknown error",
            code: processResult.error?.code,
          };
          batchStats.failures.push(failureRecord);
          result.failures.push(failureRecord);
        }
      } catch (error) {
        // Catch unexpected errors during processing
        batchStats.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const failureRecord = {
          id: item.id,
          error: errorMessage,
          code: "UNEXPECTED_ERROR",
        };
        batchStats.failures.push(failureRecord);
        result.failures.push(failureRecord);

        // Still create a failed result so the item is accounted for
        processResults.push({
          id: item.id,
          success: false,
          error: {
            message: errorMessage,
            code: "UNEXPECTED_ERROR",
          },
        });
      }
    }

    // Persist successful results ONLY if not in dry-run mode
    if (!dryRun && batchStats.succeeded > 0) {
      const successfulResults = processResults.filter((r) => r.success);
      try {
        await callbacks.persist(successfulResults);
      } catch (error) {
        // If persistence fails, we need to record this appropriately
        // Since we can't partially persist, treat all "successful" items
        // as actually failed
        const persistError = error instanceof Error ? error.message : String(error);

        for (const successResult of successfulResults) {
          // Move from succeeded to failed
          batchStats.succeeded--;
          batchStats.failed++;

          const failureRecord = {
            id: successResult.id,
            error: `Persistence failed: ${persistError}`,
            code: "PERSIST_ERROR",
          };
          batchStats.failures.push(failureRecord);
          result.failures.push(failureRecord);
        }

        // Continue processing remaining batches even if this one failed to persist
        // This ensures we still get a complete report of what would work
      }
    }

    // Update aggregate statistics
    result.totalSucceeded += batchStats.succeeded;
    result.totalFailed += batchStats.failed;
    result.batchCount++;
    result.batches.push(batchStats);
  }

  return result;
}
