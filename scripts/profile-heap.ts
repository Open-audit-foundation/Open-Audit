/**
 * Heap profiler for Open-Audit translation pipeline.
 *
 * Uses the Chrome DevTools Protocol (CDP) via Node.js's built-in
 * `inspector` module — no external dependencies required.
 *
 * Usage
 * ─────
 *   npx tsx scripts/profile-heap.ts
 *
 * What it does
 * ─────────────
 *  1. Opens an inspector session on the current process.
 *  2. Takes a baseline heap snapshot before any translation work.
 *  3. Runs a synthetic "crowded ledger" workload — 2 000 events translated
 *     in a tight loop, mimicking the GC pressure pattern described in the
 *     issue (short-lived object storm per ledger).
 *  4. Forces a full GC cycle (--expose-gc must be set, or the GC call is
 *     skipped gracefully) to promote surviving objects to old-gen.
 *  5. Takes a post-workload heap snapshot.
 *  6. Writes both snapshots to disk as .heapsnapshot files loadable in
 *     Chrome DevTools → Memory → Load profile.
 *  7. Prints a diff summary: total heap delta, retained object count, and
 *     the top-10 constructor groups by retained size.
 *
 * Interpreting results
 * ────────────────────
 *  Open the .heapsnapshot files in Chrome DevTools (Memory tab → Load).
 *  Use "Comparison" view between the two snapshots to pinpoint constructors
 *  with high "#New" counts — these are the allocation hot spots.
 *
 *  Key constructors to watch in this codebase:
 *    Object           — DecodedAddress / DecodedAmount literals
 *    String           — hex slices, template interpolation output
 *    Array            — topics arrays, queue.shift() internal copies
 *    (closure)        — per-event try/catch scopes in translateEvents
 */

import * as inspector from "inspector";
import * as fs from "fs";
import * as path from "path";

// ─── Synthetic workload ────────────────────────────────────────────────────────

import { translateEvents } from "../lib/translator/registry";
import { MOCK_RAW_EVENTS } from "../lib/mock-data";
import type { RawEvent } from "../lib/translator/types";

/** Inflate the mock dataset to simulate a crowded ledger (2 000 events). */
function buildLedgerBatch(targetSize: number): RawEvent[] {
  const batch: RawEvent[] = new Array(targetSize);
  for (let i = 0; i < targetSize; i++) {
    batch[i] = MOCK_RAW_EVENTS[i % MOCK_RAW_EVENTS.length];
  }
  return batch;
}

// ─── CDP heap snapshot helpers ────────────────────────────────────────────────

function takeHeapSnapshot(label: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const session = new inspector.Session();
    session.connect();

    const chunks: string[] = [];

    session.on("HeapProfiler.addHeapSnapshotChunk", ({ params }) => {
      chunks.push(params.chunk);
    });

    session.post("HeapProfiler.takeHeapSnapshot", { reportProgress: false }, () => {
      session.disconnect();
      const json = chunks.join("");
      const outPath = path.join(process.cwd(), `heap-${label}.heapsnapshot`);
      fs.writeFileSync(outPath, json);
      console.log(`[profiler] Snapshot saved → ${outPath}`);
      resolve(json);
    });
  });
}

/** Minimal parser — extracts constructor name → retained-size totals. */
function summariseSnapshot(json: string): Map<string, { count: number; size: number }> {
  type SnapshotData = {
    snapshot: { meta: { node_fields: string[]; node_types: string[][] } };
    nodes: number[];
    strings: string[];
  };
  const data = JSON.parse(json) as SnapshotData;
  const { node_fields, node_types } = data.snapshot.meta;
  const typeField = node_fields.indexOf("type");
  const nameField = node_fields.indexOf("name");
  const sizeField = node_fields.indexOf("self_size");
  const stride = node_fields.length;
  const typeStrings: string[] = node_types[typeField] as string[];

  const result = new Map<string, { count: number; size: number }>();

  for (let i = 0; i < data.nodes.length; i += stride) {
    const typeIdx = data.nodes[i + typeField];
    const nameIdx = data.nodes[i + nameField];
    const size = data.nodes[i + sizeField];
    const type = typeStrings[typeIdx] ?? "unknown";
    const name = type === "object" ? (data.strings[nameIdx] ?? "(object)") : type;
    const entry = result.get(name) ?? { count: 0, size: 0 };
    entry.count++;
    entry.size += size;
    result.set(name, entry);
  }
  return result;
}

function printTopRetainers(
  before: Map<string, { count: number; size: number }>,
  after: Map<string, { count: number; size: number }>,
  topN = 10
): void {
  type Row = { name: string; deltaCount: number; deltaSize: number };
  const rows: Row[] = [];

  const allNames = new Set([...before.keys(), ...after.keys()]);
  for (const name of allNames) {
    const b = before.get(name) ?? { count: 0, size: 0 };
    const a = after.get(name) ?? { count: 0, size: 0 };
    rows.push({
      name,
      deltaCount: a.count - b.count,
      deltaSize: a.size - b.size,
    });
  }

  rows.sort((x, y) => y.deltaSize - x.deltaSize);

  console.log("\n── Top allocation sources (post − pre workload) ──");
  console.log(
    "Constructor".padEnd(40) + "ΔCount".padStart(10) + "ΔSize (KB)".padStart(14)
  );
  console.log("─".repeat(64));
  for (const row of rows.slice(0, topN)) {
    console.log(
      row.name.slice(0, 39).padEnd(40) +
        String(row.deltaCount).padStart(10) +
        (row.deltaSize / 1024).toFixed(1).padStart(14)
    );
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[profiler] Warming up JIT (3 dry runs)...");
  const warmup = buildLedgerBatch(200);
  for (let i = 0; i < 3; i++) translateEvents(warmup);

  console.log("[profiler] Taking baseline heap snapshot...");
  const beforeJson = await takeHeapSnapshot("before");
  const beforeMap = summariseSnapshot(beforeJson);

  console.log("[profiler] Running crowded-ledger workload (2 000 events × 5 iterations)...");
  const batch = buildLedgerBatch(2_000);
  for (let iter = 0; iter < 5; iter++) {
    translateEvents(batch);
  }

  // Force a full GC if the process was started with --expose-gc.
  if (typeof (global as unknown as { gc?: () => void }).gc === "function") {
    console.log("[profiler] Forcing GC...");
    (global as unknown as { gc: () => void }).gc();
  } else {
    console.log("[profiler] --expose-gc not set; skipping forced GC (add it for cleaner diffs)");
  }

  console.log("[profiler] Taking post-workload heap snapshot...");
  const afterJson = await takeHeapSnapshot("after");
  const afterMap = summariseSnapshot(afterJson);

  printTopRetainers(beforeMap, afterMap);

  const totalBefore = [...beforeMap.values()].reduce((s, e) => s + e.size, 0);
  const totalAfter = [...afterMap.values()].reduce((s, e) => s + e.size, 0);
  console.log(
    `\n[profiler] Total heap: ${(totalBefore / 1024 / 1024).toFixed(2)} MB → ` +
    `${(totalAfter / 1024 / 1024).toFixed(2)} MB ` +
    `(Δ ${((totalAfter - totalBefore) / 1024 / 1024).toFixed(2)} MB)`
  );
  console.log("\n[profiler] Load heap-before.heapsnapshot and heap-after.heapsnapshot");
  console.log("          in Chrome DevTools → Memory → Load → Comparison view.");
}

main().catch((err) => {
  console.error("[profiler] Fatal:", err);
  process.exit(1);
});
