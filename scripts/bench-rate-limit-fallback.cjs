#!/usr/bin/env node
'use strict';

// Compare complete limiter modules without a provider or network connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');

function loadLimiter(path) {
  const source = fs.readFileSync(path, 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  let now = 100_000;
  const redisCache = { isRedisEnabled: () => false, getRedisClient: () => { throw Error('Unexpected Redis access'); } };
  const module = { exports: {} };
  const Clock = class extends Date { static now() { return now; } };
  new Function('require', 'module', 'exports', 'Date', 'console', compiled.outputText)(
    name => {
      assert.equal(name, '../cache/redisCache', 'Only the existing cache boundary may be injected');
      return redisCache;
    }, module, module.exports, Clock, { warn() {} },
  );
  return {
    api: module.exports,
    clock(value) { now = value; },
    hash: crypto.createHash('sha256').update(source).digest('hex'),
  };
}

async function equivalence(left, right) {
  let decisions = 0;
  const hash = crypto.createHash('sha256');
  function reset(time = 100_000) {
    for (const runtime of [left, right]) { runtime.api._clearBuckets(); runtime.clock(time); }
  }
  function clock(time) { left.clock(time); right.clock(time); }
  function prune(time) {
    left.api.pruneExpiredBuckets(time); right.api.pruneExpiredBuckets(time);
    assert.equal(left.api._getBucketsSize(), right.api._getBucketsSize());
  }
  async function request(key, tier) {
    const before = await left.api.checkRateLimit(key, tier);
    const after = await right.api.checkRateLimit(key, tier);
    assert.deepEqual(after, before);
    assert.equal(left.api._getBucketsSize(), right.api._getBucketsSize());
    hash.update(JSON.stringify([key, tier, before, left.api._getBucketsSize()]));
    decisions++;
    return after;
  }
  // Full partner bucket, duplicated timestamps, partial/exact expiry, then empty.
  reset();
  for (let i = 0; i < 2500; i++) await request('partner', 'partner');
  clock(101_000);
  for (let i = 0; i < 2500; i++) await request('partner', 'partner');
  assert.equal((await request('partner', 'partner')).allowed, false);
  clock(159_999);
  assert.equal((await request('partner', 'partner')).allowed, false);
  clock(160_000);
  assert.equal((await request('partner', 'partner')).remaining, 2499);
  // A lower tier does not remove valid timestamps already admitted at a higher tier.
  assert.equal((await request('partner', 'free')).allowed, false);
  clock(220_000);
  assert.equal((await request('partner', 'free')).remaining, 59);
  prune(280_000);
  assert.equal(left.api._getBucketsSize(), 0);

  // Global partial expiry and clock reversal preserve the sorted live suffix.
  reset();
  for (let i = 0; i < 30; i++) await request('clock', 'free');
  clock(101_000);
  for (let i = 0; i < 29; i++) await request('clock', 'free');
  clock(99_000);
  await request('clock', 'free');
  prune(159_000);
  clock(159_000);
  assert.equal((await request('clock', 'free')).allowed, true);
  assert.equal((await request('clock', 'free')).allowed, false);
  prune(Number.NaN);
  prune(-Infinity);
  prune(160_000);
  clock(160_000);
  assert.equal((await request('clock', 'free')).remaining, 29);

  // Deterministic mixed operations through public APIs, including backward time.
  reset();
  let seed = 0x418453;
  let time = 100_000;
  for (let i = 0; i < 20_000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    if (i % 97 === 0) time += seed % 3 === 0 ? -1000 : 1000;
    if (i % 701 === 0) time += 60_000;
    clock(time);
    if (i % 53 === 0) prune(time);
    await request(`mixed-${seed % 7}`, seed % 11 === 0 ? 'partner' : 'free');
  }
  prune(time + 60_000);
  assert.equal(left.api._getBucketsSize(), 0);
  return { decisions, traceSha256: hash.digest('hex') };
}

async function measure(runtime, scenario, keys = 24) {
  const api = runtime.api;
  api._clearBuckets();
  runtime.clock(100_000);
  // Seed through the actual exported limiter; seeding is outside the timer.
  for (let k = 0; k < keys; k++) {
    runtime.clock(100_000);
    for (let i = 0; i < 2500; i++) await api.checkRateLimit(`bench-${k}`, 'partner');
    runtime.clock(101_000);
    for (let i = 0; i < 2500; i++) await api.checkRateLimit(`bench-${k}`, 'partner');
  }
  const now = scenario.endsWith('full') ? 161_000 : scenario.endsWith('partial') ? 160_000 : 159_999;
  runtime.clock(now);
  const start = performance.now();
  if (scenario.startsWith('global')) api.pruneExpiredBuckets(now);
  else for (let k = 0; k < keys; k++) await api.checkRateLimit(`bench-${k}`, 'partner');
  const elapsedMs = performance.now() - start;
  const expectedRemaining = scenario.endsWith('full') ? 4999 : scenario.endsWith('partial') ? 2499 : 0;
  if (!scenario.startsWith('global')) {
    const result = await api.checkRateLimit('bench-0', 'partner');
    assert.equal(result.remaining, expectedRemaining > 0 ? expectedRemaining - 1 : 0);
  } else assert.equal(api._getBucketsSize(), scenario.endsWith('full') ? 0 : keys);
  return elapsedMs;
}

async function main() {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) throw Error('Usage: node scripts/bench-rate-limit-fallback.cjs BEFORE.ts AFTER.ts');
  const left = loadLimiter(beforePath);
  const right = loadLimiter(afterPath);
  const equivalenceResult = await equivalence(left, right);
  const rows = [];
  for (const scenario of ['request-full', 'request-partial', 'request-none', 'global-full', 'global-partial', 'global-none']) {
    const before = [], after = [];
    for (let pair = -2; pair < 7; pair++) {
      const order = pair % 2 === 0 ? [left, right] : [right, left];
      for (const runtime of order) {
        const ms = await measure(runtime, scenario);
        if (pair >= 0) (runtime === left ? before : after).push(ms);
      }
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    rows.push({ scenario, keys: 24, timestampsPerKey: 5000, beforeMs: before, afterMs: after,
      medianBeforeMs: median(before), medianAfterMs: median(after) });
  }
  console.log(JSON.stringify({ node: process.version, typescript: ts.version,
    beforeSha256: left.hash, afterSha256: right.hash, equivalence: equivalenceResult, rows }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
