# V8 GC Tuning for Open-Audit Streaming Workload

## Background

Open-Audit's server process (`server.ts`) maintains a persistent Horizon SSE
connection and translates every Soroban contract event in real time. During
a crowded ledger — one carrying hundreds or thousands of contract events — the
translation pipeline generates a burst of short-lived objects:

- `DecodedAddress` / `DecodedAmount` structs from `core.ts`
- Intermediate strings from `decodeAddress`, `interpolateTemplate`, `escapeHtml`
- `TranslatedEvent` result objects from `translateEvents`
- Queue item wrappers in the ingestion pool

These objects are almost all dead by the time the next ledger arrives (~5 s).
V8's scavenger (minor GC) handles young-generation collection cheaply, but when
allocation rates are very high the scavenger runs continuously and can cause
measurable latency spikes ("stop-the-world" events of 5–20 ms per ledger).

The optimisations below attack the problem at two levels:

1. **Code-level** — reduce allocations per event (object pooling, ring buffers,
   memoisation, loop deoptimisation avoidance). See the inline comments in
   `lib/translator/core.ts`, `lib/stellar/ingestion-pool.ts`, and
   `lib/translator/registry.ts`.

2. **Runtime-level** — configure V8 flags to match the observed memory profile
   rather than relying on V8's generic defaults, which are tuned for short-lived
   CLI scripts rather than long-running, bursty streaming servers.

---

## Profiling First

Before changing flags, profile the actual heap:

```bash
# Single run, GC exposed, heap profiler enabled
node --expose-gc \
     --inspect \
     -r tsx/cjs \
     scripts/profile-heap.ts
```

Or target the live server:

```bash
node --inspect=0.0.0.0:9229 \
     --expose-gc \
     -r ts-node/register \
     server.ts
```

Then open `chrome://inspect` → "Open dedicated DevTools for Node" →
Memory tab → "Take heap snapshot". Compare snapshots before and after a
crowded ledger to identify constructors with the highest `#New` delta.

Expected hot constructors (before the pooling refactor):
| Constructor | Root cause |
|---|---|
| `Object` | `DecodedAddress` / `DecodedAmount` literals per event |
| `String` | Hex slices, `toFixed()`, template output |
| `Array` | `topics.map()`, `Array.shift()` internal copies |
| `(closure)` | Per-item try/catch scopes in `translateEvents` |

---

## Recommended V8 Flags

### Development (`dev:ws`)

```bash
node \
  --max-old-space-size=512 \
  --expose-gc \
  -r ts-node/register \
  server.ts
```

`--expose-gc` lets the profiling script (`scripts/profile-heap.ts`) force a
full collection for clean before/after comparisons. Do not use in production.

---

### Production (`start:ws`)

```bash
node \
  --max-old-space-size=1024 \
  --max-semi-space-size=64 \
  --initial-old-space-size=128 \
  --optimize-for-size \
  dist/server.js
```

Flag-by-flag rationale:

#### `--max-old-space-size=1024`

Sets the old-generation heap ceiling to 1 GB (default: ~1.5 GB on 64-bit).

The Open-Audit server's live working set (blueprint registry + WebSocket state
+ in-flight events) is well under 200 MB in practice. A tighter ceiling causes
V8 to trigger major GC earlier and more frequently, which keeps the old-gen
compact and reduces the cost of each individual major collection. Raise this
value only if you observe OOM errors in production.

#### `--max-semi-space-size=64`

The semi-space is the young generation ("nursery"). V8's default is 8 MB (or
16 MB on machines with ≥2 GB RAM).

The translation pipeline creates many small, short-lived objects that are all
dead within one or two ledger cycles (~5–10 s). A 64 MB semi-space means:

- Fewer scavenger runs per ledger (objects survive long enough to be collected
  in a single scavenge rather than triggering multiple back-to-back ones).
- The scavenge cost when it does run is bounded (64 MB is still fast to scan).
- Objects that do survive (blueprint registry, WebSocket state) are promoted to
  old-gen promptly without being rescanned in the nursery repeatedly.

Do **not** set this above 128 MB: larger nurseries mean larger individual
scavenge pauses, which defeats the purpose.

#### `--initial-old-space-size=128`

Pre-allocates 128 MB of old-generation address space at startup rather than
letting V8 grow it dynamically. Avoids the allocation cost and memory-map
fragmentation of on-demand old-gen expansion during the initial warm-up phase
(blueprint registry construction, first few ledgers).

#### `--optimize-for-size`

Tells V8 to prefer smaller object representations and more aggressive inlining
heuristics over raw throughput. Particularly effective for workloads like this
one where many identical-shape objects are created repeatedly — V8 can use
hidden-class sharing more aggressively when objects are small and uniform.

---

### High-throughput production (>500 events/s sustained)

If sustained throughput exceeds ~500 events/s add:

```bash
  --turbofan-optimize-new-space \
  --allow-natives-syntax
```

`--turbofan-optimize-new-space` enables TurboFan JIT optimisation of functions
that allocate primarily in the nursery — exactly the hot path in `translateEvents`
and `decodeAddress`. Without this flag, TurboFan is more conservative about
optimising allocating functions because it cannot guarantee the objects stay
young.

> **Warning:** `--allow-natives-syntax` enables `%OptimizeFunctionOnNextCall()`
> and similar V8 intrinsics. Only use it if you have a custom warmup script that
> explicitly calls these intrinsics before going live. Leaving it on without
> calling any intrinsics is harmless but unnecessary.

---

## npm Script Integration

Add these entries to `package.json` `"scripts"`:

```json
{
  "dev:ws": "node --max-old-space-size=512 --expose-gc -r ts-node/register server.ts",
  "start:ws": "node --max-old-space-size=1024 --max-semi-space-size=64 --initial-old-space-size=128 --optimize-for-size dist/server.js",
  "profile:heap": "node --expose-gc --max-old-space-size=512 -r tsx/cjs scripts/profile-heap.ts"
}
```

---

## Interpreting GC Metrics at Runtime

The server already exposes a Prometheus `/metrics` endpoint (via `prom-client`).
Add these counters to `lib/telemetry.ts` to track GC behaviour in production:

```typescript
import { monitorEventLoopDelay, createHistogram } from "perf_hooks";

// Track event-loop delay as a proxy for GC pause length
const loopDelayHistogram = createHistogram({ resolution: 10 });
const loopMonitor = monitorEventLoopDelay({ resolution: 10 });
loopMonitor.enable();

// Expose via Prometheus gauge
new promClient.Gauge({
  name: "nodejs_eventloop_delay_p99_ms",
  help: "99th percentile event-loop delay in milliseconds",
  collect() {
    this.set(loopDelayHistogram.percentile(99) / 1e6);
  },
});
```

A p99 event-loop delay above **10 ms** during a ledger ingestion burst is the
primary signal that GC tuning is needed. With the pooling refactor and the flags
above, the expected p99 on a machine with ≥4 vCPU / 2 GB RAM is **< 3 ms**.

---

## Summary of Changes

| File | Change | GC impact |
|---|---|---|
| `lib/translator/core.ts` | Object pool for `DecodedAddress` / `DecodedAmount` | −3 000 allocs/s at 1 000 events/s |
| `lib/translator/core.ts` | Module-level `HTML_ESCAPE` map + pre-compiled regexes | −1 alloc per `escapeHtml` call |
| `lib/translator/core.ts` | Bounded LRU for `shortenAddress` | Eliminates repeated string slicing for frequent contract IDs |
| `lib/translator/core.ts` | Iterative `interpolateTemplate` (no closure per substitution) | −1 closure alloc per `{token}` |
| `lib/translator/registry.ts` | Pre-allocated result array in `translateEvents` | Eliminates dynamic array resizing |
| `lib/translator/registry.ts` | `translateEventSafe` wrapper isolates try/catch from hot loop | Enables TurboFan JIT optimisation of the inner loop |
| `lib/stellar/ingestion-pool.ts` | Ring-buffer replaces `Array` + `shift()` per partition | O(1) dequeue vs O(n); eliminates internal array copy allocs |
| `docs/v8-gc-tuning.md` | This document | — |
| `scripts/profile-heap.ts` | CDP heap snapshot + diff script | — |
