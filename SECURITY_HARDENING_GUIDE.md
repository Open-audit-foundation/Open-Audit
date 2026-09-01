# Security Hardening Guide

This document describes the defenses Open-Audit applies when parsing
untrusted XDR/ScVal payloads from Stellar/Soroban contract events, and
where to find the tests that verify each one.

Untrusted contract events can be crafted to attack the parser itself —
deeply nested structures to blow the stack, huge collections or byte
strings to exhaust memory, or payloads designed to make parsing hang.
All XDR parsing in Open-Audit goes through
[`lib/translator/secure-xdr-parser.ts`](lib/translator/secure-xdr-parser.ts),
which wraps the underlying `stellar-sdk` XDR decoder with the guards
described below. The guards themselves live in
[`lib/translator/parser-security.ts`](lib/translator/parser-security.ts).

## What's enforced

| Guard | Limit | Purpose |
|---|---|---|
| Recursion depth | 100 levels (`MAX_RECURSION_DEPTH`) | Prevents stack overflow from deeply nested `Map`/`Vec`/`Struct` values. Legitimate contracts nest to depth < 10. |
| Memory allocation | 10 MB per payload (`MAX_PAYLOAD_SIZE_BYTES`) | Prevents out-of-memory attacks from payloads that claim huge sizes. |
| Parse timeout | 5,000 ms (`MAX_PARSE_TIME_MS`) | Prevents infinite-loop / pathologically slow payloads from hanging the parser. |
| Hex string length | 2 MB of hex chars, i.e. 1 MB binary (`MAX_HEX_STRING_LENGTH`) | Rejects absurdly large inputs before parsing even starts. |
| Collection size | 10,000 elements (`MAX_COLLECTION_SIZE`) | Prevents `Map`/`Vec` values with an excessive number of entries. |

Every limit is a named constant exported from `parser-security.ts` —
that file is the source of truth if a value here goes stale.

## How it works

- `secureParseScVal(hex)` and `secureParseSpecEntries(payload)` never
  throw. They return a `SafeParseResult` (`{ success, value }` or
  `{ success: false, error }`), so a malicious or malformed payload
  degrades to a safe error result instead of crashing the process.
- Every recursive structure (`Map`, `Vec`) is walked through
  `validateScValStructure`, which calls `checkTimeout`,
  `validateCollectionSize`, and `trackAllocation` at each level via a
  `ParsingContext` that is threaded through the recursion — so limits
  are enforced cumulatively, not just at the top level.
- On failure, `logSecurityError` records the error and
  `toSafeErrorMessage` converts it to a message safe to show to a user
  (no raw payload or internal state leakage).
- `getSecurityMetrics()` / `resetSecurityMetrics()` track counts of
  parse attempts, failures, and failure types in-process, and
  `detectAttackPattern` flags repeated failures of the same type as a
  potential attack. These are currently in-process helpers exercised
  by the test suite below; there is no HTTP endpoint exposing them.

## Tests that verify each guard

| Guard / behavior | Test file |
|---|---|
| Recursion depth tracking | `lib/translator/__tests__/parser-security.test.ts` → `describe("Recursion Depth Tracking")` |
| Memory allocation tracking | `lib/translator/__tests__/parser-security.test.ts` → `describe("Memory Allocation Tracking")` |
| Parse timeout detection | `lib/translator/__tests__/parser-security.test.ts` → `describe("Parse Timeout Detection")` |
| Collection size validation | `lib/translator/__tests__/parser-security.test.ts` → `describe("Collection Size Validation")` |
| Hex length validation | `lib/translator/__tests__/parser-security.test.ts` → `describe("Hex Length Validation")` |
| Safe parse wrapper (never throws) | `lib/translator/__tests__/parser-security.test.ts` → `describe("Safe Parse Wrapper")` |
| Security metrics tracking | `lib/translator/__tests__/parser-security.test.ts` → `describe("Security Metrics")`, and `lib/translator/__tests__/secure-xdr-parser.test.ts` → `describe("Security Metrics Tracking")` |
| Attack pattern detection | `lib/translator/__tests__/parser-security.test.ts` → `describe("Attack Pattern Detection")` |
| Safe error messages (no leakage) | `lib/translator/__tests__/parser-security.test.ts` → `describe("Safe Error Messages")` |
| End-to-end secure parsing (valid + nested + real-world events) | `lib/translator/__tests__/secure-xdr-parser.test.ts` |
| Randomized/fuzzed malicious payloads | `lib/translator/__tests__/fuzz-xdr-parser.test.ts` |

Run the security-focused suites directly with:

```bash
npm run test:security       # parser-security.test.ts
npm run test:fuzz           # fuzz-xdr-parser.test.ts
npm run test:secure-parser  # secure-xdr-parser.test.ts
npm run test:all-security   # all three together
```

## Usage

```typescript
import { secureParseScVal } from '@/lib/translator/secure-xdr-parser';

const result = secureParseScVal(hex);
if (result.success) {
  // Use result.value safely
} else {
  // result.error is a ParserSecurityError subclass; safe to log/display
}
```

## Scope

These guards protect the XDR/ScVal parsing layer specifically. They
are not a general-purpose sandbox: there is currently no isolated
execution environment (e.g. WASM sandboxing) for third-party contract
parsers in this repository.
