"use strict";

// Compare complete production limiter sources against one disposable local Redis.
// No Redis command is mocked; only the existing cache-client import is supplied.
const fs = require("node:fs");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const crypto = require("node:crypto");
const ts = require("typescript");
const Redis = require("ioredis");

const [beforeFile, afterFile, ...extra] = process.argv.slice(2);
if (!beforeFile || !afterFile || extra.length || !process.env.TEST_REDIS_URL) {
  throw new Error(
    "Usage: TEST_REDIS_URL=redis://127.0.0.1:6379 node scripts/bench-rate-limit.cjs BEFORE.ts AFTER.ts",
  );
}
const redisUrl = new URL(process.env.TEST_REDIS_URL);
if (
  !["redis:", "rediss:"].includes(redisUrl.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(redisUrl.hostname)
) {
  throw new Error("Use a disposable Redis instance on a loopback address.");
}

const samples = 7;
const calls = 200;
const clients = Array.from(
  { length: 4 },
  () =>
    new Redis(process.env.TEST_REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    }),
);
let commandCount = 0;
for (const client of clients) {
  const send = client.sendCommand.bind(client);
  client.sendCommand = (...args) => {
    commandCount++;
    return send(...args);
  };
}
const keys = [];
const runId = crypto.randomUUID();
const sourceHashes = {};

function load(file, label) {
  const source = fs.readFileSync(file, "utf8");
  sourceHashes[label] = crypto.createHash("sha256").update(source).digest("hex");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports = {};
  let next = 0;
  vm.runInNewContext(
    compiled.outputText,
    {
      exports,
      require: (name) => {
        if (name !== "../cache/redisCache") {
          throw new Error(`Unexpected limiter import: ${name}`);
        }
        return {
          getRedisClient: () => clients[next++ % clients.length],
          isRedisEnabled: () => true,
        };
      },
      console,
      Date,
      Math,
      crypto: crypto.webcrypto,
    },
    { filename: file },
  );
  return exports;
}

const before = load(beforeFile, "before");
const after = load(afterFile, "after");
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure(mod, label, kind, sample) {
  const hashedKey = `bench-${runId}-${kind}-${label}-${sample}`;
  const key = `oa:rl:${hashedKey}`;
  keys.push(key);
  if (kind === "blocked") {
    const seed = [];
    const now = Date.now();
    for (let i = 0; i < 5000; i++) seed.push(now, `seed-${i}`);
    await clients[0].zadd(key, ...seed);
  }
  const startCommands = commandCount;
  const start = performance.now();
  for (let i = 0; i < calls; i++) {
    const result = await mod.checkRateLimit(hashedKey, "partner");
    if (result.allowed !== (kind === "allowed")) {
      throw new Error("Unexpected admission decision; benchmark invalid.");
    }
  }
  const elapsedMs = performance.now() - start;
  const providerCommands = commandCount - startCommands;
  if (mod._getBucketsSize() !== 0) {
    throw new Error("In-memory fallback occurred; benchmark invalid.");
  }
  return { elapsedMs, providerCommands };
}

(async () => {
  try {
    await Promise.all(clients.map((client) => client.connect()));
    const serverInfo = await clients[0].info("server");
    const redisVersion = /^redis_version:(.+)$/m.exec(serverInfo)?.[1].trim();
    keys.push(`oa:rl:warm-${runId}`);
    for (const mod of [before, after]) {
      for (let i = 0; i < 30; i++) {
        await mod.checkRateLimit(`warm-${runId}`, "partner");
      }
    }
    const rows = [];
    for (const kind of ["allowed", "blocked"]) {
      const timings = { before: [], after: [] };
      const commands = { before: [], after: [] };
      for (let sample = 0; sample < samples; sample++) {
        const order =
          sample % 2
            ? [["after", after], ["before", before]]
            : [["before", before], ["after", after]];
        for (const [label, mod] of order) {
          const result = await measure(mod, label, kind, sample);
          timings[label].push(result.elapsedMs);
          commands[label].push(result.providerCommands);
        }
      }
      rows.push({
        kind,
        samples,
        callsPerSample: calls,
        timingsMs: timings,
        providerCommands: commands,
        medianBeforeUs: (median(timings.before) * 1000) / calls,
        medianAfterUs: (median(timings.after) * 1000) / calls,
      });
    }
    console.log(JSON.stringify({
      node: process.version,
      typescript: ts.version,
      ioredis: require("ioredis/package.json").version,
      redis: redisVersion,
      transport: redisUrl.protocol === "rediss:" ? "loopback TLS" : "loopback TCP",
      clients: clients.length,
      sourceSha256: sourceHashes,
      rows,
    }, null, 2));
  } finally {
    try {
      if (clients[0].status === "ready" && keys.length) {
        await clients[0].del(...keys);
      }
    } finally {
      for (const client of clients) client.disconnect();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
