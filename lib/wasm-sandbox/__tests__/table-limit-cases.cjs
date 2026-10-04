"use strict";

// Shared by Vitest and the dependency-free Node entrypoint below. These cases
// execute the real worker and real WebAssembly; no runtime collaborator is mocked.
const assert = require("node:assert/strict");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const OUTPUT = { description: "bounded table", eventType: "probe" };
const INPUT = JSON.stringify({
  id: "table-probe", contractId: "C_TEST", topics: [], data: "",
  ledger: 1, timestamp: 1, txHash: "table-probe",
});
function uleb(n) {
  const bytes = [];
  do { const b = n & 127; n >>>= 7; bytes.push(b | (n ? 128 : 0)); } while (n);
  return bytes;
}
function sleb(n) {
  const bytes = [];
  for (;;) {
    const b = n & 127;
    n >>= 7;
    const last = (n === 0 && !(b & 64)) || (n === -1 && (b & 64));
    bytes.push(b | (last ? 0 : 128));
    if (last) return bytes;
  }
}
const text = s => { const bytes = [...Buffer.from(s)]; return [...uleb(bytes.length), ...bytes]; };
const vector = values => [...uleb(values.length), ...values.flat()];
const section = (id, bytes) => [id, ...uleb(bytes.length), ...bytes];
const body = ops => { const bytes = [0, ...ops, 11]; return [...uleb(bytes.length), ...bytes]; };
const constant = n => [0x41, ...sleb(n)];
// Trap on mismatch. Successful output proves the guest reached these assertions.
const equal = n => [...constant(n), 0x47, 0x04, 0x40, 0x00, 0x0b];
const sizeIs = (n, index = 0) => [0xfc, 16, ...uleb(index), ...equal(n)];
const grow = (n, index = 0, type = 0x70) => [0xd0, type, ...constant(n), 0xfc, 15, ...uleb(index)];

function moduleBytes(tables = [], { ops = [], indirect = false, startTrap = false } = {}) {
  const output = Buffer.from(JSON.stringify(OUTPUT));
  const types = [[0x60, 1, 0x7f, 1, 0x7f], [0x60, 2, 0x7f, 0x7f, 1, 0x7f], [0x60, 0, 1, 0x7f]];
  if (startTrap) types.push([0x60, 0, 0]);
  const functions = [[0], [1], [2]];
  if (startTrap) functions.push([3]);
  const translate = indirect ? [...constant(0), 0x11, 2, 0, ...equal(output.length)] : ops;
  const bodies = [body(constant(4096)), body([...translate, ...constant(64)]), body(constant(output.length))];
  if (startTrap) bodies.push(body([0x00]));
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, vector(types)),
    ...section(2, vector([[...text("env"), ...text("memory"), 2, 1, 1, 1]])),
    ...section(3, vector(functions)),
    ...(tables.length ? section(4, vector(tables.map(t => [
      ...(t.referenceType ?? [0x70]), t.max === undefined ? 0 : 1,
      ...uleb(t.min), ...(t.max === undefined ? [] : uleb(t.max)),
    ]))) : []),
    ...section(7, vector([[...text("alloc"), 0, 0], [...text("translate"), 0, 1], [...text("get_output_len"), 0, 2]])),
    ...(startTrap ? section(8, [3]) : []),
    ...(indirect ? section(9, vector([[0, ...constant(0), 11, ...vector([[2]])]])) : []),
    ...section(10, vector(bodies)),
    ...section(11, vector([[0, ...constant(64), 11, ...uleb(output.length), ...output]])),
  ]);
}

async function execute(bytes) {
  assert.equal(WebAssembly.validate(bytes), true, "fixture must be valid WASM before testing policy");
  const worker = new Worker(path.join(__dirname, "../worker.cjs"), {
    workerData: { wasmBytes: bytes, inputJson: INPUT, maxMemoryPages: 1, maxOutputBytes: 4096 },
  });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("table case worker timed out")), 2000);
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", code => reject(new Error(`worker exited without a result: ${code}`)));
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
function success(name, bytes) {
  return { name, run: async () => {
    const result = await execute(bytes);
    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.output, OUTPUT);
    assert.equal(result.peakMemoryBytes, 65_536);
  } };
}
function rejected(name, bytes, message, errorType = "MEMORY_LIMIT_EXCEEDED") {
  return { name, run: async () => {
    const result = await execute(bytes);
    assert.equal(result.success, false, "guest must be rejected before execution");
    assert.equal(result.errorType, errorType);
    assert.match(result.error, message);
  } };
}
const cases = [
  success("allows a parser without tables", moduleBytes()),
  success("preserves a bounded indirect function call", moduleBytes([{ min: 1, max: 1 }], { indirect: true })),
  success("allows growth up to the declared bound and denies growth beyond it", moduleBytes([{ min: 1, max: 4 }], {
    ops: [...grow(3), ...equal(1), ...sizeIs(4), ...grow(1), ...equal(-1), ...sizeIs(4)],
  })),
  success("allows bounded externref tables", moduleBytes([{ min: 0, max: 2, referenceType: [0x6f] }], {
    ops: [...grow(2, 0, 0x6f), ...equal(0), ...sizeIs(2)],
  })),
  success("allows exactly 65536 aggregate maximum elements", moduleBytes([{ min: 0, max: 32768 }, { min: 0, max: 32768 }])),
  success("allows exactly 32 zero-sized bounded tables", moduleBytes(Array.from({ length: 32 }, () => ({ min: 0, max: 0 })))),
  rejected("rejects an oversized hidden initial table", moduleBytes([{ min: 262144, max: 262144 }], { ops: sizeIs(262144) }), /table maxima/),
  rejected("rejects an oversized maximum even with zero initial elements", moduleBytes([{ min: 0, max: 262144 }]), /table maxima/),
  rejected("rejects an unbounded hidden table before table.grow", moduleBytes([{ min: 0 }], {
    ops: [...grow(262144), ...equal(0), ...sizeIs(262144)],
  }), /explicit maximum/),
  rejected("checks the sum of multiple table maxima", moduleBytes([{ min: 0, max: 40000 }, { min: 0, max: 40000 }]), /table maxima/),
  rejected("caps table count even when each maximum is zero", moduleBytes(Array.from({ length: 33 }, () => ({ min: 0, max: 0 }))), /more than 32 tables/),
  rejected("checks limits before a trapping start function runs", moduleBytes([{ min: 0, max: 262144 }], { startTrap: true }), /table maxima/),
  rejected("rejects unsupported GC reference table types", moduleBytes([{ min: 0, max: 1, referenceType: [0x6e] }]), /Forbidden table type/, "FORBIDDEN_IMPORTS"),
  rejected("does not misparse extended reference-type encodings", moduleBytes([{ min: 0, max: 1, referenceType: [0x63, 0x70] }]), /Forbidden table type/, "FORBIDDEN_IMPORTS"),
];
module.exports = { cases };

// Same case functions, production worker and assertions as the Vitest wrapper.
// Useful when only the narrow sandbox boundary is needed, without app packages.
if (require.main === module) {
  const { test } = require("node:test");
  for (const { name, run } of cases) test(name, run);
}
