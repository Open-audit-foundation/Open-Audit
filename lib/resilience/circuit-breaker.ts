/**
 * Circuit Breaker Pattern Implementation
 *
 * Protects upstream services from cascading failures by implementing a
 * state machine with three states:
 *
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Circuit tripped due to failures, requests fail fast
 * - HALF_OPEN: Testing if upstream has recovered with canary requests
 *
 * This prevents hammering a failing service and allows graceful recovery.
 *
 * Key Features:
 * - Automatic state transitions based on failure thresholds
 * - Exponential backoff in OPEN state
 * - Canary request testing in HALF_OPEN state
 * - Configurable failure detection (429, 500, timeout)
 * - Optional fallback function for graceful degradation
 * - Comprehensive metrics and observability
 */

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerConfig {
  /**
   * Number of consecutive failures before opening the circuit.
   * @default 5
   */
  failureThreshold: number;

  /**
   * Number of successful requests in HALF_OPEN before closing circuit.
   * @default 2
   */
  successThreshold: number;

  /**
   * Initial delay (ms) before transitioning from OPEN to HALF_OPEN.
   * Doubles on each subsequent failure (exponential backoff).
   * @default 5000
   */
  resetTimeout: number;

  /**
   * Maximum reset timeout (ms) for exponential backoff cap.
   * @default 60000 (1 minute)
   */
  maxResetTimeout?: number;

  /**
   * Request timeout (ms). Requests exceeding this are considered failures.
   * @default 10000 (10 seconds)
   */
  requestTimeout?: number;

  /**
   * Optional fallback function invoked when circuit is OPEN.
   * If not provided, requests fail immediately with CircuitBreakerOpenError.
   */
  fallback?: () => Promise<any>;

  /**
   * Optional custom error classifier. Returns true if the error should
   * count as a failure (trip the circuit).
   * Default: HTTP 429, 500-599, timeouts, network errors
   */
  isFailure?: (error: any) => boolean;

  /**
   * Optional state change listener for monitoring.
   */
  onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  totalTimeouts: number;
  totalFallbacks: number;
  currentResetTimeout: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string = "Circuit breaker is OPEN") {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreakerTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Request exceeded timeout of ${timeout}ms`);
    this.name = "CircuitBreakerTimeoutError";
  }
}

export interface CircuitBreaker {
  /**
   * Executes a function with circuit breaker protection.
   *
   * @param fn - The function to execute
   * @returns Promise resolving to the function's result
   * @throws {CircuitBreakerOpenError} If circuit is OPEN and no fallback
   * @throws {CircuitBreakerTimeoutError} If request times out
   */
  execute<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * Returns current state of the circuit breaker.
   */
  getState(): CircuitState;

  /**
   * Returns current metrics snapshot.
   */
  metrics(): CircuitBreakerMetrics;

  /**
   * Manually opens the circuit (useful for testing or manual intervention).
   */
  open(): void;

  /**
   * Manually closes the circuit (useful for testing or manual intervention).
   */
  close(): void;

  /**
   * Manually transitions to HALF_OPEN (useful for testing).
   */
  halfOpen(): void;

  /**
   * Stops all timers and cleans up resources.
   */
  dispose(): void;
}

/**
 * Default error classifier: treats HTTP 429, 500-599, timeouts, and network
 * errors as failures that should count toward tripping the circuit.
 */
function defaultIsFailure(error: any): boolean {
  // Check for HTTP status codes
  if (error?.response?.status) {
    const status = error.response.status;
    return status === 429 || (status >= 500 && status <= 599);
  }

  // Check for error names/types
  if (error?.name) {
    const errorName = error.name.toLowerCase();
    return (
      errorName.includes("timeout") ||
      errorName.includes("network") ||
      errorName.includes("econnrefused") ||
      errorName.includes("enotfound") ||
      errorName.includes("fetch")
    );
  }

  // Check for CircuitBreakerTimeoutError
  if (error instanceof CircuitBreakerTimeoutError) {
    return true;
  }

  // Check error messages
  if (error?.message) {
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("429") ||
      message.includes("too many requests") ||
      message.includes("rate limit") ||
      message.includes("network") ||
      message.includes("econnrefused")
    );
  }

  // Default: don't count as circuit-breaking failure
  return false;
}

/**
 * Creates a circuit breaker that wraps function executions.
 *
 * @example
 * ```typescript
 * const breaker = createCircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeout: 5000,
 *   fallback: async () => fetchFromBackupNode(),
 * });
 *
 * try {
 *   const result = await breaker.execute(() => fetchFromPrimaryNode());
 * } catch (error) {
 *   if (error instanceof CircuitBreakerOpenError) {
 *     // Circuit is open, fallback was used or failed
 *   }
 * }
 * ```
 */
export function createCircuitBreaker(config: CircuitBreakerConfig): CircuitBreaker {
  const {
    failureThreshold,
    successThreshold,
    resetTimeout,
    maxResetTimeout = 60000,
    requestTimeout = 10000,
    fallback,
    isFailure = defaultIsFailure,
    onStateChange,
  } = config;

  let state: CircuitState = CircuitState.CLOSED;
  let consecutiveFailures = 0;
  let consecutiveSuccesses = 0;
  let currentResetTimeout = resetTimeout;
  let resetTimer: NodeJS.Timeout | null = null;
  let disposed = false;

  // Metrics
  let totalRequests = 0;
  let totalSuccesses = 0;
  let totalFailures = 0;
  let totalTimeouts = 0;
  let totalFallbacks = 0;
  let lastFailureTime: number | undefined;
  let lastSuccessTime: number | undefined;

  /**
   * Transitions to a new state and notifies listeners.
   */
  function transitionTo(newState: CircuitState): void {
    if (state === newState) return;

    const oldState = state;
    state = newState;

    console.log(`[circuit-breaker] ${oldState} → ${newState}`);

    if (onStateChange) {
      try {
        onStateChange(oldState, newState);
      } catch (error) {
        console.error("[circuit-breaker] Error in onStateChange listener:", error);
      }
    }

    // Clear any existing reset timer
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }

    // Schedule transition to HALF_OPEN after reset timeout
    if (newState === CircuitState.OPEN) {
      resetTimer = setTimeout(() => {
        transitionTo(CircuitState.HALF_OPEN);
      }, currentResetTimeout);
    }
  }

  /**
   * Records a successful execution.
   */
  function recordSuccess(): void {
    consecutiveFailures = 0;
    consecutiveSuccesses++;
    totalSuccesses++;
    lastSuccessTime = Date.now();

    // Reset exponential backoff on success
    currentResetTimeout = resetTimeout;

    if (state === CircuitState.HALF_OPEN) {
      if (consecutiveSuccesses >= successThreshold) {
        transitionTo(CircuitState.CLOSED);
        consecutiveSuccesses = 0;
      }
    }
  }

  /**
   * Records a failed execution.
   */
  function recordFailure(error: any): void {
    consecutiveSuccesses = 0;
    consecutiveFailures++;
    totalFailures++;
    lastFailureTime = Date.now();

    if (error instanceof CircuitBreakerTimeoutError) {
      totalTimeouts++;
    }

    if (state === CircuitState.HALF_OPEN) {
      // Single failure in HALF_OPEN reopens the circuit with backoff
      currentResetTimeout = Math.min(currentResetTimeout * 2, maxResetTimeout);
      transitionTo(CircuitState.OPEN);
      consecutiveFailures = 0; // Reset counter for next attempt
    } else if (state === CircuitState.CLOSED) {
      if (consecutiveFailures >= failureThreshold) {
        transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Wraps a promise with a timeout.
   */
  function withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new CircuitBreakerTimeoutError(timeout)), timeout);
      }),
    ]);
  }

  async function execute<T>(fn: () => Promise<T>): Promise<T> {
    if (disposed) {
      throw new Error("CircuitBreaker has been disposed");
    }

    totalRequests++;

    // Circuit is OPEN: fail fast or use fallback
    if (state === CircuitState.OPEN) {
      if (fallback) {
        totalFallbacks++;
        console.log("[circuit-breaker] Circuit OPEN, using fallback");
        return fallback();
      }
      throw new CircuitBreakerOpenError(
        `Circuit breaker is OPEN (${consecutiveFailures} failures). Next retry in ${currentResetTimeout}ms`
      );
    }

    // Circuit is CLOSED or HALF_OPEN: attempt the request
    try {
      const result = await withTimeout(fn(), requestTimeout);
      recordSuccess();
      return result;
    } catch (error: any) {
      // Only count as failure if it matches our criteria
      if (isFailure(error)) {
        recordFailure(error);
      } else {
        // Non-circuit-breaking error, just pass through
        totalFailures++;
      }

      // If we just opened the circuit and have a fallback, try it
      if (state === CircuitState.OPEN && fallback) {
        totalFallbacks++;
        console.log("[circuit-breaker] Circuit just opened, attempting fallback");
        try {
          return await fallback();
        } catch (fallbackError) {
          console.error("[circuit-breaker] Fallback also failed:", fallbackError);
          throw error; // Throw original error
        }
      }

      throw error;
    }
  }

  function getState(): CircuitState {
    return state;
  }

  function metrics(): CircuitBreakerMetrics {
    return {
      state,
      consecutiveFailures,
      consecutiveSuccesses,
      totalRequests,
      totalSuccesses,
      totalFailures,
      totalTimeouts,
      totalFallbacks,
      currentResetTimeout,
      lastFailureTime,
      lastSuccessTime,
    };
  }

  function open(): void {
    transitionTo(CircuitState.OPEN);
  }

  function close(): void {
    consecutiveFailures = 0;
    consecutiveSuccesses = 0;
    currentResetTimeout = resetTimeout;
    transitionTo(CircuitState.CLOSED);
  }

  function halfOpen(): void {
    transitionTo(CircuitState.HALF_OPEN);
  }

  function dispose(): void {
    if (disposed) return;

    disposed = true;
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  }

  return {
    execute,
    getState,
    metrics,
    open,
    close,
    halfOpen,
    dispose,
  };
}
