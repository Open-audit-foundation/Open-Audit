# Resilience Layer for Stellar RPC Ingestion

## Overview

This module provides a **bulletproof resilience layer** for protecting Stellar RPC calls from upstream failures, rate limits, and network instability. It combines three key patterns:

1. **Token Bucket Rate Limiter** - Prevents self-inflicted flooding
2. **Circuit Breaker** - Isolates failing upstream nodes
3. **Automatic Fallback** - Switches to backup nodes on failure

## Problem Statement

Under heavy network traffic or during upstream node issues, event ingestion systems risk:

- 🚨 **HTTP 429 (Too Many Requests)** - Exceeding rate limits
- 🚨 **HTTP 500 (Server Errors)** - Overloaded or failing nodes
- 🚨 **Timeouts** - Slow or unresponsive nodes
- 🚨 **Pipeline Crashes** - Cascading failures taking down the entire system

## Solution Architecture

```
┌─────────────────┐
│ Your Code       │
│ (Event Ingester)│
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Resilient Client                        │
│ ┌─────────────────────────────────────┐ │
│ │ 1. Token Bucket Rate Limiter        │ │  ← Prevents flooding
│ │    (X requests/sec, burst capacity) │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 2. Circuit Breaker (per endpoint)   │ │  ← Detects failures
│ │    States: CLOSED → OPEN → HALF_OPEN│ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 3. Fallback Chain                   │ │  ← Tries backups
│ │    Primary → Backup1 → Backup2      │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Stellar RPC Nodes                       │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │ Primary  │ │ Backup 1 │ │ Backup 2 │ │
│ └──────────┘ └──────────┘ └──────────┘ │
└─────────────────────────────────────────┘
```

## Quick Start

### Installation

No external dependencies required - pure TypeScript implementation.

```typescript
import { createResilientClient, getResilientClientConfig } from "./lib/resilience";
```

### Basic Usage

```typescript
// Create a resilient client
const client = createResilientClient({
  endpoints: [
    { id: "primary", url: "https://soroban-testnet.stellar.org", priority: 0 },
    { id: "backup", url: "https://rpc-testnet.stellar.org", priority: 1 },
  ],
  rateLimiter: {
    capacity: 10,      // Burst capacity
    refillRate: 5,     // 5 requests per second
  },
  circuitBreaker: {
    failureThreshold: 5,   // Open after 5 failures
    successThreshold: 2,   // Close after 2 successes
    resetTimeout: 5000,    // Try recovery after 5 seconds
  },
});

// Use it for RPC calls
const events = await client.execute(async (rpcUrl) => {
  const server = new SorobanRpc.Server(rpcUrl);
  return await server.getEvents({ startLedger: 1000, filters: [...] });
});

// Clean up when done
client.dispose();
```

### Drop-In Stellar Client

For Stellar-specific usage, use the pre-configured client:

```typescript
import {
  fetchContractEventsResilient,
  getHealthStatus,
  getCurrentRpcEndpoint,
} from "./lib/stellar/resilient-stellar-client";

// Replace your existing fetchContractEvents calls
const events = await fetchContractEventsResilient(
  ["CONTRACT_ID_1", "CONTRACT_ID_2"],
  1000 // startLedger
);

// Check system health
const health = getHealthStatus();
console.log(`Healthy: ${health.healthy}, Using: ${health.currentEndpoint}`);
```

## Components

### 1. Token Bucket Rate Limiter

**Purpose:** Prevent exceeding upstream rate limits by controlling request rate.

**How it works:**
- Bucket starts with `capacity` tokens
- Each request consumes 1 token
- Tokens refill at `refillRate` per second
- If bucket is empty, requests queue until tokens available

```typescript
import { createTokenBucket } from "./lib/resilience";

const limiter = createTokenBucket({
  capacity: 10,      // Max burst size
  refillRate: 5,     // Tokens per second
  maxQueueSize: 100, // Max queued requests
});

// Acquire a token (waits if necessary)
await limiter.acquire();
makeRpcCall();

// Try to acquire (non-blocking)
if (limiter.tryAcquire()) {
  makeRpcCall();
}

// Check metrics
const metrics = limiter.metrics();
console.log(`Available tokens: ${metrics.availableTokens}`);
console.log(`Queued requests: ${metrics.queuedRequests}`);

// Cleanup
limiter.dispose();
```

**Metrics:**
- `availableTokens` - Current tokens in bucket
- `queuedRequests` - Requests waiting for tokens
- `totalConsumed` - Total tokens consumed
- `totalQueued` - Total requests that waited
- `totalRejected` - Requests rejected (queue full)

### 2. Circuit Breaker

**Purpose:** Detect and isolate failing upstream nodes to prevent cascading failures.

**State Machine:**

```
CLOSED (normal) ──[failures ≥ threshold]──> OPEN (failing fast)
                                              │
                    ┌─────────────────────────┘
                    │ [wait resetTimeout]
                    ▼
              HALF_OPEN (testing recovery)
                    │
        ┌───────────┴───────────┐
        │ [success]            │ [failure]
        ▼                       ▼
    CLOSED                    OPEN (+ exponential backoff)
```

```typescript
import { createCircuitBreaker, CircuitState } from "./lib/resilience";

const breaker = createCircuitBreaker({
  failureThreshold: 5,      // Trip after 5 failures
  successThreshold: 2,      // Close after 2 successes
  resetTimeout: 5000,       // Wait 5s before testing
  maxResetTimeout: 60000,   // Max backoff: 1 minute
  requestTimeout: 10000,    // Request timeout: 10s
  
  // Optional: custom error detection
  isFailure: (error) => {
    return error?.response?.status === 429 || 
           error?.response?.status >= 500;
  },
  
  // Optional: fallback function
  fallback: async () => {
    return await fetchFromBackupNode();
  },
  
  // Optional: state change listener
  onStateChange: (oldState, newState) => {
    console.log(`Circuit: ${oldState} → ${newState}`);
  },
});

// Execute with protection
try {
  const result = await breaker.execute(async () => {
    return await fetchFromUpstream();
  });
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    // Circuit is open, request was rejected
  }
}

// Check state
console.log(breaker.getState()); // CLOSED | OPEN | HALF_OPEN

// Get metrics
const metrics = breaker.metrics();
console.log(`State: ${metrics.state}`);
console.log(`Failures: ${metrics.totalFailures}`);
console.log(`Successes: ${metrics.totalSuccesses}`);

// Manual control (for testing)
breaker.open();   // Force open
breaker.close();  // Force close
breaker.halfOpen(); // Force half-open

// Cleanup
breaker.dispose();
```

**Failure Detection (Default):**
- HTTP 429 (Too Many Requests)
- HTTP 500-599 (Server Errors)
- Timeouts
- Network errors (ECONNREFUSED, ENOTFOUND, etc.)

**Exponential Backoff:**
- First failure: Wait `resetTimeout` ms
- Second failure: Wait `resetTimeout * 2` ms
- Third failure: Wait `resetTimeout * 4` ms
- Capped at `maxResetTimeout`

### 3. Resilient Client (Combined)

**Purpose:** Combine rate limiting, circuit breaking, and fallback into one unified client.

```typescript
import { createResilientClient } from "./lib/resilience";

const client = createResilientClient({
  // Endpoints in priority order
  endpoints: [
    { id: "primary", url: "https://primary.stellar.org", priority: 0 },
    { id: "backup-1", url: "https://backup1.stellar.org", priority: 1 },
    { id: "backup-2", url: "https://backup2.stellar.org", priority: 2 },
  ],
  
  // Rate limiter config (applies to all endpoints combined)
  rateLimiter: {
    capacity: 10,
    refillRate: 5,
    maxQueueSize: 100,
  },
  
  // Circuit breaker config (one per endpoint)
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    resetTimeout: 5000,
    maxResetTimeout: 60000,
    requestTimeout: 10000,
  },
  
  // Optional callbacks
  onRequest: (endpoint, attempt) => {
    console.log(`Attempting ${endpoint.id} (attempt ${attempt})`);
  },
  onResponse: (endpoint, duration, success) => {
    console.log(`${endpoint.id}: ${success ? "✓" : "✗"} (${duration}ms)`);
  },
  onCircuitStateChange: (endpoint, oldState, newState) => {
    console.warn(`${endpoint.id}: ${oldState} → ${newState}`);
  },
});

// Execute request (automatically handles fallback)
const result = await client.execute(async (rpcUrl) => {
  const server = new SorobanRpc.Server(rpcUrl);
  return await server.getLatestLedger();
});

// Get current endpoint (based on circuit states)
const current = client.getCurrentEndpoint();
console.log(`Using: ${current.id} (${current.url})`);

// Get comprehensive metrics
const metrics = client.metrics();
console.log("Rate Limiter:", metrics.rateLimiter);
console.log("Circuit Breakers:", metrics.circuitBreakers);

// Cleanup
client.dispose();
```

**Execution Flow:**

1. **Acquire rate limit token** (waits if necessary)
2. **Try primary endpoint** through its circuit breaker
   - If circuit is CLOSED/HALF_OPEN: Execute request
   - If circuit is OPEN: Skip to next endpoint
3. **On failure:** Try next endpoint in priority order
4. **On success:** Return result
5. **If all fail:** Throw error with details from all attempts

## Configuration Presets

### Environment-Based Config

```typescript
import { getResilientClientConfig } from "./lib/resilience";

// Automatically selects config based on environment
const config = getResilientClientConfig(
  "testnet",    // network: "testnet" | "mainnet" | "local"
  "production"  // environment: "development" | "staging" | "production"
);

const client = createResilientClient(config);
```

**Development:**
- Higher rate limits (capacity: 20, rate: 10/sec)
- More tolerant thresholds (10 failures before trip)
- Faster recovery (3s reset timeout)
- Longer request timeout (15s for debugging)

**Staging:**
- Production-like limits for realistic testing
- Standard thresholds

**Production:**
- Conservative rate limits (capacity: 10, rate: 5/sec)
- Strict thresholds (5 failures before trip)
- Standard recovery (5s reset timeout)

### Preset Configs

```typescript
import {
  AGGRESSIVE_RESILIENCE_CONFIG,
  LENIENT_RESILIENCE_CONFIG,
} from "./lib/resilience/config";

// Aggressive: Maximum protection
// - Small burst (5 tokens)
// - Very conservative rate (2/sec)
// - Quick to trip (3 failures)
// - Long cooldown (10s reset)
const aggressiveClient = createResilientClient(AGGRESSIVE_RESILIENCE_CONFIG);

// Lenient: For testing/development
// - Large burst (50 tokens)
// - High rate (25/sec)
// - Tolerant (15 failures)
// - Short cooldown (2s reset)
const lenientClient = createResilientClient(LENIENT_RESILIENCE_CONFIG);
```

## Testing

### Running Tests

```bash
# Run all resilience tests
npm test lib/resilience

# Run specific test suite
npm test lib/resilience/__tests__/circuit-breaker.test.ts
npm test lib/resilience/__tests__/token-bucket.test.ts
npm test lib/resilience/__tests__/resilient-client.test.ts
```

### Test Coverage

**Circuit Breaker Tests:**
- ✅ State transitions (CLOSED → OPEN → HALF_OPEN → CLOSED)
- ✅ Failure threshold detection
- ✅ HTTP 429 and 500 error handling
- ✅ Timeout detection
- ✅ Exponential backoff
- ✅ Canary request testing
- ✅ Fallback invocation
- ✅ Resource cleanup (no leaked timers)

**Token Bucket Tests:**
- ✅ Token consumption and refill
- ✅ Burst capacity
- ✅ Queuing and backpressure
- ✅ Queue size limits
- ✅ FIFO processing
- ✅ Metrics tracking
- ✅ Resource cleanup

**Resilient Client Tests:**
- ✅ End-to-end integration
- ✅ Automatic fallback to backups
- ✅ Recovery after upstream stabilization
- ✅ Mixed success/failure scenarios
- ✅ Observability callbacks
- ✅ Concurrent request handling

### Mock Failure Scenarios

```typescript
import { describe, it, expect } from "vitest";
import { createCircuitBreaker } from "./lib/resilience";

describe("Simulated upstream failures", () => {
  it("should handle continuous HTTP 500 errors", async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeout: 1000,
    });

    const mockFailing = async () => {
      const error: any = new Error("Internal Server Error");
      error.response = { status: 500 };
      throw error;
    };

    // Trigger failures
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(mockFailing)).rejects.toThrow();
    }

    // Circuit should be open
    expect(breaker.getState()).toBe("OPEN");

    // Next request fails fast without calling function
    await expect(breaker.execute(mockFailing)).rejects.toThrow(
      "Circuit breaker is OPEN"
    );

    breaker.dispose();
  });

  it("should handle rate limiting (HTTP 429)", async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeout: 1000,
    });

    const mockRateLimit = async () => {
      const error: any = new Error("Too Many Requests");
      error.response = { status: 429 };
      throw error;
    };

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(mockRateLimit)).rejects.toThrow();
    }

    expect(breaker.getState()).toBe("OPEN");
    breaker.dispose();
  });
});
```

## Monitoring and Observability

### Health Check Endpoint

```typescript
import { getHealthStatus } from "./lib/stellar/resilient-stellar-client";

// Add to your health check API
app.get("/api/health", (req, res) => {
  const health = getHealthStatus();
  
  if (!health.healthy) {
    return res.status(503).json({
      status: "unhealthy",
      details: health,
    });
  }
  
  res.json({
    status: "healthy",
    endpoint: health.currentEndpoint,
    circuits: health.circuitStates,
    rateLimiter: health.rateLimiter,
  });
});
```

### Metrics Export

```typescript
import { getResilientMetrics } from "./lib/stellar/resilient-stellar-client";

// Periodic metrics export (e.g., to Prometheus, DataDog)
setInterval(() => {
  const metrics = getResilientMetrics();
  
  // Rate limiter metrics
  console.log("rate_limiter_available_tokens", metrics.rateLimiter.availableTokens);
  console.log("rate_limiter_queued_requests", metrics.rateLimiter.queuedRequests);
  console.log("rate_limiter_total_consumed", metrics.rateLimiter.totalConsumed);
  console.log("rate_limiter_total_rejected", metrics.rateLimiter.totalRejected);
  
  // Circuit breaker metrics (per endpoint)
  for (const cb of metrics.circuitBreakers) {
    const labels = { endpoint: cb.endpoint.id };
    console.log("circuit_breaker_state", cb.metrics.state, labels);
    console.log("circuit_breaker_failures", cb.metrics.totalFailures, labels);
    console.log("circuit_breaker_successes", cb.metrics.totalSuccesses, labels);
    console.log("circuit_breaker_timeouts", cb.metrics.totalTimeouts, labels);
  }
}, 60000); // Every minute
```

### Alerting

```typescript
import { createResilientClient } from "./lib/resilience";

const client = createResilientClient({
  // ... config
  onCircuitStateChange: (endpoint, oldState, newState) => {
    if (newState === "OPEN") {
      // Alert: Circuit opened
      alertSystem.send({
        severity: "critical",
        message: `RPC endpoint ${endpoint.id} circuit OPENED`,
        details: { endpoint: endpoint.url, oldState, newState },
      });
    } else if (newState === "CLOSED" && oldState === "OPEN") {
      // Resolved: Circuit closed
      alertSystem.send({
        severity: "info",
        message: `RPC endpoint ${endpoint.id} circuit CLOSED (recovered)`,
        details: { endpoint: endpoint.url },
      });
    }
  },
});
```

## Best Practices

### 1. Choose Appropriate Thresholds

**Rate Limiter:**
- Set `capacity` based on your batch processing needs
- Set `refillRate` to 80% of upstream limit (safety margin)
- Set `maxQueueSize` based on acceptable latency

**Circuit Breaker:**
- Lower `failureThreshold` for critical services (fail fast)
- Higher `failureThreshold` for transient-error-prone services
- `successThreshold` = 2-3 for reliable recovery detection
- `resetTimeout` = 5-10s for typical scenarios

### 2. Configure Multiple Backup Endpoints

```typescript
const client = createResilientClient({
  endpoints: [
    { id: "primary", url: STELLAR_RPC_PRIMARY, priority: 0 },
    { id: "backup-1", url: STELLAR_RPC_BACKUP_1, priority: 1 },
    { id: "backup-2", url: STELLAR_RPC_BACKUP_2, priority: 2 },
    { id: "local-cache", url: LOCAL_CACHE_ENDPOINT, priority: 3 },
  ],
  // ... config
});
```

### 3. Use Singleton Pattern

Share one resilient client across your application to maintain unified circuit breaker state:

```typescript
// ✅ Good: Singleton
let _client: ResilientClient | null = null;

export function getClient() {
  if (!_client) {
    _client = createResilientClient(config);
  }
  return _client;
}

// ❌ Bad: Creating multiple clients
function fetchData1() {
  const client = createResilientClient(config); // New instance
  return client.execute(...);
}

function fetchData2() {
  const client = createResilientClient(config); // Another new instance
  return client.execute(...);
}
```

### 4. Clean Up Resources

```typescript
// During graceful shutdown
process.on("SIGTERM", () => {
  console.log("Shutting down gracefully...");
  client.dispose(); // Clean up timers and queues
  process.exit(0);
});
```

### 5. Monitor and Alert

- Export metrics to your monitoring system
- Set up alerts for circuit state changes
- Monitor queue depths and rejection rates
- Track success/failure ratios

## Troubleshooting

### Issue: All requests are being rejected

**Symptoms:** `TokenBucket queue full` errors

**Cause:** Rate limit too low for your traffic

**Solution:**
```typescript
// Increase capacity and refill rate
rateLimiter: {
  capacity: 20,    // Was: 10
  refillRate: 10,  // Was: 5
}
```

### Issue: Circuit keeps opening on transient errors

**Symptoms:** Circuit flaps between CLOSED and OPEN frequently

**Cause:** `failureThreshold` too low

**Solution:**
```typescript
// Increase threshold to be more tolerant
circuitBreaker: {
  failureThreshold: 10,  // Was: 5
  resetTimeout: 3000,     // Shorter recovery time
}
```

### Issue: Not failing fast enough

**Symptoms:** Long delays before circuit opens

**Cause:** `failureThreshold` or `requestTimeout` too high

**Solution:**
```typescript
circuitBreaker: {
  failureThreshold: 3,   // Lower threshold
  requestTimeout: 5000,  // Shorter timeout
}
```

### Issue: Circuit never closes after recovery

**Symptoms:** Circuit stays OPEN even when upstream is healthy

**Cause:** Canary requests during HALF_OPEN still failing

**Solution:** Check logs during HALF_OPEN state. May need to:
- Increase `successThreshold` if canaries are flaky
- Decrease `resetTimeout` for faster retry attempts

### Issue: Memory leaks

**Symptoms:** Memory usage grows over time

**Cause:** Not disposing clients or timers

**Solution:**
```typescript
// Always dispose when done
client.dispose();

// Or use try-finally
try {
  await client.execute(...);
} finally {
  client.dispose();
}
```

## Performance Characteristics

### Token Bucket
- **Space:** O(n) where n = `maxQueueSize`
- **Time:** O(1) for acquire/tryAcquire
- **Overhead:** ~100ms timer interval

### Circuit Breaker
- **Space:** O(1) - fixed memory footprint
- **Time:** O(1) for execute
- **Overhead:** ~1-5ms per request

### Resilient Client
- **Space:** O(n * m) where n = endpoints, m = queue size
- **Time:** O(n) worst case (tries all endpoints)
- **Overhead:** Token bucket + circuit breaker overhead

## License

MIT

## Contributors

- Senior DevOps Engineer / Systems Security Architect

## Related Documentation

- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)
- [Stellar RPC Documentation](https://developers.stellar.org/docs/data/rpc)
