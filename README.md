# Open-Audit

> **The Google Translate for Soroban** — an open-source transparency tool for the Stellar/Soroban ecosystem.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Built on Stellar](https://img.shields.io/badge/Built%20on-Stellar-7B2FBE)](https://stellar.org)

---

## What is Open-Audit?

Smart contracts on Stellar/Soroban emit events as cryptic, hex-encoded binary data. To the average user — or even most developers — these events are completely unreadable. Open-Audit solves this by:

1. **Fetching** raw contract events from the Stellar network via Horizon/RPC.
2. **Translating** them into plain English sentences using a community-maintained **Translation Registry**.
3. **Displaying** the results in a clean, searchable dashboard anyone can use.

**Example:**

| Before (Raw) | After (Translated) |
|---|---|
| `0x000000000000000000000000...` | `Public Key [GABC...1234] transferred 100 USDC to [GXYZ...5678]` |

---

## Tech Stack

- **Framework:** Next.js 16.2.10 (App Router) + TypeScript
- **Design System:** Tailwind CSS + shadcn/ui
- **Stellar Integration:** `stellar-sdk`
- **State Management:** React Context + Server Components

---

## Getting Started

### Prerequisites

- Node.js >= 20.9
- npm >= 9

### Installation

```bash
git clone https://github.com/your-org/open-audit.git
cd open-audit
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

If you want the custom server with WebSocket support and `/metrics`, run:

```bash
npm run dev:ws
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

See [`.env.example`](.env.example) for the full, commented list of
required and optional variables — it's organized into `[REQUIRED]`
and `[OPTIONAL]` sections with defaults and explanations for each.

### Available Scripts

**Development:**
```bash
npm run dev              # Standard Next.js dev server
npm run dev:ws           # Legacy monolithic server with WebSocket support
npm run test             # Run the repository test suite
npm run build:cli        # Build the standalone CLI
npm run cli:example      # Exercise the CLI against the sample blueprint
```

**Testing & Quality:**
```bash
npm run test             # Run all tests
npm run test:parity      # Native/TS XDR decoder parity + fallback tests
npm run lint             # Run ESLint
npm run lint:registry    # Validate translation registry
npm run format           # Format code with Prettier
```

**Native XDR decoder (optional):**
```bash
npm run build:native         # Build the Rust N-API decoder (release)
npm run build:native:debug   # Debug build
npm run build:native:docker  # Build in a clean container
npm run bench:xdr            # TS vs native throughput comparison
```

---

## Telemetry

The custom server exposes Prometheus metrics on `http://localhost:3000/metrics` when running `npm run dev:ws`.

You can configure OpenTelemetry to export spans to Jaeger by setting:

```bash
export JAEGER_ENDPOINT="http://localhost:14268/api/traces"
export OTEL_SERVICE_NAME="open-audit"
```

The default Jaeger endpoint is `http://localhost:14268/api/traces`.

---

## Architecture

Open-Audit currently runs as a single-process monolithic architecture:

📚 **Documentation:**
- **[Architecture Guide](ARCHITECTURE.md)** - Repository and service architecture overview

### 📊 Status Monitoring System (Production-Ready)

**Real-time health monitoring for all system components with sub-500ms response:**

```
Worker Heartbeat → Redis → Health API → Status Dashboard
```

**Features:**
- ✅ Real-time component health checks (Stellar RPC, Database, Redis, Worker)
- ✅ Circuit breaker state monitoring
- ✅ System metrics (events, translations, connections)
- ✅ Beautiful auto-refreshing dashboard
- ✅ Sub-500ms API response time
- ✅ Graceful degradation

**Components Monitored:**
- Stellar RPC (with circuit breaker state)
- Database (Prisma connection)
- Redis cache
- Indexer worker (heartbeat-based)

📚 **Documentation:**
- **[Status Monitoring Guide](STATUS_MONITORING_GUIDE.md)** - Complete monitoring documentation

**Quick Start:**
```bash
# Access status dashboard
open http://localhost:3000/status

# Check health via API
curl http://localhost:3000/api/status | jq
```

**Worker Heartbeat:**
- Writes to Redis every 30 seconds
- Validates worker is alive (< 90s threshold)
- Includes metrics: processed count, error count, uptime

### 🔒 Security Hardening (Production-Ready)

**Bulletproof XDR parser protection against malicious contract payloads:**

```
Untrusted XDR → Security Guards → Safe Parsing → Graceful Error Handling
```

**Protection Against:**
- ✅ Stack overflow (deeply nested structures)
- ✅ Out-of-memory attacks (large payloads)
- ✅ Denial of service (infinite loops)
- ✅ Malformed XDR exploitation

**Security Mechanisms:**
- Recursion depth limits (MAX=100 levels)
- Memory allocation guards (MAX=10 MB)
- Parsing timeout protection (MAX=5 seconds)
- Collection size limits (MAX=10,000 elements)
- Real-time attack detection

📚 **Documentation:**
- **[Security Hardening Guide](SECURITY_HARDENING_GUIDE.md)** - Complete security documentation

**Quick Start:**
```typescript
import { secureParseScVal } from '@/lib/translator/secure-xdr-parser';

const result = secureParseScVal(hex);
if (result.success) {
  // Use result.value safely
}
```

### ⚡ Native XDR Decoder (Optional, Rust)

A native N-API module (`native/soroban-xdr-decode`) accelerates `secureParseScVal`
for high-throughput scenarios. It is a **drop-in performance path, not a second
parser contract**: it enforces the exact same security guards as the TypeScript
implementation (recursion depth, allocation, timeout, collection size — same
limits, same error classes, same messages) and the TypeScript parser remains
the automatic fallback.

**Zero configuration:** if the addon has been built for the current platform it
is used automatically (for payloads large enough to benefit); if it is missing,
fails to load, or misbehaves at runtime, `secureParseScVal` transparently uses
the pure-TypeScript implementation. Set `OPEN_AUDIT_DISABLE_NATIVE_XDR=1` to
force the TypeScript path (debugging/benchmarking only).

**Building** (requires a [Rust toolchain](https://rustup.rs), or Docker):
```bash
npm run build:native          # release build for the current platform
npm run build:native:debug    # debug build
npm run build:native:docker   # build inside a clean container (no local Rust needed)
```

**Supported platforms:** Linux x64/arm64 (glibc & musl), macOS x64/arm64,
Windows x64. On anything else the build script exits with a message and the
TypeScript parser is used — that is a fully supported configuration, not an
error.

**Verification:** `npm run test:parity` runs every fuzz/security corpus input
(including all payloads from `fuzz-xdr-parser.test.ts` and
`secure-xdr-parser.test.ts`, deterministic mutation/random sweeps, UTF-8 edge
cases and guard-boundary payloads) against both implementations and asserts
identical results, and covers the automatic fallback with simulated
missing/crashing/lying addons.

**Measured throughput** (`npm run bench:xdr`, Node v20.20.2, linux-x64,
release build, interleaved best-of-3 rounds):

| workload                                  | TS ops/s | native ops/s | speedup |
| ----------------------------------------- | -------- | ------------ | ------- |
| typical transfer event (4 payloads)       | 104,654  | 104,173      | 1.00x   |
| medium nested struct (depth 5, 50 fields) | 8,204    | 19,634       | 2.39x   |
| large vec (1,000 u32)                     | 1,081    | 3,568        | 3.30x   |
| large map (5,000 entries)                 | 104      | 324          | 3.12x   |
| attack: nested vec depth 150              | 1,928    | 24,781       | 12.86x  |
| attack: vec with 20,000 elements          | 292      | 1,401        | 4.80x   |
| malformed: tiny truncated garbage         | 10,877   | 11,128       | 1.02x   |
| malformed: 4KB of garbage                 | 23,406   | 29,623       | 1.27x   |

Small payloads (< ~50 bytes) intentionally stay on the TypeScript path — the
N-API call overhead exceeds the work saved there, so the hybrid is never
slower than pure TS. The largest wins are on hostile payloads, where rejection
happens in Rust before the JavaScript XDR parser ever runs.

### Legacy Monolithic Architecture

**Single-process system (for simple deployments):**

```
Stellar Network → Event Indexer → Translation Engine → WebSocket Server → Frontend Dashboard
```

⚠️ **Known limitations:** Under heavy load, indexing can starve the HTTP/WebSocket server of CPU cycles. See deprecation notice in `server.ts`.

```bash
npm run dev:ws
```

---

For new contributors wanting to understand the system's data flow and internal architecture, see the comprehensive [**ARCHITECTURE.md**](ARCHITECTURE.md) guide which includes:

- 📊 **Interactive Mermaid diagrams** showing data flow
- 🔍 **Component deep dives** for each service
- 📝 **Step-by-step event journey** from blockchain to UI
- 🛠️ **Development guides** for adding new features

**Quick Overview:**

1. **Event Indexer** (`lib/stellar/`, `src/worker/`) — Polls Stellar RPC with resilient rate limiting
2. **Translation Engine** (`lib/translator/`) — Converts XDR to human-readable text with security hardening
3. **Redis Pub/Sub** — Message broker for event distribution
4. **WebSocket Server** (`server.ts`) — Broadcasts events in real-time
5. **Frontend Dashboard** (`app/dashboard/`, `components/`) — Interactive UI

---

## Project Structure

```
open-audit/
├── app/                    # Next.js App Router pages
│   ├── dashboard/          # Main dashboard page
│   ├── api/                # API routes (health checks, etc.)
│   ├── layout.tsx          # Root layout with theme provider
│   └── page.tsx            # Landing / redirect
├── components/             # Reusable UI components
│   ├── ui/                 # shadcn/ui primitives
│   ├── dashboard/          # Dashboard-specific components
│   └── theme/              # Dark mode toggle
├── lib/
│   ├── translator/         # 🔑 The Translation Registry core logic
│   │   ├── types.ts        # RawEvent / TranslatedEvent interfaces
│   │   ├── registry.ts     # Registry lookup function
│   │   └── blueprints/     # Per-contract translation blueprints
│   ├── stellar/            # Stellar SDK helpers
│   │   ├── indexer.ts      # Event polling with rate limit handling
│   │   └── client.ts       # RPC client configuration
│   ├── resilience/         # ⚡ Rate limiting & circuit breaker
│   │   ├── token-bucket.ts # Token bucket rate limiter
│   │   ├── circuit-breaker.ts # Circuit breaker pattern
│   │   └── resilient-client.ts # Resilient RPC client wrapper
│   ├── hooks/              # React hooks for live data
│   └── utils.ts            # Shared utilities
├── src/
│   └── worker/             # Standalone indexer worker
│       └── indexer.ts
├── scripts/
│   ├── lint-registry.ts    # Translation registry validation
│   └── test-websocket-client.js # WebSocket testing tool
├── docs/
│   └── good-first-issues.json
├── server.ts               # Legacy monolithic server (deprecated)
├── ARCHITECTURE.md         # 📖 Detailed architecture guide
├── SECURITY_HARDENING_GUIDE.md # 🔒 Security documentation
└── public/
```

---

## The Translation Registry

The heart of Open-Audit is the **Translation Registry** in `/lib/translator/`. Each contract gets a **blueprint** — a mapping from raw event topics/data to a human-readable template.

To add support for a new contract, create a file in `/lib/translator/blueprints/` and register it in `registry.ts`. See [CONTRIBUTING.md](CONTRIBUTING.md) for a step-by-step guide.

---

## 🛠️ Developer Tools

### open-audit-cli - Standalone Blueprint Testing

**Instant offline testing for translation blueprints** — no database, no network, no services required.

```bash
# Install and build
npm install
npm run build:cli

# Test a specification
node dist/cli/open-audit-cli.js test \
  --hex 0x74726e7312345678 \
  --spec ./blueprints/my-contract.json \
  --verbose
```

**Benefits:**
- ✅ **17x faster** iteration cycle vs. full system
- ✅ Zero setup - Node.js only
- ✅ Works offline
- ✅ JSON & YAML support
- ✅ CI/CD integration ready

📚 **Documentation:**
- **[CLI README](cli/README.md)** - Complete command reference and examples
- **[CLI Quick Start](cli/QUICK_START.md)** - Get started in 30 seconds

**Quick Example:**
```bash
npm run cli:example
```

**Output:**
```
✅ Translation Successful
Description: GABC...1234 transferred 100.00 USDC to GXYZ...5678
```

---

## Contributing

We welcome contributions of all sizes! See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

Good first issues are listed in [`/docs/good-first-issues.json`](docs/good-first-issues.json).

---

## License

MIT © Open-Audit Contributors
