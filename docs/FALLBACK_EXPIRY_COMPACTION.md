# Fallback timestamp expiry compaction

This continuation belongs to existing PR #453 for issue #418. It does not change
Redis admission, tier limits, the sliding-window boundary, response fields,
fallback clock sampling, or timestamp ordering.

## Change

Both fallback expiry paths now share one sorted-prefix helper. A fully expired
bucket is cleared directly. For partial expiry, binary search locates the first
live timestamp, then one splice removes the expired prefix rather than shifting
each entry separately. The splice creates a temporary removed-prefix array;
this is not a memory-allocation reduction claim. Empty and not-yet-expired
buckets return without modification. Explicit NaN prune times retain their
previous no-op behavior.

## Required package checks

[Job 111430994525](https://github.com/woahwhattheheck/Open-Audit/actions/runs/37200489154/job/111430994525)
completed successfully on October 4, 2026, checking out product commit
`41d1d5eb061a5294437e7233b43920a66d835988`, tree
`3efab01363a06627187288d294dffb93a58e1155`.

Environment: Ubuntu 24.04.5, Node 24.21.0, npm 11.19.0, Vitest 3.2.7.
The unchanged lockfile installed successfully with `npm ci --no-audit --no-fund`.
Both maintained limiter files passed: **18 passed, 3 skipped**, two files,
598 ms. All three new expiry cases executed. The skipped cases are the existing
optional live-Redis cases; they are not counted as passes.

`npm run build` passed: production compilation, TypeScript checking, and 22/22
static pages. The job ran from 11:57:58 to 11:58:32 UTC. Existing dependency,
install-script, middleware-convention, file-tracing and action-runtime warnings
remain visible in the logs. No full repository suite, live Redis execution,
deployment, or maintainer acceptance is claimed for this continuation.

This documentation-only successor does not change the executed source.

## Executed comparison

Baseline: `3f42a822b84fd7767eec0600b95b379d6ee4a9dc`,
`lib/auth/rateLimit.ts` blob `1464def54c0a685dce2c12c24ca670cc8a510496`.
The complete before/after TypeScript modules ran on cloud Linux, Node v22.16.0
and TypeScript 5.8.3. The loader changes only the existing cache-client
boundary to disable Redis and supplies a controlled clock. It does not replace
arrays, maps, admission logic, or expiry operations. No network calls occur.

The comparison matched **25,068 admission decisions**, including
exact expiry, repeated timestamps, large partial expiry, free/partner tier
changes, backward clock movement, explicit invalid prune times, and deterministic
mixed public-API operations. These are decisions in one comparison, not that
many independent tests. Trace SHA-256:
`e284780d076f0a63bf14dcfd31ea9d3a3092c7eaac544a93c3f5df9afbe2c7d1`.

Each measured batch contains 24 buckets with 5,000 timestamps per bucket.
Seeding through the actual exported limiter is outside the timer. Two warmup
pairs precede seven alternating measured pairs. Half the entries expire in the
partial case; all expire in the full case; none expire in the control. Reported
numbers are medians of total batch elapsed time, in milliseconds.

| Path | Before (ms/batch) | After (ms/batch) |
| --- | ---: | ---: |
| request-full | 6.585496 | 0.020861 |
| request-partial | 3.343379 | 0.131248 |
| request-none | 0.009765 | 0.008894 |
| global-full | 6.426787 | 0.023585 |
| global-partial | 3.300625 | 0.152811 |
| global-none | 0.004136 | 0.012358 |

The empty-expiry global control is slower in this sample, by about eight
microseconds per 24-bucket batch. Tiny control timings are noisy and are not
represented as an improvement. The large-expiry speedups are for the measured
in-process cleanup workload, not production, network, or whole-application
latency. Shared-host timings vary.

## Reproduction

With repository dependencies installed, run against trusted local source files:

```bash
before=$(mktemp)
git show 3f42a822b84fd7767eec0600b95b379d6ee4a9dc:lib/auth/rateLimit.ts > "$before"
node scripts/bench-rate-limit-fallback.cjs "$before" lib/auth/rateLimit.ts
rm "$before"
```

The maintained `rateLimit.test.ts` is unchanged. Three adjacent cases in
`rateLimit.expiry.test.ts` retain large live suffixes through request/global
expiry and preserve explicit nonfinite prune behavior. Required target:

```bash
npm test -- lib/auth/__tests__/rateLimit.test.ts lib/auth/__tests__/rateLimit.expiry.test.ts --pool=forks --maxWorkers=2 --minWorkers=1
npm run build
```

The local comparison and the independent required package run above are distinct
measurements. The earlier results in `ATOMIC_REDIS_ADMISSION.md` retain their
original source identity; no historical result is silently repinned here.

## Raw measurements and source identity

```json
{"node":"v22.16.0","typescript":"5.8.3","beforeSha256":"6da7cd099e0aab1a41bdf569cb32bdad5c988349a1424495cbc60e37f273124b","afterSha256":"cf6ba607dc88e6de94dac3f37e9d09f691c66c03083954d4c12fac856217872d","equivalence":{"decisions":25068,"traceSha256":"e284780d076f0a63bf14dcfd31ea9d3a3092c7eaac544a93c3f5df9afbe2c7d1"},"rows":[{"scenario":"request-full","keys":24,"timestampsPerKey":5000,"beforeMs":[7.340574000000004,7.36692400000004,7.551912000000016,6.585495999999921,6.481469000000061,6.460728000000017,6.51719300000002],"afterMs":[0.020860999999968044,0.028943999999967218,0.033380999999963024,0.021683000000052743,0.019930000000044856,0.02004999999996926,0.018597999999997228],"medianBeforeMs":6.585495999999921,"medianAfterMs":0.020860999999968044},{"scenario":"request-partial","keys":24,"timestampsPerKey":5000,"beforeMs":[3.5995750000000726,3.24728499999992,3.263549000000012,3.3027080000000524,3.455887999999959,3.3433789999999135,3.3834589999999025],"afterMs":[0.13892900000007558,0.13224900000000162,0.1312480000000278,0.1312080000000151,0.13156800000001567,0.13068699999985256,0.1259900000000016],"medianBeforeMs":3.3433789999999135,"medianAfterMs":0.1312480000000278},{"scenario":"request-none","keys":24,"timestampsPerKey":5000,"beforeMs":[0.009253999999828011,0.009634000000005472,0.0089940000000297,0.01245799999992414,0.009925000000066575,0.010956999999962136,0.009765000000015789],"afterMs":[0.008182999999917229,0.008583000000044194,0.01044499999989057,0.008593000000018947,0.009303999999929147,0.008894000000054803,0.009354000000030283],"medianBeforeMs":0.009765000000015789,"medianAfterMs":0.008894000000054803},{"scenario":"global-full","keys":24,"timestampsPerKey":5000,"beforeMs":[6.521278999999822,6.426787000000104,6.420757999999978,6.420517999999902,6.4252950000000055,6.536752999999862,6.460557999999992],"afterMs":[0.024106999999958134,0.01989899999989575,0.02912400000013804,0.023315000000138753,0.027211000000079366,0.020150000000057844,0.02358500000013919],"medianBeforeMs":6.426787000000104,"medianAfterMs":0.02358500000013919},{"scenario":"global-partial","keys":24,"timestampsPerKey":5000,"beforeMs":[3.212871999999834,3.3165889999997944,3.19791999999984,3.2536439999998947,3.6614879999997356,3.435728000000381,3.3006249999998545],"afterMs":[0.16020099999991544,0.1380779999999504,0.14372700000012628,0.15446300000007795,0.15281099999992875,0.16291499999988446,0.14279500000020562],"medianBeforeMs":3.3006249999998545,"medianAfterMs":0.15281099999992875},{"scenario":"global-none","keys":24,"timestampsPerKey":5000,"beforeMs":[0.004046000000016647,0.003975999999966007,0.004836999999952241,0.004737000000204716,0.004136000000016793,0.0044060000000172295,0.0034049999999297142],"afterMs":[0.011627999999745953,0.009825000000091677,0.014752999999927852,0.012357999999949243,0.012748999999985244,0.012107999999898311,0.012758999999732623],"medianBeforeMs":0.004136000000016793,"medianAfterMs":0.012357999999949243}]}
```
