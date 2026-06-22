/**
 * Resilient RPC Client Wrapper
 *
 * Combines token-bucket rate limiting and circuit breaker pattern to create
 * a bulletproof wrapper around Stellar RPC calls. This prevents self-inflicted
 * flooding, handles upstream failures gracefully, and provides automatic
 * fallback to backup nodes.
 *
 * Architecture:
 * 1. Token Bucket: Prevents exceeding rate limits (self-protection)
 * 2. Circuit Breaker: Detects and isolates failing upstream nodes
 * 3. Fallback Chain: Automatically switches to backup nodes when primary fails
 * 4. Exponential Backoff: Gradually increases retry delays
 *
 * This layer sits between your application code and the actual RPC calls,
 * providing transparent resilience without changing your business logic.
 */

import { createTokenBucket, TokenBucket, TokenBucketConfig } from "./token-bucket";
import {
  createCircuitBreaker,
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerOpenError,
  CircuitState,
} from "./circuit-breaker";

export interface RpcEndpoint {
  /** Unique identifier for this endpoint (e.g., "primary", "backup-1") */
  id: string;
  /** Full URL for the RPC endpoint */
  url: string;
  /** Priority (lower = preferred). Primary should be 0, backups higher. */
  priority: number;
}

export interface ResilientClientConfig {
  /**
   * List of RPC endpoints in priority order.
   * First endpoint is primary, rest are backups.
   */
  endpoints: RpcEndpoint[];

  /**
   * Token bucket configuration for rate limiting.
   */
  rateLimiter: TokenBucketConfig;

  /**
   * Circuit breaker configuration for each endpoint.
   * Each endpoint gets its own circuit breaker.
   */
  circuitBreaker: CircuitBreakerConfig;

  /**
   * Optional request interceptor for logging/metrics.
   */
  onRequest?: (endpoint: RpcEndpoint, attempt: number) => void;

  /**
   * Optional response interceptor for logging/metrics.
   */
  onResponse?: (endpoint: RpcEndpoint, duration: number, success: boolean) => void;

  /**
   * Optional circuit state change listener.
   */
  onCircuitStateChange?: (
    endpoint: RpcEndpoint,
    oldState: CircuitState,
    newState: CircuitState
  ) => void;
}

export interface ResilientClientMetrics {
  currentEndpoint: RpcEndpoint;
  rateLimiter: ReturnType<TokenBucket["metrics"]>;
  circuitBreakers: Array<{
    endpoint: RpcEndpoint;
    metrics: ReturnType<CircuitBreaker["metrics"]>;
  }>;
}

export interface ResilientClient {
  /**
   * Executes an RPC request with full resilience protection.
   *
   * Flow:
   * 1. Acquire token from rate limiter (wait if necessary)
   * 2. Try primary endpoint through its circuit breaker
   * 3. If primary fails/open, try backup endpoints in order
   * 4. If all fail, throw the last error
   *
   * @param fn - Function that performs the RPC call (receives endpoint URL)
   * @returns Promise resolving to the RPC response
   */
  execute<T>(fn: (endpointUrl: string) => Promise<T>): Promise<T>;

  /**
   * Returns the currently active endpoint (based on circuit breaker states).
   */
  getCurrentEndpoint(): RpcEndpoint;

  /**
   * Returns comprehensive metrics for all components.
   */
  metrics(): ResilientClientMetrics;

  /**
   * Cleans up all resources (timers, queues).
   */
  dispose(): void;
}

/**
 * Creates a resilient RPC client with rate limiting, circuit breaking,
 * and automatic fallback to backup endpoints.
 *
 * @example
 * ```typescript
 * const client = createResilientClient({
 *   endpoints: [
 *     { id: "primary", url: "https://soroban-testnet.stellar.org", priority: 0 },
 *     { id: "backup", url: "https://backup-node.example.com", priority: 1 },
 *   ],
 *   rateLimiter: {
 *     capacity: 10,
 *     refillRate: 5,
 *   },
 *   circuitBreaker: {
 *     failureThreshold: 5,
 *     successThreshold: 2,
 *     resetTimeout: 5000,
 *   },
 * });
 *
 * // Use it in place of direct RPC calls:
 * const events = await client.execute(async (url) => {
 *   const server = new SorobanRpc.Server(url);
 *   return server.getEvents({ startLedger: 1000, filters: [...] });
 * });
 * ```
 */
export function createResilientClient(config: ResilientClientConfig): ResilientClient {
  const {
    endpoints,
    rateLimiter: rateLimiterConfig,
    circuitBreaker: circuitBreakerConfig,
    onRequest,
    onResponse,
    onCircuitStateChange,
  } = config;

  if (!endpoints || endpoints.length === 0) {
    throw new Error("ResilientClient requires at least one endpoint");
  }

  // Sort endpoints by priority (lower = first)
  const sortedEndpoints = [...endpoints].sort((a, b) => a.priority - b.priority);

  // Create shared rate limiter (applies to all endpoints collectively)
  const rateLimiter = createTokenBucket(rateLimiterConfig);

  // Create one circuit breaker per endpoint
  const circuitBreakers = new Map<string, CircuitBreaker>();

  for (const endpoint of sortedEndpoints) {
    const breaker = createCircuitBreaker({
      ...circuitBreakerConfig,
      onStateChange: (oldState, newState) => {
        console.log(`[resilient-client] ${endpoint.id}: ${oldState} → ${newState}`);
        if (onCircuitStateChange) {
          onCircuitStateChange(endpoint, oldState, newState);
        }
      },
    });
    circuitBreakers.set(endpoint.id, breaker);
  }

  /**
   * Finds the first endpoint with a non-OPEN circuit breaker.
   */
  function getCurrentEndpoint(): RpcEndpoint {
    // Try to find a closed or half-open circuit
    for (const endpoint of sortedEndpoints) {
      const breaker = circuitBreakers.get(endpoint.id)!;
      if (breaker.getState() !== CircuitState.OPEN) {
        return endpoint;
      }
    }

    // All circuits are open, return primary (will fail fast or use backoff)
    return sortedEndpoints[0];
  }

  /**
   * Attempts to execute the request against a specific endpoint.
   */
  async function tryEndpoint<T>(
    endpoint: RpcEndpoint,
    fn: (endpointUrl: string) => Promise<T>,
    attempt: number
  ): Promise<T> {
    const breaker = circuitBreakers.get(endpoint.id)!;
    const startTime = Date.now();

    if (onRequest) {
      onRequest(endpoint, attempt);
    }

    try {
      const result = await breaker.execute(() => fn(endpoint.url));
      const duration = Date.now() - startTime;

      if (onResponse) {
        onResponse(endpoint, duration, true);
      }

      console.log(
        `[resilient-client] ✓ ${endpoint.id} succeeded in ${duration}ms (attempt ${attempt})`
      );

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      if (onResponse) {
        onResponse(endpoint, duration, false);
      }

      console.error(
        `[resilient-client] ✗ ${endpoint.id} failed in ${duration}ms (attempt ${attempt}):`,
        error.message
      );

      throw error;
    }
  }

  async function execute<T>(fn: (endpointUrl: string) => Promise<T>): Promise<T> {
    // Step 1: Acquire rate limit token
    await rateLimiter.acquire();

    // Step 2: Try endpoints in priority order
    const errors: Array<{ endpoint: RpcEndpoint; error: any }> = [];
    let attempt = 0;

    for (const endpoint of sortedEndpoints) {
      attempt++;

      try {
        return await tryEndpoint(endpoint, fn, attempt);
      } catch (error: any) {
        errors.push({ endpoint, error });

        // If this was a circuit breaker open error, try next endpoint immediately
        if (error instanceof CircuitBreakerOpenError) {
          console.log(
            `[resilient-client] ${endpoint.id} circuit is OPEN, trying next endpoint...`
          );
          continue;
        }

        // For other errors, if we have more endpoints, try them
        if (attempt < sortedEndpoints.length) {
          console.log(
            `[resilient-client] ${endpoint.id} failed, trying next endpoint...`
          );
          continue;
        }

        // Last endpoint failed, throw
        break;
      }
    }

    // All endpoints failed
    const errorMessages = errors
      .map((e) => `${e.endpoint.id}: ${e.error.message}`)
      .join("; ");

    throw new Error(
      `All RPC endpoints failed after ${attempt} attempts. Errors: ${errorMessages}`
    );
  }

  function metrics(): ResilientClientMetrics {
    const currentEndpoint = getCurrentEndpoint();
    const circuitBreakerMetrics = Array.from(circuitBreakers.entries()).map(
      ([id, breaker]) => ({
        endpoint: sortedEndpoints.find((e) => e.id === id)!,
        metrics: breaker.metrics(),
      })
    );

    return {
      currentEndpoint,
      rateLimiter: rateLimiter.metrics(),
      circuitBreakers: circuitBreakerMetrics,
    };
  }

  function dispose(): void {
    rateLimiter.dispose();
    for (const breaker of circuitBreakers.values()) {
      breaker.dispose();
    }
  }

  return {
    execute,
    getCurrentEndpoint,
    metrics,
    dispose,
  };
}
