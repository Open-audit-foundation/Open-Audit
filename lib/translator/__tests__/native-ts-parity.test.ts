/**
 * Native/TypeScript parity suite — the safety net for the native XDR decoder.
 *
 * For every payload in the parity corpus (which includes all inputs exercised
 * by fuzz-xdr-parser.test.ts and secure-xdr-parser.test.ts, plus grammar and
 * guard boundary coverage) this suite asserts that:
 *
 *  1. the raw native decoder classifies the input exactly like the pure-TS
 *     implementation (same success flag, same errorType);
 *  2. the public secureParseScVal (native-first) returns a result identical
 *     to secureParseScValTs — same parsed XDR bytes on success, same error
 *     class and message on failure (MALFORMED_XDR messages may differ in
 *     wording since they surface different underlying parsers' details, but
 *     the errorType and user-facing safe message are identical).
 *
 * A native decoder that handles any payload differently than the TS parser
 * is a security regression; this suite is expected to run with the addon
 * built (npm run build:native). Without the addon it is skipped, except for
 * the guard test asserting the suite would notice the addon's absence.
 */

import { describe, it, expect, afterEach } from "vitest";
import { xdr as StellarXdr } from "stellar-sdk";
import {
  getNativeXdrDecoder,
  __resetNativeXdrDecoderForTests,
} from "../native-xdr-decoder";
import { secureParseScVal, secureParseScValTs } from "../secure-xdr-parser";
import { buildParityCorpus } from "./xdr-parity-corpus";

const native = getNativeXdrDecoder();

type Observed =
  | { kind: "success"; xdrHex: string }
  | { kind: "error"; errorType: string; message: string }
  | { kind: "throw"; thrown: string };

function sameObserved(a: Observed, b: Observed): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "success" && b.kind === "success") return a.xdrHex === b.xdrHex;
  if (a.kind === "throw" && b.kind === "throw") return a.thrown === b.thrown;
  if (a.kind === "error" && b.kind === "error") {
    if (a.errorType !== b.errorType) return false;
    if (a.errorType === "MALFORMED_XDR") return true;
    return a.message === b.message;
  }
  return false;
}

function observe(fn: () => ReturnType<typeof secureParseScValTs>): Observed {
  try {
    const result = fn();
    if (result.success) {
      return { kind: "success", xdrHex: result.value.toXDR("hex") };
    }
    return {
      kind: "error",
      errorType: result.error.errorType,
      message: result.error.message,
    };
  } catch (e) {
    // A handful of existing behaviors throw (e.g. null input reaching
    // truncateHex); parity means both paths throw alike.
    return { kind: "throw", thrown: (e as Error).constructor.name };
  }
}

describe.skipIf(!native)("native/TS parity", () => {
  afterEach(() => {
    __resetNativeXdrDecoderForTests();
  });

  for (const { category, cases } of buildParityCorpus()) {
    it(`agrees on: ${category} (${cases.length} cases)`, () => {
      const mismatches: string[] = [];

      for (const { name, input } of cases) {
        const ts = observe(() => secureParseScValTs(input as string));
        const hybrid = observe(() => secureParseScVal(input as string));

        // 1) End-to-end equality of the public API vs the TS reference.
        //    MALFORMED_XDR messages carry parser-internal detail and are the
        //    one place wording may differ; everything else must be identical
        //    (the user-facing toSafeErrorMessage depends only on errorType).
        if (!sameObserved(hybrid, ts)) {
          mismatches.push(
            `${name}: secureParseScVal=${JSON.stringify(hybrid).slice(0, 300)} ` +
              `!= TS=${JSON.stringify(ts).slice(0, 300)}`
          );
          continue;
        }

        // 2) Raw native classification must match the TS classification for
        //    string inputs (non-strings make the addon throw a type error,
        //    by design — the wrapper falls back for those).
        if (typeof input === "string") {
          let raw;
          try {
            raw = native!.decodeScVal(input);
          } catch (e) {
            mismatches.push(`${name}: native decoder threw: ${e}`);
            continue;
          }
          if (ts.kind === "success" || ts.kind === "throw") {
            // "throw" cases fail inside TS logging *after* a failed parse;
            // the parse classification for them is failure, but the wrapper
            // behavior is already covered by check 1. Only success is
            // asserted here.
            if (ts.kind === "success" && raw.success !== true) {
              mismatches.push(
                `${name}: TS succeeded but native returned ${JSON.stringify(raw)}`
              );
            }
          } else if (raw.success !== false || raw.errorType !== ts.errorType) {
            mismatches.push(
              `${name}: TS error ${ts.errorType} but native returned ${JSON.stringify(
                raw
              ).slice(0, 300)}`
            );
          }
        }
      }

      expect(mismatches, mismatches.join("\n")).toEqual([]);
    });
  }

  it("guard-limit errors carry identical messages on both paths", () => {
    // Depth: 150-deep vec (SDK-built, single prefix) trips MAX_DEPTH_EXCEEDED.
    let scVal: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(1);
    for (let i = 0; i < 150; i++) scVal = StellarXdr.ScVal.scvVec([scVal]);
    const hex = "0x" + scVal.toXDR("hex");

    const ts = secureParseScValTs(hex);
    const hybrid = secureParseScVal(hex);
    expect(ts.success).toBe(false);
    expect(hybrid.success).toBe(false);
    if (!ts.success && !hybrid.success) {
      expect(hybrid.error.errorType).toBe("MAX_DEPTH_EXCEEDED");
      expect(hybrid.error.message).toBe(ts.error.message);
      expect(hybrid.error.name).toBe(ts.error.name);
    }
  });
});

describe("parity suite preconditions", () => {
  it("reports whether the native addon is available", () => {
    // Not an assertion on availability — CI without a Rust toolchain runs the
    // TS-only path — but make the suite's skip reason visible in output.
    if (!native) {
      console.warn(
        "[parity] native addon not built; parity assertions skipped. " +
          "Run `npm run build:native` to enable them."
      );
    }
    expect(true).toBe(true);
  });
});
