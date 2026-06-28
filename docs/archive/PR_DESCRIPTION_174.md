# PR: IPFS Offloading for Bloated Event Metadata

## Overview

Complex Soroban contracts often emit massive text payloads in their events — uploading IPFS hashes, JSON blobs, DAO proposal text, etc. Storing these bloated strings directly in PostgreSQL inflates indexes and degrades query performance. This PR introduces an extraction layer that transparently offloads bloated metadata (>2KB) to a local IPFS node during ingestion, replacing it with a lightweight CID pointer.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Ingestion Pipeline                          │
│                                                                   │
│  Stellar Network ──▶ RawEvent ──▶ translateEvent() ──▶ persist  │
│                                       │                          │
│                                       ▼                          │
│                              processEventForIpfs()                │
│                              ┌──────────────────────┐            │
│                              │ Check data > 2KB?    │            │
│                              │ Check topics > 2KB?  │            │
│                              │ If yes:              │            │
│                              │   ipfs.add(hex)      │            │
│                              │   ipfs.pin(cid)      │            │
│                              │   Replace with       │            │
│                              │   "ipfs:<cid>"       │            │
│                              └──────────────────────┘            │
│                                       │                          │
│                                       ▼                          │
│                              DB stores "ipfs:<cid>"               │
│                              instead of 4KB+ hex string          │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend Display                              │
│                                                                   │
│  RawDataDialog                                                    │
│  ┌──────────────────────────────────────────────┐                │
│  │  Data (offloaded to IPFS)                     │                │
│  │  ┌──────────────────────────────────────────┐ │                │
│  │  │ ⟳ Resolving IPFS content...              │ │                │
│  │  └──────────────────────────────────────────┘ │                │
│  │  ┌──────────────────────────────────────────┐ │                │
│  │  │ {original hex content loaded from IPFS}  │ │                │
│  │  └──────────────────────────────────────────┘ │                │
│  └──────────────────────────────────────────────┘                │
│                                                                   │
│  Resolution path:                                                 │
│  useIpfsResolver ──▶ POST /api/ipfs/resolve ──▶ ipfs.cat(cid)    │
│                                              └─▶ ipfs gateway    │
└─────────────────────────────────────────────────────────────────┘
```

## Files Changed

### New Files

| File | Description |
|------|-------------|
| `lib/ipfs/client.ts` | Kubo (go-ipfs) RPC API client — `add()`, `cat()`, `pin()`, `isReachable()` with 15s timeout and best-effort semantics |
| `lib/ipfs/offloader.ts` | Bloat detection (`isBloated()` checks decoded byte length > 2048), `processEventForIpfs()` for batch processing events, `isIpfsPointer()` / `extractCid()` helpers |
| `lib/ipfs/index.ts` | Barrel re-export |
| `app/api/ipfs/resolve/route.ts` | `POST /api/ipfs/resolve` — accepts `{ cid }` or `{ pointer }`, returns `{ cid, content }` |
| `lib/hooks/useIpfsResolver.ts` | React hook with automatic CID detection, async resolution via API, client-side in-memory cache, loading/error states, and cleanup on unmount |
| `migrations/0002_add_ipfs_fields.sql` | Adds `ipfsCids` JSONB column with conditional index |

### Modified Files

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Added `ipfsCids Json?` field to Event model |
| `lib/translator/persistence.ts` | Calls `processEventForIpfs()` before upsert; stores modified data/topics + CID list |
| `lib/db/utils.ts` | Same IPFS offloading in `upsertEvent()` and `batchUpsertEvents()` |
| `server.ts` | Calls `processEventForIpfs()` before WebSocket broadcast |
| `components/dashboard/RawDataDialog.tsx` | Detects `ipfs:` prefixed values; renders `ResolvableValue` component with loading spinner, resolved content, or error state |
| `lib/graphql/schema.ts` | Added `ipfsCids` field to GraphQL Event type |
| `.env.example` | Added `IPFS_API_URL` and `IPFS_GATEWAY_URL` |

## How It Works

### 1. Bloat Detection (`lib/ipfs/offloader.ts:38-41`)

A hex string is considered bloated when its decoded byte length exceeds 2048 bytes:

```
hexByteLength("0x<4096+ hex chars>") > BLOAT_THRESHOLD (2048)
```

### 2. Offloading (`lib/ipfs/offloader.ts:43-53`)

When bloated content is detected:
1. The original hex string is added to IPFS via `ipfs.add(hex, pin=true)`
2. The content is pinned to ensure availability
3. The database receives `ipfs:<CID>` instead of the original hex
4. CID(s) are stored in the `ipfsCids` JSON array for metadata

### 3. CID Resolution (`lib/hooks/useIpfsResolver.ts`)

The frontend hook:
1. Detects `ipfs:` prefix in any displayed value
2. Extracts the CID
3. Calls `POST /api/ipfs/resolve` with the CID
4. Returns the resolved content (cached client-side for subsequent requests)
5. Handles loading, error, and success states

### 4. Display (`components/dashboard/RawDataDialog.tsx`)

The RawDataDialog component:
- Shows an `(offloaded to IPFS)` badge next to fields with `ipfs:` pointers
- Renders a loading spinner (`Loader2` with `animate-spin`) while resolving
- Displays an error state with a warning icon if IPFS is unreachable
- Shows the resolved content once available
- Works inline for topics and as a full-width block for data

## Configuration

Requires a running IPFS Kubo daemon. Configure via environment variables:

```env
IPFS_API_URL=http://127.0.0.1:5001   # Kubo RPC API
IPFS_GATEWAY_URL=http://127.0.0.1:8080  # Fallback gateway
```

The offloader is **best-effort** — if the IPFS node is unreachable, events persist with their original inline data (no data loss).

## Edge Cases Handled

- **IPFS node down**: Logs warning, falls through to store data inline
- **Multiple CIDs per event**: Both data and individual topics can be offloaded independently; all CIDs tracked in `ipfsCids`
- **Non-bloated events**: Pass through unchanged (zero overhead)
- **Concurrent offloading**: Per-event processing with `processEventForIpfs()` is self-contained
- **Cache**: Frontend caches resolved CIDs in-memory to avoid redundant API calls
- **Cleanup**: Hook uses cancellation flag to avoid state updates after unmount

---

Closes #174
