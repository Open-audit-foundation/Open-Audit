/**
 * Token Bucket Rate Limiter
 *
 * Implements an in-memory token-bucket algorithm to prevent self-inflicted
 * flooding of upstream RPC nodes. Tokens refill at a configured rate, and each
 * request consumes one token. When the bucket is empty, requests are queued
 * until tokens become available.
 *
 * Key Features:
 * - Configurable capacity (max burst size)
 * - Configurable refill rate (tokens per second)
 * - FIFO queue for pending requests (backpressure support)
 * - Automatic cleanup on dispose (no leaked timers)
 * - Thread-safe with promise-based API
 */

export interface TokenBucketConfig {
  /**
   * Maximum number of tokens the bucket can hold (burst capacity).
   * @default 10
   */
  capacity: number;

  /**
   * Number of tokens added per second (steady-state rate).
   * @default 5
   */
  refillRate: number;

  /**
   * Maximum number of requests to queue when bucket is empty.
   * Beyond this, acquire() will reject immediately.
   * @default 100
   */
  maxQueueSize?: number;
}

export interface TokenBucketMetrics {
  /** Current number of tokens available */
  availableTokens: number;
  /** Number of requests waiting for tokens */
  queuedRequests: number;
  /** Total tokens consumed since creation */
  totalConsumed: number;
  /** Total requests that waited for tokens */
  totalQueued: number;
  /** Total requests rejected due to full queue */
  totalRejected: number;
}

export interface TokenBucket {
  /**
   * Acquires a token from the bucket. If no tokens are available, queues
   * the request and resolves once a token becomes available.
   *
   * @throws {Error} If the queue is full and maxQueueSize is exceeded
   */
  acquire(): Promise<void>;

  /**
   * Attempts to acquire a token immediately without queuing.
   *
   * @returns true if a token was acquired, false otherwise
   */
  tryAcquire(): boolean;

  /**
   * Returns current metrics snapshot.
   */
  metrics(): TokenBucketMetrics;

  /**
   * Stops the refill timer and rejects all queued requests.
   * Must be called to prevent memory leaks.
   */
  dispose(): void;
}

/**
 * Creates a token bucket rate limiter.
 *
 * @example
 * ```typescript
 * const limiter = createTokenBucket({
 *   capacity: 10,      // Burst of 10 requests
 *   refillRate: 5,     // 5 requests per second steady-state
 * });
 *
 * // Before making an RPC call:
 * await limiter.acquire();
 * const result = await fetchFromRPC();
 * ```
 */
export function createTokenBucket(config: TokenBucketConfig): TokenBucket {
  const { capacity, refillRate, maxQueueSize = 100 } = config;

  if (capacity <= 0) throw new Error("Token bucket capacity must be positive");
  if (refillRate <= 0) throw new Error("Token bucket refillRate must be positive");

  let tokens = capacity; // Start with full bucket
  let disposed = false;

  // Metrics
  let totalConsumed = 0;
  let totalQueued = 0;
  let totalRejected = 0;

  // Queue of pending requests (FIFO)
  const queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  /**
   * Refill tokens based on elapsed time.
   * Called periodically by the refill timer.
   */
  function refillTokens(): void {
    if (disposed) return;

    // Calculate tokens to add (refillRate per second, interval is 100ms)
    const tokensToAdd = refillRate / 10; // 10 intervals per second
    tokens = Math.min(capacity, tokens + tokensToAdd);

    // Process queued requests if tokens are available
    while (queue.length > 0 && tokens >= 1) {
      tokens--;
      totalConsumed++;
      const waiter = queue.shift()!;
      waiter.resolve();
    }
  }

  // Start refill timer (100ms interval for smooth refilling)
  const refillInterval = setInterval(refillTokens, 100);

  function acquire(): Promise<void> {
    if (disposed) {
      return Promise.reject(new Error("TokenBucket has been disposed"));
    }

    // Fast path: token available immediately
    if (tokens >= 1) {
      tokens--;
      totalConsumed++;
      return Promise.resolve();
    }

    // Slow path: queue the request
    if (queue.length >= maxQueueSize) {
      totalRejected++;
      return Promise.reject(
        new Error(
          `TokenBucket queue full (${maxQueueSize} requests). Rate limit exceeded.`
        )
      );
    }

    totalQueued++;
    return new Promise<void>((resolve, reject) => {
      queue.push({ resolve, reject });
    });
  }

  function tryAcquire(): boolean {
    if (disposed) return false;

    if (tokens >= 1) {
      tokens--;
      totalConsumed++;
      return true;
    }

    return false;
  }

  function metrics(): TokenBucketMetrics {
    return {
      availableTokens: Math.floor(tokens),
      queuedRequests: queue.length,
      totalConsumed,
      totalQueued,
      totalRejected,
    };
  }

  function dispose(): void {
    if (disposed) return;

    disposed = true;
    clearInterval(refillInterval);

    // Reject all queued requests
    const error = new Error("TokenBucket disposed");
    while (queue.length > 0) {
      const waiter = queue.shift()!;
      waiter.reject(error);
    }
  }

  return {
    acquire,
    tryAcquire,
    metrics,
    dispose,
  };
}
