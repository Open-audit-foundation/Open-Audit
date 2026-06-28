# Open-Audit Codebase Analysis & Technical Summary

**Last Updated:** June 19, 2026  
**Scope:** Complete architectural analysis, database strategy, and reconciliation worker recommendations

---

## Executive Summary

Open-Audit is a **real-time event indexing and translation system** for the Stellar/Soroban blockchain. The application currently:

- ✅ Fetches contract events from Stellar RPC via polling with exponential backoff retry logic
- ✅ Translates hex-encoded events into human-readable descriptions using a blueprint registry
- ✅ Broadcasts events in real-time via WebSocket to connected dashboard clients
- ✅ Provides optional Redis caching for RPC responses
- ⚠️ **Does NOT persist events to any database** — all data is ephemeral (in-memory)
- ⚠️ **No ORM/database library** — no Prisma, TypeORM, or SQL layer

**Critical Finding:** The current system is **stateless and broadcast-only**. There is no event durability, historical record storage, or data reconciliation mechanism. Implementing reconciliation requires adding database persistence first.

---

## 1. Current Database Structure & Event Storage

### 1.1 Current State: No Persistence

**Status:** ❌ **No database exists**

The application currently has **zero database storage**:

- Events flow in-memory only: `RPC → Indexer → Translator → WebSocket → Client`
- No data is persisted to disk
- On server restart, all history is lost
- Clients see only events emitted after connection time

**Evidence:**

- `package.json`: No database dependencies (no Prisma, TypeORM, SQLite, PostgreSQL, MongoDB, etc.)
- `lib/cache/redisCache.ts`: Only optional Redis caching of _RPC requests_, not event storage
- `server.ts`: Broadcast-only server, no persistence layer
- `ARCHITECTURE.md`: No mention of a persistence component

### 1.2 Event Data Structure

**In-Memory Event Format (`RawEvent`):**

```typescript
interface RawEvent {
  id: string; // Unique identifier (ledger + index)
  contractId: string; // Soroban contract address
  topics: string[]; // Hex-encoded event topics
  data: string; // Hex-encoded event payload
  ledger: number; // Ledger sequence number
  timestamp: number; // Unix timestamp (seconds)
  txHash: string; // Transaction hash
}
```

**Translated Output (`TranslatedEvent`):**

```typescript
interface TranslatedEvent {
  raw: RawEvent; // Original raw event
  description: string | null; // Human-readable text
  status: "translated" | "cryptic" | "pending";
  blueprintName: string | null; // Contract name
  eventType: string | null; // Event type (transfer, mint, burn, etc.)
}
```

### 1.3 Recommendation for Database Implementation

For the reconciliation worker to function, you must first implement a database layer:

**Recommended Stack:**

- **ORM:** Prisma (excellent TypeScript support, migrations, type safety)
- **Database:** PostgreSQL (best for blockchain data, ACID transactions, full-text search)
- **Caching:** Redis (already configured in `lib/cache/redisCache.ts`)

**Minimal Schema:**

```prisma
model Event {
  id              String   @id @unique
  contractId      String
  ledger          Int
  timestamp       Int
  txHash          String
  topics          Json       // Store as JSON array
  data            String
  description     String?    // Translated text
  status          String     // "translated" | "cryptic"
  blueprintName   String?
  eventType       String?
  createdAt       DateTime   @default(now())

  @@index([contractId])
  @@index([ledger])
  @@index([timestamp])
}

model IndexerCursor {
  id              String   @id @default("current")
  lastLedger      Int
  lastProcessed   DateTime @default(now())
}
```

---

## 2. Event Indexer Implementation

### 2.1 Core Indexing Pattern

**File:** [lib/stellar/indexer.ts](lib/stellar/indexer.ts)

**Architecture:**

```
┌─────────────────────────────────────────────┐
│         Polling Loop (every 5s)              │
│  startHorizonStreamingIndexer()              │
│                                              │
│  ├─ Connects to Stellar Horizon stream       │
│  ├─ Decodes XDR events from transactions     │
│  ├─ Filters by contract ID                  │
│  ├─ Auto-reconnect on error (5s delay)      │
│  └─ Calls onEvent callback per event        │
│                                              │
└──────────────┬──────────────────────────────┘
               │
         Broadcast via WebSocket
```

**Key Implementation Details:**

1. **Polling Mechanism:**
   - Uses `startHorizonStreamingIndexer()` for real-time streaming
   - Falls back to 5-second interval polling if streaming unavailable
   - Maintains cursor state to track last indexed ledger

2. **Exponential Backoff Retry:**
   - Initial delay: 1 second
   - Max delay: 32 seconds
   - Multiplier: 2x per retry
   - Max retries: 10 attempts
   - Only retries on HTTP 429 (rate limit) errors

3. **Error Handling:**
   - Rate limit errors: Automatic retry with exponential backoff
   - Other errors: Immediate failure + error callback
   - Custom error callback: `onError(error, willRetry)`

**Configuration:**

```typescript
interface IndexerOptions {
  networkConfig: StellarNetworkConfig;
  contractIds: string[]; // Which contracts to monitor
  startLedger: number; // Starting point
  pollIntervalMs: number; // Poll frequency
  retryConfig?: IndexerRetryConfig;
  onEvents: EventBatchHandler; // Callback when events arrive
  onError?: ErrorHandler; // Callback on errors
}
```

### 2.2 Cursor Management

**Critical Feature:** Events are **never lost** even during failures.

**How it works:**

```typescript
interface IndexerCursor {
  lastLedger: number; // Last successfully indexed ledger
  paginationCursor?: string; // RPC pagination cursor (optional)
}
```

**Cursor Update Logic:**

```
1. Check cursor: lastLedger = 1000
2. Fetch events from ledger 1000
   ├─ Success: Update cursor to 1005
   └─ Failure: Keep cursor at 1000 (retry from same point)
3. Next poll: Resume from ledger 1005 (or 1000 if previous failed)
```

**For Reconciliation:** You must persist this cursor to the database to survive server restarts.

### 2.3 Rate Limit Handling

The indexer gracefully handles HTTP 429 errors from Stellar RPC:

```typescript
// Check if error is rate limit
function isRateLimitError(error: unknown): boolean {
  const message = error.message.toLowerCase();
  return message.includes("429") || message.includes("rate limit");
}

// Calculate next retry delay
function calculateRetryDelay(attempt: number, config: IndexerRetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxDelayMs);
}
```

---

## 3. Existing Event Ingestion Patterns

### 3.1 Real-Time Streaming (Current)

**File:** [server.ts](server.ts)

```typescript
const indexer = startHorizonStreamingIndexer({
  networkConfig: getNetworkConfig(),
  onEvent: (rawEvent) => {
    const translated = translateEvent(rawEvent);
    broadcast(translated); // Send to all WebSocket clients
  },
  onError: (err) => console.error("[Indexer] Error:", err);
});
```

**Flow:**

1. Horizon stream emits new transaction
2. XDR decoded to extract Soroban events
3. Events run through translation engine
4. Translated events broadcast to all connected WebSocket clients
5. Frontend updates dashboard in real-time

### 3.2 Historical Ingestion (Available)

**File:** [lib/stellar/historical-ingester.ts](lib/stellar/historical-ingester.ts)

For backfilling old events from a specific ledger range:

```typescript
await ingestHistoricalRange({
  networkConfig: TESTNET_CONFIG,
  contractId: "CABC...",
  startSequence: 1000,
  endSequence: 5000,
  chunkSize: 1000, // Fetch 1000 ledgers per request
  onChunkComplete: async (result) => {
    console.log(`Chunk ${result.chunkIndex}: ${result.eventCount} events`);
    // Save to database here
  },
  onComplete: async (totalEvents) => {
    console.log(`Total events: ${totalEvents}`);
  },
});
```

**API Endpoint:** `POST /api/ingest-historical`

```json
{
  "contractId": "CABC...",
  "startSequence": 1000,
  "endSequence": 5000,
  "chunkSize": 1000
}
```

### 3.3 Event Translation Pipeline

**File:** [lib/translator/registry.ts](lib/translator/registry.ts)

```typescript
function translateEvent(
  event: RawEvent,
  customBlueprints?: Map<string, TranslationBlueprint>,
  lang: Language = "en"
): TranslatedEvent {
  // 1. Check custom blueprints first (user-uploaded ABIs)
  const custom = customBlueprints?.get(event.contractId);

  // 2. Fall back to global registry
  const blueprint = REGISTRY.get(event.contractId);

  // 3. Apply blueprint or mark as cryptic
  return applyBlueprint(event, blueprint, lang);
}
```

**Currently Supported Blueprints:**

- Stellar Asset Contract (SAC) — Transfer, Mint, Burn events
- Custom blueprints uploaded by users (stored in browser localStorage)

**Translations Available In:**

- English (en)
- Spanish (es)
- French (fr)
- Chinese (zh)

---

## 4. Database Library/ORM Status

### 4.1 Current State

**Status:** ❌ **No ORM/Database Library in Use**

```json
// package.json dependencies
{
  "next": "14.2.3",
  "react": "^18",
  "stellar-sdk": "^12.1.0",
  "ws": "^8.18.0"
  // ... NO DATABASE LIBRARIES
}
```

### 4.2 Optional Redis Caching

**File:** [lib/cache/redisCache.ts](lib/cache/redisCache.ts)

Redis is optionally used to **cache RPC responses** (not events):

```typescript
// Enable Redis with environment variables
REDIS_URL=redis://localhost:6379
REDIS_TTL_SECONDS=3600

// Usage: Cache RPC getEvents calls
const cached = await getCachedEvents(sorobanUrl, contractIds, startLedger);
```

**Benefits:**

- Reduces RPC rate limiting pressure
- Speeds up historical ingestion
- Configurable TTL

**Does NOT replace:** Need for persistent event database

### 4.3 What You Need to Add

For reconciliation, you must implement:

1. **Prisma ORM** (recommended)

   ```bash
   npm install @prisma/client
   npm install -D prisma
   npx prisma init
   ```

2. **Database** (PostgreSQL recommended)

   ```
   PostgreSQL for production-grade performance
   SQLite for development/testing
   ```

3. **Migrations**
   ```typescript
   // Create with Prisma
   npx prisma migrate dev --name init
   ```

---

## 5. Server Setup & WebSocket/Background Processes

### 5.1 Server Architecture

**File:** [server.ts](server.ts)

```typescript
// Custom Next.js server with attached WebSocket server
const httpServer = createServer((req, res) => {
  // Handle HTTP requests (Next.js app)
  handle(req, res, parsedUrl);
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws/events" });

// Broadcast function sends to all connected clients
function broadcast(data: unknown): void {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

httpServer.listen(3000);
```

**Why Custom Server?**

- Next.js App Router handles HTTP requests
- Custom server adds WebSocket support for real-time streaming
- Single port (3000) for both HTTP and WebSocket

### 5.2 WebSocket Flow

**Client Connection:**

```
Browser → HTTP Upgrade → ws://localhost:3000/ws/events → WebSocket
```

**Event Broadcast:**

```
Stellar RPC → Indexer → Translator → broadcast() → All WebSocket clients
```

**Auto-Reconnect:**

```typescript
// Client-side: useLiveFeed hook
const connect = useCallback(() => {
  const ws = new WebSocket(WS_URL);
  ws.onclose = () => {
    // Auto-reconnect after 3 seconds
    setTimeout(() => connect(), 3000);
  };
}, []);
```

### 5.3 Background Processing

**Current Status:** ❌ **No background job queue**

The system currently has:

- ✅ Real-time streaming indexer (runs in Node.js process)
- ✅ Periodic polling loop (5-second intervals)
- ❌ No queue system (no Bull, Bee-Queue, RabbitMQ, etc.)
- ❌ No scheduled tasks (no node-cron, node-schedule)

**For Reconciliation:** You need a background job system:

```typescript
// Recommended: Bull (Redis-based queue)
npm install bull

// Usage example
const eventQueue = new Queue('events', process.env.REDIS_URL);

eventQueue.process(async (job) => {
  // Reconcile events, validate state, etc.
  const result = await reconcileEvents(job.data);
  return result;
});

// Add job
await eventQueue.add({
  contractId: "CABC...",
  ledgerRange: [1000, 5000]
});
```

---

## 6. Queue Systems & Background Job Handling

### 6.1 Current Implementation

**Status:** ❌ **No queue system exists**

The application uses direct callbacks instead:

```typescript
// Events flow directly through callbacks
startHorizonStreamingIndexer({
  onEvent: (rawEvent) => {
    // Direct processing
    const translated = translateEvent(rawEvent);
    broadcast(translated);
  },
});
```

### 6.2 Issues with Current Pattern

1. **No retry logic** — Failed processing drops events
2. **No persistence** — Queued events lost on crash
3. **No throttling** — Rapid events can overwhelm resources
4. **No scheduling** — Can't run periodic reconciliation tasks
5. **No monitoring** — No visibility into failed events

### 6.3 Recommended Queue Implementation for Reconciliation

**Use Bull with Redis:**

```typescript
// 1. Create job processor
eventQueue.process(10, async (job) => {
  const { eventId, contractId } = job.data;

  try {
    // Reconciliation logic
    const dbEvent = await db.event.findUnique({ where: { id: eventId } });
    const rpcEvent = await fetchEventFromRpc(eventId);

    if (!eventsMatch(dbEvent, rpcEvent)) {
      await logDiscrepancy(eventId, dbEvent, rpcEvent);
    }

    return { success: true, eventId };
  } catch (error) {
    throw error; // Retry automatically
  }
});

// 2. Handle retries and failures
eventQueue.on("failed", (job, error) => {
  console.error(`Job ${job.id} failed: ${error.message}`);
  // Log to database
});

// 3. Add periodic reconciliation task
eventQueue.repeat(
  { jobId: "daily-reconciliation", every: 86400000 },
  { task: "reconcile", ledgerStart: 0 }
);
```

**Configuration:**

```typescript
interface JobConfig {
  attempts: number; // Retry attempts
  backoff: { type: string; delay: number }; // Exponential backoff
  removeOnComplete: boolean; // Clean up completed jobs
  removeOnFail: boolean; // Keep failed jobs for analysis
}
```

---

## 7. Environment Configuration & RPC Management

### 7.1 Current Environment Variables

**File:** [lib/stellar/client.ts](lib/stellar/client.ts)

```typescript
// Network Selection
NEXT_PUBLIC_NETWORK = "testnet" | "mainnet";

// Testnet (Default)
NEXT_PUBLIC_HORIZON_URL = "https://horizon-testnet.stellar.org";
NEXT_PUBLIC_SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
NEXT_PUBLIC_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

// Mainnet
NEXT_PUBLIC_HORIZON_URL = "https://horizon.stellar.org";
NEXT_PUBLIC_SOROBAN_RPC_URL = "https://mainnet.stellar.validationcloud.io/v1/...";
NEXT_PUBLIC_NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015";
```

**Optional Redis Caching:**

```typescript
REDIS_URL = "redis://localhost:6379";
REDIS_TTL_SECONDS = 3600;
```

### 7.2 Network Configuration

**File:** [lib/stellar/client.ts](lib/stellar/client.ts)

```typescript
export interface StellarNetworkConfig {
  horizonUrl: string;
  sorobanRpcUrl: string;
  networkPassphrase: string;
}

export const TESTNET_CONFIG: StellarNetworkConfig = {
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

export const MAINNET_CONFIG: StellarNetworkConfig = {
  horizonUrl: "https://horizon.stellar.org",
  sorobanRpcUrl: "https://mainnet.stellar.validationcloud.io/v1/...",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
};
```

### 7.3 RPC Connection Management

**Single Server Pattern:**

```typescript
const server = new SorobanRpc.Server(config.sorobanRpcUrl);

// Connection is stateless (HTTP-based)
// New connection per request
const response = await server.getEvents({
  startLedger: 1000,
  filters: [{ type: "contract", contractIds: ["CABC..."] }],
});
```

**Retry Configuration:**

```typescript
export const DEFAULT_RETRY_CONFIG: IndexerRetryConfig = {
  initialDelayMs: 1000, // Start with 1s
  maxDelayMs: 32000, // Cap at 32s
  maxRetries: 10, // Try 10 times
  backoffMultiplier: 2, // 1s → 2s → 4s → 8s... → 32s
};
```

### 7.4 Recommended Enhanced Configuration

For reconciliation worker, add:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/openaudit
DATABASE_POOL_SIZE=20

# Job Queue
REDIS_URL=redis://localhost:6379
QUEUE_CONCURRENCY=5
QUEUE_MAX_ATTEMPTS=3

# Reconciliation
RECONCILIATION_BATCH_SIZE=1000
RECONCILIATION_INTERVAL_HOURS=1
RECONCILIATION_LOOKBACK_DAYS=7

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Monitoring
SENTRY_DSN=https://...
```

---

## 8. Architecture Diagram: Current State

```mermaid
flowchart TB
    subgraph Network["🌐 Stellar Network"]
        Horizon["Horizon Stream"]
        RPC["Soroban RPC"]
    end

    subgraph Backend["⚙️ Backend (Node.js)"]
        Indexer["Event Indexer<br/>lib/stellar/indexer.ts<br/>- Streaming from Horizon<br/>- 5s polling fallback<br/>- Exponential backoff retry<br/>- Cursor management"]

        Translator["Translation Engine<br/>lib/translator/registry.ts<br/>- Blueprint lookup<br/>- XDR decoding<br/>- Multi-language support"]

        WSServer["WebSocket Server<br/>server.ts<br/>- Real-time broadcast<br/>- Auto-reconnect support<br/>- Per-client state"]

        Redis["Optional Redis<br/>lib/cache/redisCache.ts<br/>- RPC response caching<br/>- TTL support"]
    end

    subgraph Storage["💾 Storage (MISSING)"]
        Database["❌ No Database<br/>Needs implementation:<br/>- Prisma + PostgreSQL<br/>- Event persistence<br/>- Cursor state<br/>- Reconciliation records"]
    end

    subgraph Frontend["🎨 Frontend"]
        WebSocket["Browser WebSocket Client<br/>lib/hooks/useLiveFeed.ts<br/>- Live connection<br/>- Auto-reconnect<br/>- Pause/Resume"]

        Dashboard["Event Dashboard<br/>app/dashboard/"]
    end

    Horizon -->|Stream transactions| Indexer
    RPC -->|Poll getEvents| Indexer
    Indexer -->|Raw events| Translator
    Indexer -->|Cache requests| Redis
    Translator -->|Translated events| WSServer
    WSServer -->|Broadcast| WebSocket
    WebSocket -->|Real-time updates| Dashboard

    Indexer -.->|Should store| Database
    Dashboard -.->|Should query| Database

    style Network fill:#7B2FBE,color:#fff
    style Backend fill:#2E86AB,color:#fff
    style Storage fill:#DC143C,color:#fff
    style Frontend fill:#06A77D,color:#fff
    style Database fill:#FF6347,color:#fff
```

---

## 9. Reconciliation Worker Implementation Recommendations

### 9.1 Architecture Pattern

**Recommended Structure:**

```
┌─────────────────────────────────────────────┐
│     Reconciliation Worker System             │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ 1. Event Persistence Layer           │   │
│  │    - Store events as they arrive     │   │
│  │    - Track processing status         │   │
│  │    - Database cursor for restarts    │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ 2. Job Queue (Bull + Redis)          │   │
│  │    - Queue reconciliation tasks      │   │
│  │    - Retry failed reconciliations    │   │
│  │    - Track job status                │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ 3. Reconciliation Engine             │   │
│  │    - Compare DB vs RPC source        │   │
│  │    - Detect missing/mismatched data  │   │
│  │    - Flag anomalies for review       │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ 4. Monitoring & Alerting             │   │
│  │    - Track reconciliation stats      │   │
│  │    - Alert on data discrepancies     │   │
│  │    - Logs for audit trail            │   │
│  └──────────────────────────────────────┘   │
│                                              │
└─────────────────────────────────────────────┘
```

### 9.2 Implementation Phases

**Phase 1: Database Foundation (Week 1)**

1. Add Prisma ORM
2. Create Event schema
3. Create IndexerCursor schema
4. Add database initialization to server.ts

**Phase 2: Event Persistence (Week 2)**

1. Modify indexer to save events to database
2. Update cursor on successful save
3. Add health check endpoint
4. Test durability (restart = no data loss)

**Phase 3: Job Queue Setup (Week 3)**

1. Install Bull and configure Redis
2. Create job processor functions
3. Implement reconciliation job
4. Add monitoring dashboard

**Phase 4: Reconciliation Logic (Week 4)**

1. Build RPC comparison engine
2. Implement discrepancy detection
3. Create audit logging
4. Add alerting mechanism

### 9.3 Where to Place Reconciliation Components

**Recommended File Structure:**

```
lib/
├── db/
│   ├── client.ts                    # Prisma client setup
│   └── seed.ts                      # Database seeding
├── reconciliation/
│   ├── engine.ts                    # Core reconciliation logic
│   ├── comparator.ts                # DB vs RPC comparison
│   ├── auditor.ts                   # Audit trail logging
│   └── metrics.ts                   # Metrics collection
├── jobs/
│   ├── queue.ts                     # Bull queue setup
│   ├── reconciliation-job.ts        # Job processor
│   └── job-handlers.ts              # Job callbacks
├── stellar/
│   └── indexer.ts                   # (modify to persist events)
└── hooks/
    └── useReconciliationStatus.ts   # (new) Status polling

prisma/
├── schema.prisma                    # Database schema
└── migrations/
    └── 001_init.sql                 # Initial schema

pages/api/
├── reconciliation/
│   ├── status.ts                    # GET current status
│   ├── trigger.ts                   # POST trigger reconciliation
│   └── history.ts                   # GET reconciliation history

components/dashboard/
└── ReconciliationStatus.tsx         # (new) Status widget
```

### 9.4 Database Schema for Reconciliation

```prisma
model Event {
  id              String   @id @unique
  contractId      String   @index
  ledger          Int      @index
  timestamp       Int
  txHash          String
  topics          Json
  data            String
  description     String?
  status          String   // "translated" | "cryptic"
  blueprintName   String?
  eventType       String?

  // Reconciliation fields
  rpcVerified     Boolean  @default(false)
  lastRpcCheck    DateTime?
  discrepancies   String?  // JSON array of issues

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model ReconciliationJob {
  id              String   @id @default(cuid())
  status          String   // "pending" | "processing" | "completed" | "failed"
  startLedger     Int
  endLedger       Int

  eventsProcessed Int      @default(0)
  eventsMatched   Int      @default(0)
  eventsSkipped   Int      @default(0)
  eventsError     Int      @default(0)

  discrepancies   Json     // Array of { eventId, issue, action }

  startedAt       DateTime?
  completedAt     DateTime?
  error           String?

  createdAt       DateTime @default(now())
}

model IndexerCursor {
  id              String   @id @default("current")
  lastLedger      Int
  paginationCursor String?
  lastUpdateTime  DateTime @default(now())
}
```

### 9.5 Core Reconciliation Job Implementation

```typescript
// lib/reconciliation/engine.ts

export interface ReconciliationResult {
  eventId: string;
  matched: boolean;
  issues?: string[];
  action?: "alert" | "fix" | "log";
}

export async function reconcileEvent(
  eventId: string,
  db: PrismaClient
): Promise<ReconciliationResult> {
  // 1. Get event from database
  const dbEvent = await db.event.findUnique({ where: { id: eventId } });
  if (!dbEvent) {
    return { eventId, matched: false, issues: ["Not found in database"] };
  }

  // 2. Fetch from RPC as source of truth
  const rpcEvent = await fetchEventFromRpc(eventId);
  if (!rpcEvent) {
    return {
      eventId,
      matched: false,
      issues: ["Not found in RPC (event may have been pruned)"],
      action: "log",
    };
  }

  // 3. Compare all fields
  const issues: string[] = [];

  if (dbEvent.contractId !== rpcEvent.contractId) {
    issues.push(`Contract ID mismatch: DB=${dbEvent.contractId}, RPC=${rpcEvent.contractId}`);
  }
  if (dbEvent.ledger !== rpcEvent.ledger) {
    issues.push(`Ledger mismatch: DB=${dbEvent.ledger}, RPC=${rpcEvent.ledger}`);
  }
  if (JSON.stringify(dbEvent.topics) !== JSON.stringify(rpcEvent.topics)) {
    issues.push("Topics mismatch");
  }
  if (dbEvent.data !== rpcEvent.data) {
    issues.push("Data mismatch");
  }

  // 4. Update database with reconciliation result
  await db.event.update({
    where: { id: eventId },
    data: {
      rpcVerified: issues.length === 0,
      lastRpcCheck: new Date(),
      discrepancies: issues.length > 0 ? JSON.stringify(issues) : null,
    },
  });

  return {
    eventId,
    matched: issues.length === 0,
    issues: issues.length > 0 ? issues : undefined,
    action: issues.length > 0 ? "alert" : undefined,
  };
}
```

---

## 10. Summary & Quick-Start Checklist

### 10.1 Key Findings

| Aspect             | Status     | Details                                  |
| ------------------ | ---------- | ---------------------------------------- |
| **Database**       | ❌ None    | No persistence layer exists              |
| **ORM**            | ❌ None    | Must add Prisma + PostgreSQL             |
| **Event Storage**  | ❌ None    | In-memory only, lost on restart          |
| **Indexer**        | ✅ Mature  | Robust retry logic, cursor management    |
| **Translation**    | ✅ Mature  | Blueprint registry, multi-language       |
| **WebSocket**      | ✅ Working | Real-time streaming, auto-reconnect      |
| **Queue System**   | ❌ None    | No background jobs (need Bull/Redis)     |
| **Monitoring**     | ⚠️ Partial | Logging exists, no metrics/alerts        |
| **RPC Management** | ✅ Good    | Rate limit handling, exponential backoff |

### 10.2 Pre-Reconciliation Requirements

**Must Complete First:**

1. ✅ Install Prisma

   ```bash
   npm install @prisma/client
   npm install -D prisma
   ```

2. ✅ Set up PostgreSQL database

   ```bash
   # Docker recommended
   docker run -e POSTGRES_PASSWORD=password -p 5432:5432 postgres:15
   ```

3. ✅ Initialize Prisma schema

   ```bash
   npx prisma init
   npx prisma migrate dev --name init
   ```

4. ✅ Modify indexer to persist events

   ```typescript
   // In server.ts, after translating events:
   await db.event.create({ data: translatedEvent });
   ```

5. ✅ Add Bull + Redis queue
   ```bash
   npm install bull redis
   ```

### 10.3 Implementation Order

```
1. Database Setup (Foundation)
   └─ Prisma + PostgreSQL schema

2. Event Persistence (Data Layer)
   └─ Modify indexer to save events

3. Cursor Management (Durability)
   └─ Persist cursor to database

4. Queue Infrastructure (Job System)
   └─ Bull + Redis setup

5. Reconciliation Engine (Core Logic)
   └─ Compare DB vs RPC, detect discrepancies

6. Monitoring & Alerts (Observability)
   └─ Metrics, logging, alerting

7. Admin Dashboard (Operations)
   └─ Status page, manual triggers, history
```

### 10.4 Recommended Files to Create

```
✅ lib/db/client.ts                  - Prisma initialization
✅ lib/reconciliation/engine.ts      - Reconciliation logic
✅ lib/reconciliation/comparator.ts  - Event comparison
✅ lib/jobs/queue.ts                 - Bull queue setup
✅ lib/jobs/reconciliation-job.ts    - Job processor
✅ pages/api/reconciliation/status.ts - Status endpoint
✅ prisma/schema.prisma              - Database schema
```

---

## 11. References & Resources

- **ARCHITECTURE.md**: Full system architecture documentation
- **lib/stellar/indexer.ts**: Event indexer with retry logic (332 lines)
- **lib/translator/registry.ts**: Translation engine (300+ lines)
- **server.ts**: WebSocket server implementation
- **IMPLEMENTATION_SUMMARY.md**: Rate limit handling implementation

**External Resources:**

- [Prisma Documentation](https://www.prisma.io/docs/)
- [Bull Queue Documentation](https://github.com/OptimalBits/bull)
- [Stellar SDK Reference](https://developers.stellar.org/docs/build/smart-contracts)
- [Soroban Event Streaming](https://developers.stellar.org/docs/build/smart-contracts/events)

---

**Document Status:** Complete and Ready for Implementation  
**Recommendation:** Start with Phase 1 (Database Foundation) — all other components depend on it.
