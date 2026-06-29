# Fix: Implement RPC Rate Limit Handling with Exponential Backoff

## 🎯 Problem

The Open-Audit backend continuously polls the Stellar RPC `getEvents` endpoint to listen for new Soroban smart contract interactions. During times of high network congestion or rapid block generation, the indexer occasionally hits the RPC rate limits (HTTP 429 Too Many Requests). When this happens, the indexer drops the current batch of events, leading to **missing logs on the dashboard**.

## ✨ Solution

This PR implements a robust event indexer with:

1. **Exponential Backoff Retry Mechanism**: Automatically retries failed requests with increasing delays (1s → 2s → 4s → 8s → 16s → 32s)
2. **Cursor-Based State Management**: Ensures the cursor is only updated after successful fetch to prevent skipping un-indexed events
3. **Intelligent Error Handling**: Distinguishes between rate limit errors (retry) and other errors (fail fast)
4. **Comprehensive Testing**: Full test coverage for all retry scenarios and edge cases

## 📁 Changes

### New Files

- **`lib/stellar/indexer.ts`**: Core indexer with retry logic and cursor management
- **`lib/stellar/__tests__/indexer.test.ts`**: Comprehensive test suite
- **`lib/stellar/INDEXER_README.md`**: Detailed documentation and usage guide
- **`lib/stellar/example-integration.ts`**: Integration examples for production use

### Modified Files

- **`lib/stellar/client.ts`**: Updated `fetchContractEvents` to use stellar-sdk properly

## 🔑 Key Features

### 1. Exponential Backoff

```typescript
const response = await fetchEventsWithRetry(
  server,
  ["CONTRACT_ID"],
  startLedger,
  {
    initialDelayMs: 1000,    // Start with 1 second
    maxDelayMs: 32000,       // Cap at 32 seconds
    maxRetries: 10,          // Try up to 10 times
    backoffMultiplier: 2,    // Double each time
  }
);
```

### 2. Cursor Safety

```typescript
// Cursor only updates AFTER successful fetch
interface IndexerCursor {
  lastLedger: number;        // Last successfully indexed ledger
  paginationCursor?: string; // RPC pagination cursor
}
```

### 3. Continuous Polling

```typescript
const indexer = startEventIndexer({
  networkConfig: TESTNET_CONFIG,
  contractIds: ["CABC...XYZ"],
  startLedger: 1000,
  pollIntervalMs: 5000,
  onEvents: async (events, cursor) => {
    // Process events - guaranteed to be called only on success
  },
  onError: (error, willRetry) => {
    // Handle errors with context
  },
});
```

## 🧪 Testing

All tests pass with comprehensive coverage:

- ✅ Exponential backoff calculation
- ✅ Successful event fetching
- ✅ Retry on HTTP 429 errors
- ✅ Immediate failure on non-rate-limit errors  
- ✅ Retry exhaustion handling
- ✅ Cursor update only on success
- ✅ Cursor preservation on failure
- ✅ Continuous polling behavior

Run tests:
```bash
npm test lib/stellar/__tests__/indexer.test.ts
```

## 📊 Before vs After

### Before

```
[Request 1] ──429──> ❌ Events dropped
[Request 2] ──429──> ❌ Events dropped  
[Request 3] ──200──> ✅ Events saved (but gaps exist from dropped batches)
```

### After

```
[Request 1] ──429──> [Retry after 1s]  ──429──> [Retry after 2s]  ──200──> ✅ Events saved
[Request 2] ──429──> [Retry after 1s]  ──200──> ✅ Events saved
[Request 3] ──200──> ✅ Events saved
```

**Result**: Zero event loss, even during rate limiting.

## 🎨 Code Standards Compliance

All code follows Open-Audit standards:

- ✅ Standard function declarations (no arrow functions for top-level)
- ✅ No `any` types
- ✅ Interfaces for object shapes
- ✅ Proper naming conventions
- ✅ Comprehensive JSDoc comments
- ✅ Prettier formatting

## 📚 Documentation

Comprehensive documentation included:

- **INDEXER_README.md**: Full usage guide, configuration options, architecture
- **example-integration.ts**: Real-world integration examples
- **Inline JSDoc**: Every function has detailed documentation

## 🚀 Usage Example

```typescript
import { startEventIndexer } from "@/lib/stellar/indexer";
import { TESTNET_CONFIG } from "@/lib/stellar/client";

// Start monitoring a contract
const indexer = startEventIndexer({
  networkConfig: TESTNET_CONFIG,
  contractIds: ["CABC...XYZ"],
  startLedger: 1000,
  pollIntervalMs: 5000,
  
  onEvents: async (events, cursor) => {
    console.log(`Received ${events.length} events at ledger ${cursor.lastLedger}`);
    // Save to database, update UI, etc.
  },
  
  onError: (error, willRetry) => {
    if (willRetry) {
      console.log("Rate limit hit, retrying with backoff...");
    } else {
      console.error("Fatal error:", error);
    }
  },
});

// Stop when needed
indexer.stop();
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Event Indexer                            │
│                                                               │
│  ┌─────────────┐       ┌──────────────┐                     │
│  │   Polling   │──────▶│ Fetch Events │                     │
│  │    Loop     │       │  with Retry  │                     │
│  └─────────────┘       └──────────────┘                     │
│         │                      │                             │
│         │                      │ HTTP 429?                   │
│         │                      ├────Yes────▶ Exponential     │
│         │                      │             Backoff         │
│         │                      │                │            │
│         │                      │◀───────────────┘            │
│         │                      │                             │
│         │                      │ Success                     │
│         │                      ▼                             │
│         │              ┌──────────────┐                      │
│         │              │ Update Cursor│                      │
│         │              └──────────────┘                      │
│         │                      │                             │
│         │                      ▼                             │
│         │              ┌──────────────┐                      │
│         └──────────────│  onEvents()  │                      │
│                        └──────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## ✅ Checklist

- [x] Intercept HTTP 429 errors in RPC fetcher logic
- [x] Implement exponential backoff retry mechanism
- [x] Ensure cursor updates only after successful fetch
- [x] Add comprehensive test suite
- [x] Follow project code standards
- [x] Add documentation and examples
- [x] No breaking changes to existing API

## 🔮 Future Enhancements

Potential improvements for future PRs:

1. **Database persistence** for cursor state (crash recovery)
2. **Metrics/monitoring** endpoint for indexer health
3. **Adaptive polling** based on event volume
4. **Multi-contract batching** for efficiency
5. **Circuit breaker** pattern for prolonged failures

## 📝 Testing Instructions

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run tests:
   ```bash
   npm test lib/stellar/__tests__/indexer.test.ts
   ```

3. Test integration (optional):
   ```typescript
   // See example-integration.ts for usage
   import { startMonitoringContract } from "@/lib/stellar/example-integration";
   const indexer = startMonitoringContract("YOUR_CONTRACT_ID");
   ```

## 🎉 Impact

This implementation provides a **production-ready** solution that:

- ✅ **Eliminates event loss** during rate limiting
- ✅ **Maintains data integrity** with cursor-based state management
- ✅ **Scales gracefully** under high network congestion
- ✅ **Provides clear visibility** into errors and retries
- ✅ **Follows best practices** with comprehensive testing and documentation

## 📞 Questions?

See `INDEXER_README.md` for detailed documentation, or check `example-integration.ts` for integration examples.

---

**Related Issue**: Open-Audit rate limiting issue  
**Type**: Feature / Bug Fix  
**Breaking Changes**: None  
**Dependencies**: Uses existing `stellar-sdk` package
