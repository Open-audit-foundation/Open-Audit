# soroban-xdr-decode

Native Node.js N-API addon (Rust) for zero-copy Stellar Soroban XDR decoding.

Closes #[insert issue number]

## Why native?

Soroban event streams contain deeply nested XDR-encoded `ScVal` payloads.
Decoding them in TypeScript via `stellar-sdk` works but pins the Node.js main
thread during CPU-bound parsing. This addon offloads the hot path to Rust,
achieving roughly **10–50× throughput** for bulk event ingestion while keeping
the event loop free.

## Architecture

```
Node.js (V8)
  │
  │  string (hex / base64)          structured JS object
  │ ────────────────────────►  ◄────────────────────────
  │
  └─► lib/native/xdr-binding.ts   ← TypeScript wrapper + fallback
            │
            │  require('index.node')
            ▼
  native/soroban-xdr-decode/      ← Rust crate (napi-rs)
    src/lib.rs
      ├─ decode_inner()            raw bytes → ScVal (stellar-xdr)
      ├─ sc_val_to_json()          ScVal → serde_json::Value
      └─ sc_address_to_string()    ScAddress → G.../C... StrKey
```

## Prerequisites

| Tool       | Version     | Install                                  |
|------------|-------------|------------------------------------------|
| Rust       | stable      | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js    | ≥ 18        | https://nodejs.org                       |
| @napi-rs/cli | ≥ 2.18  | `npm install -g @napi-rs/cli`            |

## Build

```bash
# From the repo root — builds for the host platform:
npm run build:native

# Debug build (no LTO, with symbols):
npm run build:native:debug

# Inside a Docker container (linux/amd64):
npm run build:native:docker
```

Or directly from the addon directory:

```bash
cd native/soroban-xdr-decode
npm install          # installs @napi-rs/cli
npm run build        # release binary → index.node
```

## Usage

The recommended entrypoint is the TypeScript binding, which automatically
falls back to `stellar-sdk` XDR parsing when the native binary is absent:

```ts
import {
  decodeScVal,
  decodeTopics,
  batchDecode,
  isNativeAddonLoaded,
  xdrSchemaVersion,
} from '@/lib/native/xdr-binding';

// Single ScVal (hex or base64)
const decoded = decodeScVal('AAAAAA==');
// → { type: 'Void', value: null }

// Event topic vector
const topics = decodeTopics(['AAAADgAAAAh0cmFuc2Zlcg==', 'AAAAAA==']);
// → [{ type: 'Symbol', value: 'transfer' }, { type: 'Void', value: null }]

// Bulk decode — tolerates per-entry failures
const results = batchDecode(many_hex_strings);

// Runtime diagnostics
console.log(isNativeAddonLoaded()); // true when .node binary is present
console.log(xdrSchemaVersion());    // 'curr' | 'fallback'
```

## Decoded value shape

Every decoded `ScVal` is a discriminated union on the `type` field:

| `type`                      | Extra fields                                      |
|-----------------------------|---------------------------------------------------|
| `Bool`                      | `value: boolean`                                  |
| `Void`                      | `value: null`                                     |
| `Error`                     | `value: string`                                   |
| `U32` / `I32`               | `value: number`                                   |
| `U64` / `I64` / `U128` / `I128` / `Timepoint` / `Duration` | `value: string` (decimal) |
| `U256` / `I256`             | `hi_hi, hi_lo, lo_hi, lo_lo: string`              |
| `Bytes`                     | `value: string` (hex), `len: number`              |
| `String` / `Symbol`         | `value: string`                                   |
| `Address`                   | `value: string` (G… or C… StrKey)                 |
| `Vec`                       | `value: DecodedScVal[]`                           |
| `Map`                       | `value: Array<{ key: DecodedScVal, value: DecodedScVal }>` |
| `ContractInstance`          | `executable: string`, `storage?: …`              |
| `LedgerKeyContractInstance` | *(no extra fields)*                               |
| `LedgerKeyNonce`            | `nonce: string`                                   |

## Docker

The `Dockerfile` at the repo root builds the addon in a dedicated
`rust-builder` stage and copies only the resulting `index.node` binary into
the final image — the full Rust toolchain (~900 MB) is discarded:

```
rust-builder  →  *.node
                     ↓
deps   →  node_modules
                     ↓
builder  →  .next  +  *.node
                     ↓
runner   (production, ≈ 200 MB)
```

## Testing

```bash
# From repo root:
npm test -- lib/native
```

Tests run in "fallback" mode when no `.node` binary is present, and switch
to native assertion mode automatically when the binary exists.

## Error handling

- `decodeScVal` / `decodeTopics`: throw a JavaScript `Error` with a
  descriptive message on malformed input.  The Node.js event loop is never
  crashed — napi-rs converts Rust `Err` values to JS exceptions safely.
- `batchDecode`: captures per-entry errors as `{ type: "Error", value: "…" }`
  so a single bad payload never aborts bulk ingestion.
