/**
 * Benchmark harness for the secure XDR parser: pure-TypeScript implementation
 * vs the native Rust decoder (when built).
 *
 * Run with:
 *   npm run bench:xdr                # compares TS vs native (if built)
 *
 * The workloads model realistic Soroban event traffic (small transfer events,
 * medium nested structs, large collections) as well as hostile payloads
 * (deeply nested and oversized collections), since fast *rejection* of
 * attacks is as important as fast parsing of legitimate traffic.
 *
 * Numbers printed here are the source for the README section on the native
 * decoder — re-run and update the table when either implementation changes.
 */

import { xdr as StellarXdr } from "stellar-sdk";
import {
  secureParseScVal,
  secureParseScValTs,
} from "../lib/translator/secure-xdr-parser";
import { getNativeXdrDecoder } from "../lib/translator/native-xdr-decoder";

// Silence the security logger — hostile workloads would otherwise spam stderr
// and the console I/O would dominate the measurement.
console.error = () => {};

interface Workload {
  name: string;
  payloads: string[];
}

function sdkHex(v: StellarXdr.ScVal): string {
  return "0x" + v.toXDR("hex");
}

function buildWorkloads(): Workload[] {
  const address = StellarXdr.ScVal.scvAddress(
    StellarXdr.ScAddress.scAddressTypeAccount(
      StellarXdr.PublicKey.publicKeyTypeEd25519(Buffer.alloc(32, 7))
    )
  );
  const transferEvent = [
    sdkHex(StellarXdr.ScVal.scvSymbol("transfer")),
    sdkHex(address),
    sdkHex(address),
    sdkHex(
      StellarXdr.ScVal.scvI128(
        new StellarXdr.Int128Parts({
          hi: StellarXdr.Int64.fromString("0"),
          lo: StellarXdr.Uint64.fromString("1000000"),
        })
      )
    ),
  ];

  let mediumStruct: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(42);
  for (let level = 0; level < 5; level++) {
    const entries: StellarXdr.ScMapEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push(
        new StellarXdr.ScMapEntry({
          key: StellarXdr.ScVal.scvSymbol(`field_${level}_${i}`),
          val: i === 0 ? mediumStruct : StellarXdr.ScVal.scvU32(i),
        })
      );
    }
    mediumStruct = StellarXdr.ScVal.scvMap(entries);
  }

  const largeVecItems: StellarXdr.ScVal[] = [];
  for (let i = 0; i < 1000; i++) largeVecItems.push(StellarXdr.ScVal.scvU32(i));

  const largeMapEntries: StellarXdr.ScMapEntry[] = [];
  for (let i = 0; i < 5000; i++) {
    largeMapEntries.push(
      new StellarXdr.ScMapEntry({
        key: StellarXdr.ScVal.scvU32(i),
        val: StellarXdr.ScVal.scvVoid(),
      })
    );
  }

  let deepAttack: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(1);
  for (let i = 0; i < 150; i++) deepAttack = StellarXdr.ScVal.scvVec([deepAttack]);

  let hugeCollectionAttack: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(1);
  {
    const items: StellarXdr.ScVal[] = [];
    for (let i = 0; i < 20000; i++) items.push(StellarXdr.ScVal.scvVoid());
    hugeCollectionAttack = StellarXdr.ScVal.scvVec(items);
  }

  return [
    { name: "typical transfer event (4 payloads)", payloads: transferEvent },
    { name: "medium nested struct (depth 5, 50 fields)", payloads: [sdkHex(mediumStruct)] },
    { name: "large vec (1,000 u32)", payloads: [sdkHex(largeVecItems.length ? StellarXdr.ScVal.scvVec(largeVecItems) : StellarXdr.ScVal.scvVoid())] },
    { name: "large map (5,000 entries)", payloads: [sdkHex(StellarXdr.ScVal.scvMap(largeMapEntries))] },
    { name: "attack: nested vec depth 150", payloads: [sdkHex(deepAttack)] },
    { name: "attack: vec with 20,000 elements", payloads: [sdkHex(hugeCollectionAttack)] },
    { name: "malformed: tiny truncated garbage", payloads: ["0x00000010000000", "0xdeadbeef", "0x00000011ffff"] },
    {
      name: "malformed: 4KB of garbage",
      payloads: ["0x00000010" + "00000fa0" + "ab".repeat(4000)],
    },
  ];
}

function timedRound(fn: () => void, roundMs: number): number {
  let iterations = 0;
  const start = performance.now();
  const end = start + roundMs;
  let now = start;
  while (now < end) {
    fn();
    iterations++;
    now = performance.now();
  }
  return iterations / ((now - start) / 1000);
}

/**
 * Measures two implementations with interleaved rounds (A B A B A B) and
 * returns the best round of each. Interleaving keeps CPU frequency scaling
 * and GC drift from biasing whichever side happens to run later; best-of-N
 * damps JIT warmup artifacts.
 */
function measurePair(
  a: () => void,
  b: (() => void) | null,
  durationMs: number
): { a: number; b: number | null } {
  const roundMs = durationMs / (b ? 6 : 3);
  // Warmup both
  const warmupEnd = performance.now() + Math.min(200, roundMs);
  while (performance.now() < warmupEnd) {
    a();
    if (b) b();
  }

  let bestA = 0;
  let bestB = 0;
  for (let round = 0; round < 3; round++) {
    bestA = Math.max(bestA, timedRound(a, roundMs));
    if (b) bestB = Math.max(bestB, timedRound(b, roundMs));
  }
  return { a: bestA, b: b ? bestB : null };
}

function fmt(n: number): string {
  return n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1);
}

function main(): void {
  const native = getNativeXdrDecoder();
  const durationMs = Number(process.env.BENCH_DURATION_MS ?? 1000);

  console.log(`Node ${process.version} on ${process.platform}-${process.arch}`);
  console.log(
    native
      ? "Native decoder: loaded (native/soroban-xdr-decode)"
      : "Native decoder: NOT built — run `npm run build:native`; benchmarking TS only"
  );
  console.log(`Duration per case: ${durationMs} ms\n`);

  const rows: string[][] = [["workload", "TS ops/s", "native ops/s", "speedup"]];

  for (const workload of buildWorkloads()) {
    const runTs = () => {
      for (const p of workload.payloads) secureParseScValTs(p);
    };
    const runNative = native
      ? () => {
          for (const p of workload.payloads) secureParseScVal(p);
        }
      : null;
    const { a: tsOps, b: nativeOps } = measurePair(runTs, runNative, durationMs);

    rows.push([
      workload.name,
      fmt(tsOps),
      nativeOps === null ? "—" : fmt(nativeOps),
      nativeOps === null ? "—" : `${(nativeOps / tsOps).toFixed(2)}x`,
    ]);
  }

  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].map((cell, col) => cell.padEnd(widths[col])).join(" | ");
    console.log(`| ${line} |`);
    if (i === 0) {
      console.log(`| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`);
    }
  }
}

main();
