# Community Parser Authoring Guide

Build an untrusted contract parser that runs inside the Open-Audit WASM sandbox
(**issue #405**). Parsers are submitted as files in a PR — there is no upload UI
yet.

## Supported languages

Anything that compiles to a **WASM module** with the ABI below and **no imports
other than `env.memory`**.

Recommended:

- **Rust** → `wasm32-unknown-unknown` (see `examples/rust/`)
- AssemblyScript (with a custom `abort` avoided — do not import host abort;
  panic=abort into a trap instead)
- Hand-written WAT for experiments (`fixtures/wat/`)

**Do not** target `wasm32-wasi` / `wasm32-wasi-preview1`. WASI imports are
rejected by the host.

## Guest ABI (required)

```text
(import "env" "memory" (memory 1))   ;; ONLY allowed import

(export "alloc" (func (param i32) (result i32)))
(export "translate" (func (param i32 i32) (result i32)))  ;; in_ptr, in_len -> out_ptr
(export "get_output_len" (func (result i32)))
(export "dealloc" (func (param i32 i32)))                 ;; optional
```

The memory import may declare a different initial size and an optional maximum,
for example `(memory 2 16)`. The host allocates the declared initial size only
when it fits within its configured page limit. Its growth ceiling is the smaller
of the host limit and the guest's declared maximum, when present. A minimum above
the host limit returns `MEMORY_LIMIT_EXCEEDED` before memory allocation.
Only unshared 32-bit memory is supported; shared memory, memory64, and additional
defined memories are rejected.

Defined tables are allowed for indirect calls, but every table must declare an
explicit maximum, for example `(table 1 16 funcref)`. The worker admits at most
32 tables whose **combined maxima** are at most 65,536 reference slots. These are
fixed host ceilings, independent of the linear-memory page budget. Unbounded or
over-budget tables return `MEMORY_LIMIT_EXCEEDED` before instantiation or a start
function can run; checking only a table's initial size is insufficient.

The supported table encoding is the ordinary nullable `funcref` or `externref`
short form with unshared 32-bit limits. Extended reference encodings, GC table
types, custom table initializers, table64 and shared tables are not part of this
ABI and are rejected. Ordinary bounded indirect calls and `table.grow` within
the declared maximum remain supported. A parser compiled with a growable table
without a maximum must be rebuilt with an explicit bound before registration.

### Input JSON (`WasmParserInput`)

```json
{
  "id": "…",
  "contractId": "C…",
  "topics": ["…hex…"],
  "data": "…hex…",
  "ledger": 123456,
  "timestamp": 1710000000,
  "txHash": "…"
}
```

### Output JSON (`WasmParserOutput`)

```json
{
  "description": "Human-readable sentence",
  "eventType": "transfer"
}
```

Both fields are required non-empty strings. Output larger than the host cap
(default 64 KiB) is rejected.

The `translate` result must be an `i32` pointer. The host interprets its bit
pattern as an unsigned wasm32 address and checks the complete output range
against linear memory before reading. A negative JavaScript representation is
never a relative offset from the end of memory. Nonintegral values and values
outside the signed i32 range are rejected before address conversion.

The `get_output_len` result is validated before any integer conversion.
Fractional values and values outside the signed i32 range return
`INVALID_OUTPUT`; they cannot wrap or truncate into a small accepted length.
The existing positive-length, output-size and linear-memory range checks then
apply to the original value.

The output may reuse the input allocation. After `translate` returns, the host
reads `get_output_len` and copies the bounded output into a host-owned string
before calling optional `dealloc(in_ptr, in_len)`. Cleanup is best-effort and may
overwrite the input or grow memory without changing the already-read result.

## Manifest (file-based registration)

```json
{
  "id": "example-sac-transfer",
  "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "contractName": "Example Community SAC Transfer Parser",
  "wasmPath": "./parser.wasm",
  "version": "1.0.0",
  "author": "your-github-handle",
  "description": "Translates SAC transfer events (demo)."
}
```

Register at process startup (server / worker):

```ts
import { registerCommunityParserFromManifest } from "@/lib/wasm-sandbox";

await registerCommunityParserFromManifest(
  "lib/wasm-sandbox/examples/rust/manifest.json"
);
```

Translated events carry `parserProvenance: "community-wasm"`.

## Resource limits (cannot be raised by the guest)

| Limit | Default |
|-------|---------|
| Linear memory | 16 MiB (256 × 64 KiB pages) |
| Defined tables | 32 tables / 65,536 aggregate maximum slots (fixed) |
| Wall time | 1000 ms |
| Input | 256 KiB |
| Output | 64 KiB |

These are per-execution resource-specific limits, not a total process-memory
budget. `peakMemoryBytes` reports linear memory only; table storage and runtime
allocations are not included. See the architecture's residual risks.

## Local verify

```bash
# Compile WAT fixtures (dev)
node lib/wasm-sandbox/fixtures/compile-fixtures.mjs

# Full adversarial + integration suite
npm run test:wasm

# Narrow table-boundary cases, same cases included by the Vitest suite
node --test lib/wasm-sandbox/__tests__/table-limit-cases.cjs
```

## Security checklist before opening a PR

- [ ] Module imports **only** `env.memory`
- [ ] No WASI, no `fs`, no `http`, no JS glue imports
- [ ] Every defined table has a maximum and fits the aggregate table ceilings
- [ ] `npm run test:wasm` passes on your machine
- [ ] Manifest points at the committed `.wasm`
- [ ] You understand descriptions are attacker-chosen text and will be labeled
      community-sourced in the product

See `WASM_SANDBOX_ARCHITECTURE.md` for the full threat model.

## Output-length validation result (2026-10-04)

The worker validates the original `get_output_len` value before size and range
checks. With the preceding worker blob
`c9c300c819d93a62fcc415f077d76418bf51ad46`, a valid 165-byte module returning
the f64 length `4294967335` was accepted as a 39-byte JSON result. The same
real-Worker replay accepts an ordinary i32 length of 39 and, after this repair,
rejects the malformed length as `INVALID_OUTPUT`. Fractional `39.5` and
negative `-4294967257` replay controls are rejected by the same validation.

The maintained adversarial file, including the new committed length fixture,
passed **11/11**, zero failed or skipped, on Node 24.19.0 and retained
Vitest 4.1.10. Command:

```bash
node node_modules/vitest/vitest.mjs run --config vitest.wasm.config.ts \
  lib/wasm-sandbox/__tests__/adversarial.test.ts --maxWorkers=1
```

The local config only relocated the Vite cache into writable temporary storage.
No assertions or timeouts were changed. A preliminary baseline Vitest selection
hit its existing 400 ms worker timeout; the causal before/after result above
comes from the separate real-Worker replay, not that timeout. The declared
Vitest range is `^3.2.7`; locked-dependency, registry, full-application and hosted
CI acceptance were not rerun or claimed. This is validation of malformed output
handling, not a throughput or total-memory-isolation measurement.
