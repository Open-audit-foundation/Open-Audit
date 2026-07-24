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

- **Framework:** Next.js 14 (App Router) + TypeScript
- **Design System:** Tailwind CSS + shadcn/ui
- **Stellar Integration:** `stellar-sdk`
- **State Management:** React Context + Server Components

---

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9

### Installation

```bash
git clone https://github.com/your-org/open-audit.git
cd open-audit
npm install
npm run dev
```

If you want a local API/server workflow for testing the app, run:

```bash
npm run dev:ws
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

For the custom server with WebSocket support and `/metrics`, run:

```bash
npm run dev:ws
```

### Optional: Native XDR Decoder (Performance Boost)

Open-Audit uses a native Rust XDR decoder for better performance. To compile it (requires Rust):

```bash
# Install Rust first if needed: https://rustup.rs
npm run build:native
```

Without this step, the app will automatically fall back to a pure TypeScript decoder (no errors, just slightly slower performance).

### Environment Variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

If you are working with the Redis-backed services flow, create a local environment file from the available sample config in the repository and adjust the values for your setup.

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_HORIZON_URL` | Stellar Horizon endpoint | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Network passphrase | Testnet passphrase |
| `REDIS_URL` | Redis connection URL (microservices) | `redis://localhost:6379` |
| `REDIS_CHANNEL` | Redis Pub/Sub channel (microservices) | `stellar:events` |
| `PORT` | HTTP server port | `3000` |

### Available Scripts

**Development:**
```bash
npm run dev              # Standard Next.js dev server
npm run dev:ws           # Legacy monolithic server with WebSocket support
npm run test             # Run the repository test suite
npm run build:cli        # Build the standalone CLI
npm run cli:example      # Exercise the CLI against the sample blueprint
```

**Production (Microservices):**
```bash
npm run docker:build     # Build Docker images
npm run docker:up        # Start all services with Docker Compose
npm run docker:down      # Stop all Docker services
npm run docker:logs      # View Docker logs

npm run start:pm2        # Start services with PM2
npm run stop:pm2         # Stop PM2 services
npm run monit:pm2        # Monitor PM2 processes
npm run logs:pm2         # View PM2 logs
```

**Testing & Quality:**
```bash
npm run test             # Run all tests
npm run lint             # Run ESLint
npm run lint:registry    # Validate translation registry
npm run format           # Format code with Prettier
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

Open-Audit supports two deployment architectures:

### 🆕 Microservices Architecture (Recommended for Production)

**Decoupled, scalable, fault-isolated system using Redis Pub/Sub:**

```
Stellar Network → Indexer Worker → Redis Pub/Sub → Web Server → WebSocket Clients
```

**Benefits:**
- ✅ Zero CPU starvation (indexer runs in separate process)
- ✅ Independent horizontal scaling
- ✅ Fault isolation (crashes don't affect other services)
- ✅ Auto-reconnect and message queuing
- ✅ Zero-downtime deployments

**Quick Start:**
```bash
# Option 1: Docker Compose (Easiest)
npm run docker:up

# Option 2: PM2 Process Manager
npm run start:pm2

# Option 3: Manual
Terminal 1: redis-server
Terminal 2: npm run dev:decoupled
Terminal 3: npm run worker:indexer
```

📚 **Documentation:**
- **[Architecture Guide](ARCHITECTURE.md)** - Repository and service architecture overview
- **[Security Hardening Guide](SECURITY_HARDENING_GUIDE.md)** - Production hardening notes

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
- **[Status Summary](TASK_7_STATUS_MONITORING_SUMMARY.md)** - Implementation overview

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

**Monitoring:**
```bash
GET /api/security/metrics  # Security metrics API
```

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
3. **Redis Pub/Sub** (microservices only) — Message broker for event distribution
4. **WebSocket Server** (`server-decoupled.ts` or `server.ts`) — Broadcasts events in real-time
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
│   └── worker/             # 🆕 Microservices architecture
│       └── indexer.ts      # Standalone indexer worker
├── scripts/
│   ├── lint-registry.ts    # Translation registry validation
│   └── test-websocket-client.js # WebSocket testing tool
├── docs/
│   └── good-first-issues.json
├── server.ts               # Legacy monolithic server (deprecated)
├── server-decoupled.ts     # 🆕 Microservices web server
├── ecosystem.config.js     # 🆕 PM2 configuration
├── docker-compose.microservices.yml # 🆕 Docker Compose config
├── Dockerfile.worker       # 🆕 Indexer worker Docker image
├── Dockerfile.web          # 🆕 Web server Docker image
├── ARCHITECTURE.md         # 📖 Detailed architecture guide
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

## 🔒 WASM Sandbox for Community Parsers (NEW)

**Secure execution environment for third-party contract parsers:**

```
Untrusted WASM → Sandbox → Zero Host Access → Strict Limits → Safe Execution
```

**Security Features:**
- ✅ Zero host capabilities (no filesystem, network, or env access)
- ✅ Memory limits (16MB maximum per execution)
- ✅ Execution timeouts (5 seconds maximum)
- ✅ Worker thread isolation (crashes don't affect main process)
- ✅ Input/output validation (size and schema checks)

**Why WASM?**
- Community developers can write custom parsers for idiosyncratic contracts
- **Zero RCE risk** - parsers run in complete isolation
- Near-native performance with minimal overhead (~60-120ms)
- Industry-standard sandboxing technology

📚 **Documentation:**
- **[WASM Sandbox Architecture](lib/wasm-sandbox/WASM_SANDBOX_ARCHITECTURE.md)** - Complete technical documentation
- **[Community Parser Guide](lib/wasm-sandbox/COMMUNITY_PARSER_GUIDE.md)** - Write your own parser
- **[WASM Sandbox README](lib/wasm-sandbox/README.md)** - Local usage and test commands

**Quick Start (Parser Development):**
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Build example parsers
cd lib/wasm-sandbox/examples/rust
./build-all.sh  # or build-all.bat on Windows

# Test your parser
npm run test:wasm:manual custom ./my-parser.wasm

# Run test suite
npm run test:wasm
```

**Example Usage:**
```typescript
import { WasmSandboxRunner } from '@/lib/wasm-sandbox';

const runner = new WasmSandboxRunner();

const result = await runner.execute('./parser.wasm', {
  data: JSON.stringify({ from: 'G...', to: 'G...', amount: '1000000' }),
  contractId: 'CDLZ...YSC',
  eventType: 'transfer'
});

if (result.success) {
  console.log(result.output.description);  // "Transferred 1000000..."
}
```

---

## Contributing

We welcome contributions of all sizes! See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

Good first issues are listed in [`/docs/good-first-issues.json`](docs/good-first-issues.json).

---

## License

MIT © Open-Audit Contributors
