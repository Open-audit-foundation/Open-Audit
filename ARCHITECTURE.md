# Open-Audit Architecture

> **A comprehensive guide to understanding how data flows through Open-Audit**

This document provides a detailed architectural overview of Open-Audit, the "Google Translate for Soroban" — an open-source transparency tool that transforms cryptic blockchain events into human-readable sentences.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Component Deep Dive](#component-deep-dive)
4. [Data Flow](#data-flow)
5. [Key Technologies](#key-technologies)
6. [Development Guide](#development-guide)

---

## System Overview

Open-Audit is a full-stack application that bridges the gap between raw blockchain data and human understanding. The system consists of five major components that work together to fetch, translate, store, and display Soroban smart contract events.

### High-Level Architecture

```
┌─────────────────┐
│  Stellar Network│  Raw XDR events emitted by smart contracts
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Event Indexer   │  Polls RPC with rate limit handling
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Translation     │  Converts hex data to human-readable text
│ Registry        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ WebSocket       │  Real-time event streaming
│ Server          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Frontend        │  Interactive dashboard with search & filters
│ Dashboard       │
└─────────────────┘
```

---

## Architecture Diagram

```mermaid
flowchart TB
    subgraph StellarNetwork["🌐 Stellar Network"]
        RPC["Soroban RPC Server<br/>soroban-testnet.stellar.org"]
        Contracts["Smart Contracts<br/>(SAC, Soroswap, etc.)"]
        Contracts -->|emit events| RPC
    end

    subgraph Backend["⚙️ Backend Services (Node.js)"]
        subgraph Indexer["Event Indexer (lib/stellar/indexer.ts)"]
            Poller["Polling Loop<br/>(every 5s)"]
            RetryLogic["Exponential Backoff<br/>Retry Logic"]
            Cursor["Cursor Manager<br/>(tracks last ledger)"]
            
            Poller --> RetryLogic
            RetryLogic --> Cursor
        end
        
        subgraph Translator["Translation Engine (lib/translator/)"]
            Registry["Translation Registry<br/>(registry.ts)"]
            Blueprints["Contract Blueprints<br/>(blueprints/)"]
            Decoder["XDR Decoder<br/>(decode.ts)"]
            
            Registry --> Blueprints
            Blueprints --> Decoder
        end
        
        WSServer["WebSocket Server<br/>(server.ts)<br/>Port: 3000<br/>Path: /ws/events"]
        
        Indexer -->|RawEvent[]| Translator
        Translator -->|TranslatedEvent[]| WSServer
    end

    subgraph Frontend["🎨 Frontend (Next.js 14 + React)"]
        subgraph UI["Dashboard UI (app/dashboard/)"]
            EventTable["Event Feed Table<br/>(EventFeedTable.tsx)"]
            SearchBar["Search & Filters<br/>(SearchBar.tsx)"]
            StatsBar["Statistics Bar<br/>(StatsBar.tsx)"]
            RawDialog["Raw Data Viewer<br/>(RawDataDialog.tsx)"]
        end
        
        subgraph Hooks["React Hooks (lib/hooks/)"]
            LiveFeed["useLiveFeed<br/>(WebSocket client)"]
        end
        
        LiveFeed -->|new events| EventTable
        EventTable --> SearchBar
        EventTable --> StatsBar
        EventTable --> RawDialog
    end

    RPC -->|"getEvents()<br/>(HTTP 429 handled)"| Poller
    WSServer -->|"WebSocket<br/>(real-time)"| LiveFeed

    style StellarNetwork fill:#7B2FBE,color:#fff
    style Backend fill:#2E86AB,color:#fff
    style Frontend fill:#06A77D,color:#fff
    style Indexer fill:#3BACB6,color:#fff
    style Translator fill:#3BACB6,color:#fff
    style UI fill:#0E9594,color:#fff
    style Hooks fill:#0E9594,color:#fff
```

---

## Component Deep Dive

### 1. Stellar Network

**Location:** External (https://soroban-testnet.stellar.org)

The Stellar Network is where smart contracts live and emit events. When a contract executes (e.g., a token transfer), it emits events encoded in XDR (External Data Representation) — a binary format that's cryptic to humans.

**Key Concepts:**
- **Contracts:** Smart contracts deployed on Stellar (e.g., SAC tokens, DEX protocols)
- **Events:** Emitted by contracts during execution, containing topics and data
- **Ledgers:** Blocks on Stellar, each containing transactions and events
- **RPC Endpoint:** The Soroban RPC server provides the `getEvents` API

**Example Raw Event:**
```json
{
  "id": "0000123456-0001",
  "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "topics": ["0x00000000000000000000000000000000000000000000000000000000000000000000000000"],
  "data": "0x000000140000000200000000000000000000000000000000...",
  "ledger": 123456,
  "timestamp": 1713456789,
  "txHash": "abc123..."
}
```

---

### 2. Event Indexer

**Location:** `lib/stellar/indexer.ts`, `lib/stellar/client.ts`

The Event Indexer is responsible for continuously fetching new events from the Stellar RPC endpoint. It implements robust error handling to deal with rate limits (HTTP 429 errors) using exponential backoff.

**Key Features:**

#### Exponential Backoff Retry
When the RPC server returns a 429 error, the indexer doesn't give up. Instead:
1. Wait 1 second
2. Retry → If fails, wait 2 seconds
3. Retry → If fails, wait 4 seconds
4. Retry → If fails, wait 8 seconds
5. Continue up to 32 seconds max

This prevents hammering the server and ensures no events are lost.

#### Cursor-Based Pagination
The indexer maintains a cursor (last successfully indexed ledger) to ensure continuity:
- **Before fetch:** Cursor = Ledger 1000
- **Fetch fails:** Cursor stays at 1000 (retry from same point)
- **Fetch succeeds:** Cursor updates to Ledger 1005
- **Next poll:** Starts from Ledger 1005

This guarantees no events are skipped even during failures.

#### Polling Loop
```typescript
setInterval(() => {
  // 1. Fetch events from RPC (with retry logic)
  const events = await fetchEventsWithRetry(server, contractIds, cursor);
  
  // 2. Update cursor only on success
  cursor = events.latestLedger;
  
  // 3. Pass to translation engine
  translateAndBroadcast(events);
}, 5000); // Poll every 5 seconds
```

**Configuration:**
```typescript
{
  pollIntervalMs: 5000,        // Poll every 5 seconds
  initialDelayMs: 1000,        // Start with 1s retry delay
  maxDelayMs: 32000,           // Cap at 32s
  maxRetries: 10,              // Try up to 10 times
  backoffMultiplier: 2         // Double delay each retry
}
```

---

### 3. Translation Engine

**Location:** `lib/translator/registry.ts`, `lib/translator/blueprints/`, `lib/translator/decode.ts`

The Translation Engine is the heart of Open-Audit. It takes raw XDR events and converts them into plain English.

**Architecture:**

#### Translation Registry (`registry.ts`)
The central lookup table that maps contract IDs to their blueprints:
```typescript
Map<ContractID, TranslationBlueprint>
```

When an event arrives:
1. Look up contract ID in registry
2. If found, call the blueprint's `translate()` function
3. Return translated event with human-readable description
4. If not found, mark as "cryptic"

#### Translation Blueprints (`blueprints/`)
Each contract gets its own blueprint — a file that knows how to decode that contract's events.

**Example: SAC Transfer Blueprint**
```typescript
export function createSacTransferBlueprint(contractId: string): TranslationBlueprint {
  return {
    contractId,
    contractName: "Stellar Asset Contract",
    translate: (event: RawEvent) => {
      // Decode topics[1] = from address
      const from = decodeAddress(event.topics[1]);
      
      // Decode topics[2] = to address
      const to = decodeAddress(event.topics[2]);
      
      // Decode data = amount
      const amount = decodeAmount(event.data);
      
      return {
        eventType: "Transfer",
        description: `${from.short} transferred ${amount.formatted} to ${to.short}`
      };
    }
  };
}
```

#### XDR Decoder (`decode.ts`)
Low-level utilities for decoding XDR binary data:
- `decodeAddress()` — Converts hex to Stellar public key (G...)
- `decodeAmount()` — Converts raw stroops to decimal amounts
- `decodeScVal()` — Generic XDR value decoder

**Translation Flow:**
```
Raw Event
    ↓
Registry Lookup
    ↓
Blueprint Match?
    ├─ Yes → decode.ts → Human Text
    └─ No → Mark as "Cryptic"
```

---

### 4. WebSocket Server

**Location:** `server.ts`

The WebSocket server runs alongside the Next.js app, providing real-time event streaming to connected clients.

**Architecture:**
```typescript
// Custom Next.js server with WebSocket support
const httpServer = createServer((req, res) => {
  handle(req, res); // Next.js request handler
});

const wss = new WebSocketServer({ 
  server: httpServer, 
  path: "/ws/events" 
});

// Broadcast to all connected clients
function broadcast(event: TranslatedEvent) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  });
}
```

**Message Format:**
```json
{
  "raw": { /* RawEvent */ },
  "description": "GABC...1234 transferred 100.00 USDC to GXYZ...5678",
  "status": "translated",
  "blueprintName": "Stellar Asset Contract",
  "eventType": "Transfer"
}
```

**Connection Details:**
- **Protocol:** WebSocket (ws://)
- **Port:** 3000 (same as Next.js)
- **Path:** `/ws/events`
- **Message Format:** JSON
- **Broadcast Rate:** Every time a new event is translated (~5s interval)

---

### 5. Frontend Dashboard

**Location:** `app/dashboard/`, `components/dashboard/`, `lib/hooks/`

The frontend is a Next.js 14 application using the App Router, providing a clean, interactive dashboard for viewing translated events.

**Key Components:**

#### Event Feed Table (`EventFeedTable.tsx`)
The main table displaying translated events with:
- Real-time updates via WebSocket
- Search and filtering
- Pagination
- Status badges (Translated / Cryptic)
- "View Raw" button to see original XDR

**Columns:**
- Event Type (Transfer, Mint, Swap, etc.)
- Description (Human-readable text)
- Contract Name (Which blueprint translated it)
- Timestamp
- Status (Translated / Cryptic)
- Actions (View Raw Data)

#### Search Bar (`SearchBar.tsx`)
Filters events by:
- Contract ID
- Event type
- Description text
- Status (translated vs cryptic)
- Time range

#### Stats Bar (`StatsBar.tsx`)
Displays real-time statistics:
- Total events indexed
- Successfully translated
- Cryptic events (need blueprints)
- Live event rate

#### Live Feed Hook (`useLiveFeed.ts`)
React hook managing WebSocket connection:
```typescript
const { isLive, isPaused, toggleLive, togglePause } = useLiveFeed((event) => {
  // Add new event to table
  setEvents([event, ...events]);
});
```

**Features:**
- Auto-reconnect on disconnect
- Pause/Resume live feed
- Event buffering when paused
- Highlight new events with animation

---

## Data Flow

Here's how a single event flows through the entire system:

### Step-by-Step Flow

```
1. Smart Contract Execution
   ↓
   Contract emits event with topics + data (XDR binary)
   
2. Event Available on Stellar Network
   ↓
   RPC endpoint getEvents() returns raw event
   
3. Event Indexer Polls RPC
   ↓
   fetchEventsWithRetry() fetches events
   ↓
   Handle HTTP 429 with exponential backoff if needed
   ↓
   Update cursor to latest ledger
   
4. Translation Engine Processes Event
   ↓
   registry.translateEvent(rawEvent)
   ↓
   Lookup contract ID in blueprint map
   ↓
   Blueprint.translate() decodes XDR
   ↓
   Returns TranslatedEvent with human text
   
5. WebSocket Server Broadcasts
   ↓
   broadcast(translatedEvent) sends JSON to all clients
   
6. Frontend Receives Event
   ↓
   useLiveFeed hook receives WebSocket message
   ↓
   Parse JSON to TranslatedEvent
   ↓
   Update React state with new event
   ↓
   EventFeedTable re-renders with new row
   ↓
   Highlight animation plays for 600ms
```

### Example Event Journey

**Start: Token Transfer on Stellar**
```typescript
// User executes: Transfer 100 USDC from Alice to Bob
contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
```

**Step 1: RPC Returns Raw Event**
```json
{
  "contractId": "CDLZFC...CYSC",
  "topics": [
    "0x0000000f", // Event name: "transfer"
    "0x00000000...alice", // From: Alice's address
    "0x00000000...bob"    // To: Bob's address
  ],
  "data": "0x0000000005f5e100" // Amount: 100000000 (100 USDC)
}
```

**Step 2: Translation Engine Decodes**
```typescript
// SAC Transfer Blueprint
const from = decodeAddress(topics[1]); // "GABC...1234"
const to = decodeAddress(topics[2]);   // "GXYZ...5678"
const amount = decodeAmount(data);     // "100.00 USDC"
```

**Step 3: Translated Event Created**
```json
{
  "description": "GABC...1234 transferred 100.00 USDC to GXYZ...5678",
  "status": "translated",
  "blueprintName": "Stellar Asset Contract",
  "eventType": "Transfer"
}
```

**Step 4: Frontend Displays**
```
┌─────────────┬──────────────────────────────────────────────┬───────────────┐
│ Event Type  │ Description                                  │ Status        │
├─────────────┼──────────────────────────────────────────────┼───────────────┤
│ Transfer    │ GABC...1234 transferred 100.00 USDC to      │ ✅ Translated │
│             │ GXYZ...5678                                  │               │
└─────────────┴──────────────────────────────────────────────┴───────────────┘
```

---

## Key Technologies

### Backend
- **stellar-sdk** — Official Stellar SDK for JavaScript/TypeScript
  - `SorobanRpc.Server` — RPC client for fetching events
  - XDR decoding utilities
- **ws** — WebSocket library for real-time broadcasting
- **next** — Custom Next.js server with HTTP + WebSocket
- **TypeScript** — Type-safe implementation

### Frontend
- **Next.js 14** — React framework with App Router
- **React 18** — UI library with Server Components
- **Tailwind CSS** — Utility-first styling
- **shadcn/ui** — Accessible component library
- **WebSocket API** — Native browser WebSocket client

### Testing
- **Vitest** — Unit testing framework
- **@testing-library/react** — Component testing

---

## Development Guide

### Running Locally

1. **Clone the repository**
   ```bash
   git clone https://github.com/coderolisa/Open-Audit.git
   cd Open-Audit
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```

4. **Start the development server** (with WebSocket)
   ```bash
   npm run dev:ws
   ```

5. **Open the dashboard**
   ```
   http://localhost:3000/dashboard
   ```

### Project Structure

```
open-audit/
├── app/
│   ├── dashboard/              # Dashboard page
│   │   └── page.tsx
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Landing page
│
├── components/
│   ├── dashboard/              # Dashboard components
│   │   ├── EventFeedTable.tsx  # Main event table
│   │   ├── SearchBar.tsx       # Search & filters
│   │   ├── StatsBar.tsx        # Statistics display
│   │   └── RawDataDialog.tsx   # Raw XDR viewer
│   ├── theme/                  # Theme components
│   └── ui/                     # shadcn/ui primitives
│
├── lib/
│   ├── stellar/                # Stellar integration
│   │   ├── client.ts           # RPC client
│   │   ├── indexer.ts          # Event indexer
│   │   └── __tests__/          # Indexer tests
│   ├── translator/             # Translation engine
│   │   ├── registry.ts         # Central registry
│   │   ├── types.ts            # Type definitions
│   │   ├── decode.ts           # XDR decoder
│   │   └── blueprints/         # Contract blueprints
│   ├── hooks/                  # React hooks
│   │   └── useLiveFeed.ts      # WebSocket hook
│   └── utils.ts                # Shared utilities
│
├── server.ts                   # Custom Next.js + WebSocket server
└── docs/
    └── good-first-issues.json  # Contribution opportunities
```

### Adding a New Contract Blueprint

Want to add support for a new contract? Follow these steps:

1. **Create a new blueprint file**
   ```typescript
   // lib/translator/blueprints/my-contract.ts
   import type { RawEvent, TranslationBlueprint } from "../types";
   import { decodeAddress, decodeAmount } from "../decode";

   export function createMyContractBlueprint(
     contractId: string
   ): TranslationBlueprint {
     return {
       contractId,
       contractName: "My Contract",
       translate: (event: RawEvent) => {
         // Decode event data
         const user = decodeAddress(event.topics[1]);
         const amount = decodeAmount(event.data);

         return {
           eventType: "MyEvent",
           description: `${user.short} performed action with ${amount.formatted}`,
         };
       },
     };
   }
   ```

2. **Register the blueprint**
   ```typescript
   // lib/translator/registry.ts
   import { createMyContractBlueprint } from "./blueprints/my-contract";

   function buildRegistry() {
     const registry = new Map();
     
     // Add your blueprint
     registry.set(
       "YOUR_CONTRACT_ID",
       createMyContractBlueprint("YOUR_CONTRACT_ID")
     );
     
     return registry;
   }
   ```

3. **Test your blueprint**
   ```typescript
   // lib/translator/__tests__/my-contract.test.ts
   import { translateEvent } from "../registry";

   it("translates my contract events", () => {
     const rawEvent = {
       contractId: "YOUR_CONTRACT_ID",
       topics: ["0x...", "0x..."],
       data: "0x...",
       // ...
     };

     const translated = translateEvent(rawEvent);
     expect(translated.status).toBe("translated");
     expect(translated.description).toContain("performed action");
   });
   ```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test lib/stellar/__tests__/indexer.test.ts

# Run with coverage
npm test -- --coverage
```

### Debugging

**Enable verbose logging:**
```typescript
// In indexer.ts or registry.ts
console.log("[debug] Current cursor:", cursor);
console.log("[debug] Translated event:", translatedEvent);
```

**Check WebSocket connection:**
```javascript
// In browser console
const ws = new WebSocket("ws://localhost:3000/ws/events");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

---

## Performance Considerations

### Rate Limiting
- **Problem:** Stellar RPC has rate limits (HTTP 429)
- **Solution:** Exponential backoff retry with cursor preservation
- **Impact:** Zero event loss during rate limiting

### WebSocket Scaling
- **Current:** Single server broadcasts to all clients
- **Future:** Consider Redis pub/sub for multi-server deployments

### Translation Performance
- **Optimization:** Blueprint lookup is O(1) via Map
- **Caching:** Consider caching decoded addresses for repeat events

### Frontend Performance
- **Virtualization:** For large event lists, use react-window
- **Debouncing:** Search input debounced to avoid excessive re-renders

---

## Future Enhancements

1. **Database Persistence**
   - Store events in PostgreSQL/MongoDB
   - Enable historical queries
   - Persist cursor for crash recovery

2. **Multi-Contract Batching**
   - Fetch events for multiple contracts in one RPC call
   - Reduce network overhead

3. **Custom ABI Upload**
   - Let users upload Soroban ABIs for their own contracts
   - Generate blueprints automatically from ABI JSON

4. **Real-Time Notifications**
   - Alert users when specific events occur (e.g., large transfers)
   - Email/Telegram integration

5. **Analytics Dashboard**
   - Event volume charts
   - Top contracts by activity
   - Translation success rate

---

## Contributing

We welcome contributions! Here's how the architecture helps contributors:

### For Backend Developers
- **Start here:** `lib/stellar/indexer.ts` — Add features like multi-contract support
- **Rate limit optimization:** Improve retry logic or add circuit breakers
- **Database integration:** Add persistence layer for events

### For Translation Developers
- **Start here:** `lib/translator/blueprints/` — Add new contract support
- **See:** `docs/good-first-issues.json` for blueprint requests
- **Example:** Add Soroswap Router, Blend Protocol, Phoenix DEX

### For Frontend Developers
- **Start here:** `components/dashboard/` — Improve UI/UX
- **Add features:** Advanced filters, charts, export functionality
- **Optimize:** Virtual scrolling, better search performance

---

## Questions?

- **Issues:** https://github.com/coderolisa/Open-Audit/issues
- **Discussions:** https://github.com/coderolisa/Open-Audit/discussions
- **Contributing Guide:** [CONTRIBUTING.md](CONTRIBUTING.md)

---

**Built with ❤️ for the Stellar community**
