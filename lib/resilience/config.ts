/**
 * Resilience Layer Configuration
 *
 * Centralized configuration for rate limiting, circuit breakers, and
 * RPC endpoint management. Customize these values based on your upstream
 * node capacity and traffic patterns.
 */

import type { ResilientClientConfig } from "./resilient-client";

/**
 * Default rate limiter configuration.
 *
 * These values prevent self-inflicted flooding while allowing reasonable
 * throughput. Adjust based on your upstream node's rate limits.
 */
export const DEFAULT_RATE_LIMITER_CONFIG = {
  /**
   * Maximum burst capacity (tokens).
   * Allows short bursts of requests during quiet periods.
   */
  capacity: 10,

  /**
   * Steady-state rate (requests per second).
   * This is your sustainable throughput.
   */
  refillRate: 5,

  /**
   * Maximum queued requests before rejecting new ones.
   */
  maxQueueSize: 100,
};

/**
 * Default circuit breaker configuration.
 *
 * These thresholds determine when to isolate failing endpoints and when
 * to attempt recovery.
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
  /**
   * Number of consecutive failures before opening the circuit.
   * Lower = more sensitive, higher = more tolerant of transient errors.
   */
  failureThreshold: 5,

  /**
   * Number of successful canary requests before closing the circuit.
   */
  successThreshold: 2,

  /**
   * Initial delay (ms) before attempting recovery (HALF_OPEN state).
   */
  resetTimeout: 5000, // 5 seconds

  /**
   * Maximum reset timeout for exponential backoff.
   */
  maxResetTimeout: 60000, // 1 minute

  /**
   * Request timeout (ms). Requests taking longer are considered failures.
   */
  requestTimeout: 10000, // 10 seconds
};

/**
 * RPC endpoint configurations for different networks.
 */
export const RPC_ENDPOINTS = {
  /**
   * Testnet endpoints (ordered by priority).
   */
  testnet: [
    {
      id: "stellar-testnet-primary",
      url:
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
        "https://soroban-testnet.stellar.org",
      priority: 0,
    },
    {
      id: "stellar-testnet-backup",
      url: "https://rpc-testnet.stellar.org",
      priority: 1,
    },
  ],

  /**
   * Mainnet endpoints (ordered by priority).
   */
  mainnet: [
    {
      id: "stellar-mainnet-primary",
      url:
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
        "https://mainnet.stellar.validationcloud.io/v1/XGWbaseXCVJaRq0H2NLNR1YoqDmNjjAa",
      priority: 0,
    },
    {
      id: "stellar-mainnet-backup",
      url: "https://rpc-mainnet.stellar.org",
      priority: 1,
    },
  ],

  /**
   * Local development endpoints.
   */
  local: [
    {
      id: "local-stellar-rpc",
      url: process.env.LOCAL_RPC_URL ?? "http://localhost:8000/soroban/rpc",
      priority: 0,
    },
  ],
};

/**
 * Environment-specific resilient client configuration.
 *
 * Adjust rate limits and thresholds based on your deployment environment:
 * - Development: More lenient for testing
 * - Staging: Similar to production for realistic testing
 * - Production: Strict protection for reliability
 */
export const RESILIENCE_CONFIG = {
  development: {
    endpoints: RPC_ENDPOINTS.testnet,
    rateLimiter: {
      capacity: 20, // Higher burst for development
      refillRate: 10, // Higher steady rate
      maxQueueSize: 50,
    },
    circuitBreaker: {
      failureThreshold: 10, // More tolerant
      successThreshold: 2,
      resetTimeout: 3000, // Faster recovery
      maxResetTimeout: 30000,
      requestTimeout: 15000, // Longer timeout for debugging
    },
  },

  staging: {
    endpoints: RPC_ENDPOINTS.testnet,
    rateLimiter: DEFAULT_RATE_LIMITER_CONFIG,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER_CONFIG,
  },

  production: {
    endpoints: RPC_ENDPOINTS.mainnet,
    rateLimiter: {
      capacity: 10,
      refillRate: 5,
      maxQueueSize: 100,
    },
    circuitBreaker: {
      failureThreshold: 5,
      successThreshold: 2,
      resetTimeout: 5000,
      maxResetTimeout: 60000,
      requestTimeout: 10000,
    },
  },
} as const;

/**
 * Gets resilient client configuration for the current environment.
 */
export function getResilientClientConfig(
  network: "testnet" | "mainnet" | "local" = "testnet",
  environment: "development" | "staging" | "production" = "development"
): ResilientClientConfig {
  const envConfig = RESILIENCE_CONFIG[environment];

  // Override endpoints based on network parameter
  const endpoints =
    network === "local"
      ? RPC_ENDPOINTS.local
      : network === "mainnet"
      ? RPC_ENDPOINTS.mainnet
      : RPC_ENDPOINTS.testnet;

  return {
    endpoints,
    rateLimiter: envConfig.rateLimiter,
    circuitBreaker: envConfig.circuitBreaker,
  };
}

/**
 * Aggressive configuration for high-traffic scenarios.
 * Use when you need maximum protection against rate limiting.
 */
export const AGGRESSIVE_RESILIENCE_CONFIG: ResilientClientConfig = {
  endpoints: RPC_ENDPOINTS.testnet,
  rateLimiter: {
    capacity: 5, // Small burst
    refillRate: 2, // Very conservative rate
    maxQueueSize: 200, // Large queue to avoid dropping requests
  },
  circuitBreaker: {
    failureThreshold: 3, // Trip quickly
    successThreshold: 3, // Require more proof of recovery
    resetTimeout: 10000, // Longer cooldown
    maxResetTimeout: 120000, // 2 minutes max
    requestTimeout: 8000, // Shorter timeout
  },
};

/**
 * Lenient configuration for testing and development.
 * Use when upstream rate limits are not a concern.
 */
export const LENIENT_RESILIENCE_CONFIG: ResilientClientConfig = {
  endpoints: RPC_ENDPOINTS.testnet,
  rateLimiter: {
    capacity: 50,
    refillRate: 25,
    maxQueueSize: 50,
  },
  circuitBreaker: {
    failureThreshold: 15,
    successThreshold: 1,
    resetTimeout: 2000,
    maxResetTimeout: 20000,
    requestTimeout: 20000,
  },
};
