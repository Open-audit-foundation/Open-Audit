/**
 * Parallelized Ingestion Pool (Producer / Consumer)
 *
 * The ingestion engine historically processed every event in a ledger inside a
 * single blocking loop. During traffic spikes — a ledger carrying hundreds or
 * thousands of contract events — that loop falls behind real-time block
 * generation and the whole pipeline lags.
 *
 * This module decouples the producer (the RPC/stream listener) from the
 * CPU-heavy consumers (XDR decoding, spec extraction, translation, persistence)
 * via a thread-safe in-memory channel and a configurable fleet of parallel
 * consumer workers.
 *
 * Ordering guarantee
 * ──────────────────
 * Items are routed to one of `workerCount` partitions by hashing their
 * `partitionKey` (the contract ID). Every item for a given key therefore lands
 * on the SAME partition and is drained strictly FIFO by a SINGLE consumer.
 * This guarantees that event ordering stays consistent on a per-contract level
 * while still parallelizing across different contracts — no locks, no race
 * conditions, no out-of-order processing within a contract.
 *
 * Concurrency model
 * ─────────────────
 * Node.js runs JavaScript on a single thread, so "parallelism" here means N
 * independent asynchronous consumer loops progressing concurrently (overlapping
 * I/O and interleaved CPU). The heavy `process` task is intentionally pluggable
 * so a deployment that needs true CPU isolation can back it with a
 * `worker_threads` pool without changing the producer or the ordering
 * guarantees above.
 *
 * Ring-buffer queue (GC optimisation)
 * ────────────────────────────────────
 * The original implementation used plain JS arrays and Array.shift() as a FIFO
 * queue. Array.shift() is O(n) — every dequeue slides all remaining pointers
 * one slot to the left. On a crowded ledger with thousands of events this
 * causes quadratic work and creates GC pressure from short-lived array
 * re-allocations inside the V8 runtime.
 *
 * Each partition queue is now a pre-allocated ring buffer (power-of-two
 * capacity). Enqueue and dequeue are both O(1) with no element shifting and
 * no mid-loop heap allocation. The buffer doubles when full (amortised O(1))
 * and never shrinks, so once the process reaches steady-state throughput the
 * working set stabilises in old-generation memory and incurs zero minor GC.
 */

/** Configuration for an {@link IngestionPool}. */
export interface IngestionPoolOptions<T> {
  /**
   * Number of parallel consumer workers (and, equivalently, partitions).
   * Items are sharded across this many FIFO queues. Defaults to
   * {@link DEFAULT_WORKER_COUNT}.
   */
  workerCount?: number;
  /**
   * Maximum number of in-flight (queued + processing) items before
   * {@link IngestionPool.enqueue} applies backpressure by returning a promise
   * that resolves once capacity frees up. Omit for an unbounded channel.
   */
  maxQueueSize?: number;
  /**
   * Derives the ordering key for an item. Items sharing a key are guaranteed to
   * be processed in enqueue order by a single consumer. Use the contract ID to
   * preserve per-contract ordering.
   */
  partitionKey: (item: T) => string;
  /**
   * The CPU/IO-heavy consumer task. Invoked once per item. Must be async.
   * Thrown errors are routed to {@link IngestionPoolOptions.onError} and never
   * crash the pool or stall the partition.
   */
  process: (item: T) => Promise<void> | void;
  /** Optional error handler. When omitted, failures are logged to the console. */
  onError?: (error: Error, item: T) => void;
}

/** Runtime metrics describing the health of the pool. */
export interface IngestionPoolMetrics {
  /** Total items accepted by the producer. */
  enqueued: number;
  /** Total items successfully processed. */
  processed: number;
  /** Total items whose `process` threw. */
  failed: number;
  /** Items queued or currently processing (enqueued - processed - failed). */
  depth: number;
  /** Per-partition queued depth (excludes the item currently processing). */
  partitionDepths: number[];
}

/** A running producer/consumer pool. */
export interface IngestionPool<T> {
  /**
   * Producer API. Hands an item to the channel. Resolves immediately unless the
   * pool is at `maxQueueSize`, in which case the returned promise resolves once
   * a slot frees up (backpressure). Items are never dropped.
   */
  enqueue: (item: T) => Promise<void>;
  /** Resolves once every currently-queued item has finished processing. */
  drain: () => Promise<void>;
  /** Drains in-flight work, then stops all consumer loops. */
  stop: () => Promise<void>;
  /** A point-in-time snapshot of pool metrics. */
  metrics: () => IngestionPoolMetrics;
}

/** Default consumer count when none is supplied. */
export const DEFAULT_WORKER_COUNT = 4;

/**
 * Stable, fast string hash (djb2). Used to map a partition key to a partition
 * index deterministically so a given key always resolves to the same consumer.
 */
export function hashKey(key: string): number {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    // hash * 33 + charCode, kept in the unsigned 32-bit range.
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// ─── Ring-buffer FIFO queue ────────────────────────────────────────────────────

/**
 * A fixed-capacity, pre-allocated FIFO queue backed by a circular buffer.
 *
 * Complexity:
 *   enqueue — O(1) amortised (doubles on overflow, otherwise writes one slot)
 *   dequeue — O(1) (advances head pointer, no element shifting)
 *   isEmpty — O(1)
 *   size    — O(1)
 *
 * Memory profile:
 *   Allocates one typed array of `initialCapacity` slots at construction time.
 *   The buffer only grows (never shrinks), so once the process reaches
 *   steady-state throughput the ring lives entirely in old-generation memory
 *   and does not contribute to minor GC pauses.
 */
class RingBuffer<T> {
  private buf: Array<T | undefined>;
  private head = 0; // next read position
  private tail = 0; // next write position
  private _size = 0;

  constructor(initialCapacity = 64) {
    // Round up to the next power of two for cheaper modulo via bitwise AND.
    const cap = nextPow2(Math.max(initialCapacity, 2));
    this.buf = new Array<T | undefined>(cap).fill(undefined);
  }

  get size(): number {
    return this._size;
  }

  enqueue(item: T): void {
    if (this._size === this.buf.length) this._grow();
    this.buf[this.tail] = item;
    this.tail = (this.tail + 1) & (this.buf.length - 1);
    this._size++;
  }

  /** Returns undefined if empty — callers should check isEmpty() first. */
  dequeue(): T | undefined {
    if (this._size === 0) return undefined;
    const item = this.buf[this.head];
    // Null out slot to release the reference for GC.
    this.buf[this.head] = undefined;
    this.head = (this.head + 1) & (this.buf.length - 1);
    this._size--;
    return item;
  }

  isEmpty(): boolean {
    return this._size === 0;
  }

  private _grow(): void {
    const oldCap = this.buf.length;
    const newCap = oldCap * 2;
    const newBuf = new Array<T | undefined>(newCap).fill(undefined);
    // Copy logical contents in order, resetting head to 0.
    for (let i = 0; i < this._size; i++) {
      newBuf[i] = this.buf[(this.head + i) & (oldCap - 1)];
    }
    this.head = 0;
    this.tail = this._size;
    this.buf = newBuf;
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// ─── Pool implementation ───────────────────────────────────────────────────────

/**
 * Creates a parallel, contract-partitioned producer/consumer pool.
 *
 * @example
 * ```typescript
 * const pool = createIngestionPool<RawEvent>({
 *   workerCount: 8,
 *   partitionKey: (e) => e.contractId,
 *   process: async (e) => { await translateAndPersist(e); },
 * });
 *
 * // Producer side (fast, non-blocking):
 * for (const event of ledgerEvents) await pool.enqueue(event);
 * ```
 */
export function createIngestionPool<T>(options: IngestionPoolOptions<T>): IngestionPool<T> {
  const workerCount = Math.max(1, options.workerCount ?? DEFAULT_WORKER_COUNT);
  const { maxQueueSize, partitionKey, process } = options;
  const onError =
    options.onError ??
    ((error: Error) => console.error(`[ingestion-pool] Consumer task failed: ${error.message}`));

  /** One ring-buffer queue per partition — no O(n) shift() cost on dequeue. */
  const queues: RingBuffer<T>[] = Array.from(
    { length: workerCount },
    () => new RingBuffer<T>(64)
  );
  /** Per-partition "wake" resolvers — set while a consumer is idle. */
  const wakers: Array<(() => void) | null> = Array.from({ length: workerCount }, () => null);

  let enqueued = 0;
  let processed = 0;
  let failed = 0;
  let running = true;

  /** Outstanding = queued + currently processing. */
  function outstanding(): number {
    return enqueued - processed - failed;
  }

  /** Producers parked waiting for backpressure to ease, resolved FIFO. */
  const backpressureWaiters: Array<() => void> = [];
  /** Callers of drain(), resolved once the pool is fully idle. */
  const drainWaiters: Array<() => void> = [];

  /** Wakes the consumer for a partition if it is currently idle. */
  function wake(partition: number): void {
    const waker = wakers[partition];
    if (waker) {
      wakers[partition] = null;
      waker();
    }
  }

  /** Releases parked producers once we drop back under the limit. */
  function releaseBackpressure(): void {
    while (
      backpressureWaiters.length > 0 &&
      (maxQueueSize === undefined || outstanding() < maxQueueSize)
    ) {
      const resolve = backpressureWaiters.shift();
      resolve?.();
    }
  }

  /** Resolves any drain() callers once all work is finished. */
  function resolveDrainIfIdle(): void {
    if (outstanding() === 0) {
      while (drainWaiters.length > 0) {
        const resolve = drainWaiters.shift();
        resolve?.();
      }
    }
  }

  function enqueue(item: T): Promise<void> {
    if (!running) {
      return Promise.reject(new Error("Cannot enqueue on a stopped ingestion pool"));
    }

    const partition = hashKey(partitionKey(item)) % workerCount;
    queues[partition].enqueue(item);
    enqueued++;
    wake(partition);

    // Apply backpressure when the channel is saturated.
    if (maxQueueSize !== undefined && outstanding() >= maxQueueSize) {
      return new Promise<void>((resolve) => backpressureWaiters.push(resolve));
    }
    return Promise.resolve();
  }

  /** A single consumer loop, bound to one partition. */
  async function runConsumer(partition: number): Promise<void> {
    const queue = queues[partition];

    while (running || !queue.isEmpty()) {
      if (queue.isEmpty()) {
        if (!running) break;
        // Sleep until enqueue() (or stop()) wakes us — no busy polling.
        await new Promise<void>((resolve) => {
          wakers[partition] = resolve;
        });
        continue;
      }

      const item = queue.dequeue() as T;
      try {
        await process(item);
        processed++;
      } catch (error) {
        failed++;
        onError(error instanceof Error ? error : new Error(String(error)), item);
      } finally {
        releaseBackpressure();
        resolveDrainIfIdle();
      }
    }
  }

  // Launch the fleet. Each consumer runs independently and concurrently.
  const consumers = Array.from({ length: workerCount }, (_, i) => runConsumer(i));

  return {
    enqueue,
    drain(): Promise<void> {
      if (outstanding() === 0) return Promise.resolve();
      return new Promise<void>((resolve) => drainWaiters.push(resolve));
    },
    async stop(): Promise<void> {
      await this.drain();
      running = false;
      // Wake any idle consumers so their loops can observe `running === false`.
      for (let i = 0; i < workerCount; i++) wake(i);
      await Promise.all(consumers);
    },
    metrics(): IngestionPoolMetrics {
      return {
        enqueued,
        processed,
        failed,
        depth: outstanding(),
        partitionDepths: queues.map((q) => q.size),
      };
    },
  };
}
