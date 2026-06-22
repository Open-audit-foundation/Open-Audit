# 🛡️ Resilience Layer - Quick Reference Card

## 🚀 Quick Start (Copy-Paste Ready)

### Installation
```bash
# No installation needed - pure TypeScript, already in codebase
npm run test:resilience  # Verify it works
```

### Drop-In Replacement (Easiest)
```typescript
// Before:
import { fetchContractEvents } from "./lib/stellar/client";
const events = await fetchContractEvents(ids, config, ledger);

// After:
import { fetchContractEventsResilient } from "./lib/stellar/resilient-stellar-client";
const events = await fetchContractEventsResilient(ids, ledger);
```

### Custom Usage
```typescript
import { createResilientClient, getResilientClientConfig } from "./lib/resilience";

const client = createResilientClient(
  getResilientClientConfig("testnet", "production")
);

const result = await client.execute(async (rpcUrl) => {
  return await yourRpcCall(rpcUrl);
});

client.dispose(); // Always cleanup
```

---

## 📊 Configuration Presets

| Preset | Use Case | Capacity | Rate | Threshold |
|--------|----------|----------|------|-----------|
| **Development** | Local testing | 20 | 10/sec | 10 failures |
| **Production** | Live traffic | 10 | 5/sec | 5 failures |
| **Aggressive** | High protection | 5 | 2/sec | 3 failures |
| **Lenient** | Testing/debug | 50 | 25/sec | 15 failures |

```typescript
// Use preset
import { getResilientClientConfig } from "./lib/resilience/config";
const config = getResilientClientConfig("testnet", "production");

// Or aggressive
import { AGGRESSIVE_RESILIENCE_CONFIG } from "./lib/resilience/config";
const client = createResilientClient(AGGRESSIVE_RESILIENCE_CONFIG);
```

---

## 🔧 Common Configurations

### Basic (Single Primary)
```typescript
{
  endpoints: [
    { id: "primary", url: "https://soroban-testnet.stellar.org", priority: 0 },
  ],
  rateLimiter: { capacity: 10, refillRate: 5 },
  circuitBreaker: { failureThreshold: 5, successThreshold: 2, resetTimeout: 5000 },
}
```

### With Backup
```typescript
{
  endpoints: [
    { id: "primary", url: "https://soroban-testnet.stellar.org", priority: 0 },
    { id: "backup", url: "https://rpc-testnet.stellar.org", priority: 1 },
  ],
  rateLimiter: { capacity: 10, refillRate: 5 },
  circuitBreaker: { failureThreshold: 5, successThreshold: 2, resetTimeout: 5000 },
}
```

### Multiple Backups
```typescript
{
  endpoints: [
    { id: "primary", url: PRIMARY_URL, priority: 0 },
    { id: "backup-1", url: BACKUP_1_URL, priority: 1 },
    { id: "backup-2", url: BACKUP_2_URL, priority: 2 },
  ],
  rateLimiter: { capacity: 10, refillRate: 5 },
  circuitBreaker: { failureThreshold: 5, successThreshold: 2, resetTimeout: 5000 },
}
```

---

## 📈 Monitoring Snippets

### Health Check
```typescript
import { getHealthStatus } from "./lib/stellar/resilient-stellar-client";

app.get("/health", (req, res) => {
  const health = getHealthStatus();
  res.status(health.healthy ? 200 : 503).json(health);
});
```

### Metrics Endpoint
```typescript
import { getResilientMetrics } from "./lib/stellar/resilient-stellar-client";

app.get("/metrics", (req, res) => {
  const metrics = getResilientMetrics();
  res.json({
    rateLimiter: metrics.rateLimiter,
    circuitBreakers: metrics.circuitBreakers.map(cb => ({
      endpoint: cb.endpoint.id,
      state: cb.metrics.state,
      failures: cb.metrics.totalFailures,
    })),
  });
});
```

### Log Circuit State Changes
```typescript
const client = createResilientClient({
  // ... config
  onCircuitStateChange: (endpoint, oldState, newState) => {
    if (newState === "OPEN") {
      logger.error(`⚠️ ${endpoint.id} circuit OPENED`);
      alerting.send({ severity: "critical", message: `${endpoint.id} down` });
    } else if (newState === "CLOSED") {
      logger.info(`✓ ${endpoint.id} circuit CLOSED`);
    }
  },
});
```

---

## 🧪 Testing Commands

```bash
# Run all resilience tests
npm run test:resilience

# Watch mode (for development)
npm run test:resilience:watch

# With coverage
npm run test:resilience:coverage

# Specific test file
npm test lib/resilience/__tests__/circuit-breaker.test.ts
```

---

## 🐛 Troubleshooting Cheat Sheet

### Problem: "TokenBucket queue full"
**Cause:** Rate limit too low  
**Fix:**
```typescript
rateLimiter: {
  capacity: 20,      // ⬆️ Increase from 10
  refillRate: 10,    // ⬆️ Increase from 5
  maxQueueSize: 200, // ⬆️ Increase from 100
}
```

### Problem: Circuit keeps opening/closing (flapping)
**Cause:** Threshold too sensitive  
**Fix:**
```typescript
circuitBreaker: {
  failureThreshold: 10,  // ⬆️ Increase from 5
  resetTimeout: 3000,    // ⬇️ Decrease from 5000 (faster recovery)
}
```

### Problem: Not using backup endpoint
**Cause:** Circuit not opening or priority wrong  
**Check:**
```typescript
const current = client.getCurrentEndpoint();
console.log("Using:", current.id); // Should show "backup" if primary failed

const metrics = client.metrics();
console.log("Primary state:", 
  metrics.circuitBreakers.find(cb => cb.endpoint.id === "primary")?.metrics.state
);
```

### Problem: Memory leak
**Cause:** Not disposing client  
**Fix:**
```typescript
// ALWAYS dispose on shutdown
process.on("SIGTERM", () => {
  disposeResilientClient(); // For Stellar client
  // OR
  client.dispose(); // For manual client
  process.exit(0);
});
```

---

## 📊 Circuit Breaker States

```
CLOSED (Normal) 
  └─> OPEN (Failing) 
        └─> HALF_OPEN (Testing) 
              ├─> CLOSED (Success)
              └─> OPEN (Failed again, +backoff)
```

| State | Behavior | When |
|-------|----------|------|
| **CLOSED** | Normal operation | Initially, after recovery |
| **OPEN** | Fail-fast (rejects immediately) | After X failures |
| **HALF_OPEN** | Testing with canary requests | After cooldown period |

---

## ⚙️ Parameter Tuning Guide

### Rate Limiter

| Parameter | Low Traffic | Medium Traffic | High Traffic |
|-----------|-------------|----------------|--------------|
| `capacity` | 5-10 | 10-20 | 20-50 |
| `refillRate` | 2-5 | 5-10 | 10-25 |
| `maxQueueSize` | 50-100 | 100-200 | 200-500 |

### Circuit Breaker

| Parameter | Sensitive | Balanced | Tolerant |
|-----------|-----------|----------|----------|
| `failureThreshold` | 3 | 5 | 10-15 |
| `successThreshold` | 1-2 | 2-3 | 3-5 |
| `resetTimeout` | 3000ms | 5000ms | 10000ms |
| `requestTimeout` | 5000ms | 10000ms | 15000ms |

### Recommendations

**Critical services:** Sensitive settings (fail fast)  
**Flaky services:** Tolerant settings (more forgiving)  
**Development:** Lenient settings (faster iteration)  
**Production:** Balanced settings (reliability + availability)

---

## 🔍 Metrics to Monitor

### Rate Limiter
- `availableTokens` - Should stay > 0 most of the time
- `queuedRequests` - Should be 0 or low (< 10)
- `totalRejected` - Should be 0 in normal operation

### Circuit Breaker (per endpoint)
- `state` - Should be "CLOSED" most of the time
- `totalFailures` - Track trending (increasing = problem)
- `totalTimeouts` - Should be low (< 1% of requests)
- `consecutiveFailures` - Reset on success

### Alerts to Set
- ⚠️ Circuit state changes to OPEN
- ⚠️ Rate limiter rejection rate > 1%
- ⚠️ Queue depth consistently > 50% capacity
- ✅ Circuit closes after being open (info alert)

---

## 📁 File Reference

| File | Purpose |
|------|---------|
| `lib/resilience/index.ts` | Main exports |
| `lib/resilience/config.ts` | Presets |
| `lib/stellar/resilient-stellar-client.ts` | Stellar integration |
| `RESILIENCE_IMPLEMENTATION_GUIDE.md` | Full guide |
| `lib/resilience/README.md` | API docs |

---

## 🆘 Emergency Commands

```typescript
// Get current state
import { getHealthStatus, getCurrentRpcEndpoint } from "./lib/stellar/resilient-stellar-client";

console.log("Health:", getHealthStatus());
console.log("Using endpoint:", getCurrentRpcEndpoint());

// Force use specific endpoint (testing only)
// Create new client with only that endpoint
const emergencyClient = createResilientClient({
  endpoints: [{ id: "emergency", url: EMERGENCY_URL, priority: 0 }],
  // ... rest of config
});

// Increase rate limits temporarily
const lenientClient = createResilientClient(LENIENT_RESILIENCE_CONFIG);
```

---

## ✅ Pre-Deployment Checklist

- [ ] Run tests: `npm run test:resilience`
- [ ] Configure endpoints (primary + backups)
- [ ] Set rate limits based on upstream capacity
- [ ] Set circuit breaker thresholds
- [ ] Add health check endpoint
- [ ] Add metrics export
- [ ] Configure alerts
- [ ] Test failover manually
- [ ] Add dispose to shutdown handler
- [ ] Document in runbook

---

## 📞 Quick Links

- **API Docs:** `lib/resilience/README.md`
- **Implementation Guide:** `RESILIENCE_IMPLEMENTATION_GUIDE.md`
- **Complete Deliverables:** `RESILIENCE_DELIVERABLES.md`
- **Tests:** `lib/resilience/__tests__/`

---

**Status:** ✅ Production Ready  
**Version:** 1.0.0  
**Last Updated:** 2026-06-20
