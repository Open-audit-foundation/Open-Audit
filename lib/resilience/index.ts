/**
 * Resilience Layer - Public API
 *
 * Exports all resilience components for easy importing:
 * - Token Bucket Rate Limiter
 * - Circuit Breaker
 * - Resilient Client (combined)
 * - Configuration presets
 */

// Token Bucket
export {
  createTokenBucket,
  type TokenBucket,
  type TokenBucketConfig,
  type TokenBucketMetrics,
} from "./token-bucket";

// Circuit Breaker
export {
  createCircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
  type CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerMetrics,
} from "./circuit-breaker";

// Resilient Client
export {
  createResilientClient,
  type ResilientClient,
  type ResilientClientConfig,
  type ResilientClientMetrics,
  type RpcEndpoint,
} from "./resilient-client";

// Configuration
export {
  getResilientClientConfig,
  DEFAULT_RATE_LIMITER_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  RPC_ENDPOINTS,
  RESILIENCE_CONFIG,
  AGGRESSIVE_RESILIENCE_CONFIG,
  LENIENT_RESILIENCE_CONFIG,
} from "./config";
