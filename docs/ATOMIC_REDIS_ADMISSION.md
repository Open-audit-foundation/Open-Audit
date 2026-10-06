# Atomic Redis rate-limit admission

This follow-up belongs to the existing [PR #453](https://github.com/Open-audit-foundation/Open-Audit/pull/453) for issue #418. It preserves the original contribution and the subsequent build/runtime repairs.

## In-memory fallback timing

When a Redis operation fails, the fallback samples the current clock before
pruning, deciding admission, recording an accepted request and calculating
`retryAfter`. Its 60-second window begins at fallback admission; time spent
waiting for Redis does not consume that window or inflate a later retry delay.
The free/partner limits remain 60/5,000 per minute. Sorted timestamp insertion
is retained so a backward clock adjustment does not hide expired entries.
This timing correction does not change the Redis script or the historical
Redis measurements below.

## Required checks on the timing correction

On October 4, 2026, [native job 111408536802](https://github.com/woahwhattheheck/Open-Audit/actions/runs/37192857987/job/111408536802)
completed successfully on Ubuntu 24.04, Node 24.21.0, npm 11.19.0 and Vitest 3.2.7.
The checkout assertion and logs identify product commit
`ba8332fe15e0e6331b3166aa08d73bf2b3ab2fd4`, tree
`7e321f0abcfceb8210931689545f7fc1913b4bbc`.

- `npm ci --no-audit --no-fund`: passed with the unchanged lockfile.
- `npm test -- lib/auth/__tests__/rateLimit.test.ts --pool=forks --maxWorkers=2 --minWorkers=1`:
  **15 passed, 3 skipped**. All three fallback timing regressions ran. The skipped
  cases are the existing optional live-Redis integration cases.
- `npm run build`: passed, including TypeScript checking and 22/22 static pages.

The complete job took 59 seconds. Dependency deprecation notices and the existing
Turbopack file-tracing warning remain; no runtime deployment or full repository
test-suite result is claimed. The earlier real-Redis measurements below retain
their original source identity. Subsequent documentation-only commits do not
change the executed application or test source.

## Reproduced defect

At `cbcd78addca19ed5f7ba4d8b627a24bf8b3d2d36`, `checkRedisRateLimit` awaited a prune/count pipeline before sending a separate add/expiry pipeline. Concurrent callers could observe the same remaining slot and all be admitted. On an isolated Redis 7.0.15 server, four independent ioredis clients issuing 32 concurrent calls admitted all 32 while only one slot remained. This reproduced at both the free 60/minute limit and partner 5,000/minute limit.

The correction runs pruning, counting, conditional admission, expiry renewal and blocked-request retry calculation in one Lua `EVAL`. Redis executes the script atomically. The namespace, sliding-window boundary, limits, response shape and existing per-process fallback remain unchanged. Members use UUIDs so simultaneous requests cannot reuse a short random sorted-set member.

## Focused execution

Environment: cloud Linux, Node 24.19.0, ioredis 5.11.1, Vitest 3.2.7 and Redis 7.0.15. The isolated Redis instance listened only on 127.0.0.1, with persistence disabled, and was stopped after the run.

The same new real-Redis cases on the previous production source produced two contention failures and one passing exact-window-boundary control. The corrected existing limiter test file passed all **15 tests**, including the three integration cases. The Redis cases use unique per-run keys and delete only those keys. No in-memory fallback occurred in successful Redis cases.

With a disposable local Redis instance and project dependencies available, run:

```bash
TEST_REDIS_URL=redis://127.0.0.1:6379 \
  npx vitest run --environment node lib/auth/__tests__/rateLimit.test.ts
```

Without `TEST_REDIS_URL`, the three integration cases are skipped. This follow-up did not repeat the full application build or claim a new full-suite result; the previous source release records that separately.

## Measured request cost

The comparison executed each complete production TypeScript limiter through TypeScript's CommonJS transform, injecting only four real Redis connections at the existing cache-client boundary. There were no mocked Redis commands. After 30 warmup calls per source, seven alternating before/after pairs each made 200 sequential partner-tier calls, distributed over the same four connections. Each batch used a fresh key; blocked batches seeded 5,000 entries.

The table reports the median of each batch's average elapsed time per call, not the median of individual requests.

| Path | Previous source (microseconds/call) | Atomic source (microseconds/call) | Client commands/call | Network round trips/call |
| --- | ---: | ---: | --- | --- |
| Admitted | 189.095 | 98.602 | 4 to 1 | 2 to 1 |
| Blocked | 137.877 | 63.262 | 3 to 1 | 2 to 1 |

The observed batch means were about 47.9% and 54.1% lower respectively. These measurements use loopback TCP with no TLS, on a shared cloud host; they do not predict production or whole-application latency. Lua still performs the necessary Redis operations on the server, and the script text adds bytes to each `EVAL`. Client command counts describe network dispatch, not eliminated server work.

### Reproduce the comparison

The checked-in `scripts/bench-rate-limit.cjs` accepts two complete limiter source files. From a checkout containing the original revision, with project dependencies installed and a disposable local Redis running:

```bash
oa_before=$(mktemp)
git show cbcd78addca19ed5f7ba4d8b627a24bf8b3d2d36:lib/auth/rateLimit.ts > "$oa_before"
TEST_REDIS_URL=redis://127.0.0.1:6379 \
  node scripts/bench-rate-limit.cjs "$oa_before" lib/auth/rateLimit.ts
rm "$oa_before"
```

It runs the same four-client, seven-pair, 200-call comparison above and emits raw batches, client command counts, dependency/server versions, and both source SHA-256 hashes. It rejects unexpected admission decisions and in-memory fallback. The benchmark permits loopback Redis endpoints only, never flushes a database, and deletes only its unique per-run keys. Its source loader supplies the existing cache-client import and otherwise executes the complete production limiter. The recorded table above remains the original measurement; reruns will produce different timings.

Raw batch samples and command counts:

```json
{
  "node": "v24.19.0",
  "ioredis": "5.11.1",
  "transport": "127.0.0.1 TCP",
  "clients": 4,
  "rows": [
    {
      "kind": "allowed",
      "samples": 7,
      "callsPerSample": 200,
      "timingsMs": {
        "before": [
          50.90184999999997,
          26.933892999999898,
          37.81903299999999,
          41.98751900000002,
          49.75108399999999,
          28.796077999999966,
          36.97354999999993
        ],
        "after": [
          28.228171999999972,
          22.667269000000033,
          25.26225599999998,
          19.720402000000036,
          14.039597999999955,
          14.958773000000065,
          16.89106300000003
        ]
      },
      "providerCommands": {
        "before": [
          800,
          800,
          800,
          800,
          800,
          800,
          800
        ],
        "after": [
          200,
          200,
          200,
          200,
          200,
          200,
          200
        ]
      },
      "medianBeforeUs": 189.09516499999995,
      "medianAfterUs": 98.60201000000018
    },
    {
      "kind": "blocked",
      "samples": 7,
      "callsPerSample": 200,
      "timingsMs": {
        "before": [
          27.612996000000066,
          38.97066599999994,
          27.575469000000112,
          19.436574999999948,
          31.52532599999995,
          18.267035000000078,
          23.33421300000009
        ],
        "after": [
          18.45283799999993,
          18.72691599999996,
          16.10098199999993,
          12.430330999999796,
          12.350265000000036,
          12.652499999999918,
          10.539678999999978
        ]
      },
      "providerCommands": {
        "before": [
          600,
          600,
          600,
          600,
          600,
          600,
          600
        ],
        "after": [
          200,
          200,
          200,
          200,
          200,
          200,
          200
        ]
      },
      "medianBeforeUs": 137.87734500000056,
      "medianAfterUs": 63.26249999999959
    }
  ]
}
```
