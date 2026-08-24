/**
 * Tests for the automatic TypeScript fallback around the native XDR decoder.
 *
 * The fallback must be automatic — no deployment configuration — and must
 * engage when the addon is absent, fails to load, throws at runtime, or
 * returns nonsense. These tests simulate each of those situations via the
 * loader's test override hook.
 */

import { describe, it, expect, afterEach } from "vitest";
import { xdr as StellarXdr } from "stellar-sdk";
import {
  __setNativeXdrDecoderForTests,
  __resetNativeXdrDecoderForTests,
  type NativeXdrDecoder,
} from "../native-xdr-decoder";
import { secureParseScVal } from "../secure-xdr-parser";

// Large enough to clear the small-payload heuristic in secureParseScVal
// (inputs shorter than ~96 hex chars always use the TS fast path).
const VALID_HEX =
  "0x" +
  StellarXdr.ScVal.scvVec([
    StellarXdr.ScVal.scvSymbol("transfer"),
    StellarXdr.ScVal.scvSymbol("from_account"),
    StellarXdr.ScVal.scvSymbol("to_account"),
    StellarXdr.ScVal.scvU32(1),
    StellarXdr.ScVal.scvU32(2),
  ]).toXDR("hex");

const MALFORMED_LONG = "0x" + "G".repeat(100);

function deepVecHex(depth: number): string {
  let scVal: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(42);
  for (let i = 0; i < depth; i++) {
    scVal = StellarXdr.ScVal.scvVec([scVal]);
  }
  return "0x" + scVal.toXDR("hex");
}

afterEach(() => {
  __resetNativeXdrDecoderForTests();
});

describe("native decoder fallback", () => {
  it("parses correctly when the native addon is unavailable", () => {
    __setNativeXdrDecoderForTests(null); // simulates "not built for platform"

    const ok = secureParseScVal(VALID_HEX);
    expect(ok.success).toBe(true);
    expect(ok.value?.vec()?.[0]?.sym().toString()).toBe("transfer");

    const malformed = secureParseScVal(MALFORMED_LONG);
    expect(malformed.success).toBe(false);
    expect(malformed.error?.errorType).toBe("MALFORMED_XDR");

    const deep = secureParseScVal(deepVecHex(150));
    expect(deep.success).toBe(false);
    expect(deep.error?.errorType).toBe("MAX_DEPTH_EXCEEDED");
  });

  it("falls back when the native decoder throws", () => {
    const broken: NativeXdrDecoder = {
      decodeScVal: () => {
        throw new Error("segfault-adjacent nonsense");
      },
    };
    __setNativeXdrDecoderForTests(broken);

    const ok = secureParseScVal(VALID_HEX);
    expect(ok.success).toBe(true);
    expect(ok.value?.vec()?.[0]?.sym().toString()).toBe("transfer");
  });

  it("falls back when the native decoder returns garbage", () => {
    const garbage = {
      decodeScVal: () => ({ success: "yes" }) as never,
    } as NativeXdrDecoder;
    __setNativeXdrDecoderForTests(garbage);

    const ok = secureParseScVal(VALID_HEX);
    expect(ok.success).toBe(true);
  });

  it("falls back when the native decoder reports an unknown error type", () => {
    const weird: NativeXdrDecoder = {
      decodeScVal: () => ({ success: false, errorType: "SOMETHING_NEW" }),
    };
    __setNativeXdrDecoderForTests(weird);

    const ok = secureParseScVal(VALID_HEX);
    expect(ok.success).toBe(true);
  });

  it("distrusts a native success the JS parser cannot reproduce", () => {
    // A lying decoder claims malformed input is fine; the wrapper must not
    // fabricate a value from it — the TS implementation decides.
    const liar: NativeXdrDecoder = {
      decodeScVal: () => ({ success: true }),
    };
    __setNativeXdrDecoderForTests(liar);

    const malformed = secureParseScVal(MALFORMED_LONG);
    expect(malformed.success).toBe(false);
    expect(malformed.error?.errorType).toBe("MALFORMED_XDR");
  });

  it("maps native guard errors onto the exact TS error classes", () => {
    const fake: NativeXdrDecoder = {
      decodeScVal: () => ({
        success: false,
        errorType: "MAX_DEPTH_EXCEEDED",
        actual: 101,
        limit: 100,
      }),
    };
    __setNativeXdrDecoderForTests(fake);

    const result = secureParseScVal(VALID_HEX);
    expect(result.success).toBe(false);
    expect(result.error?.name).toBe("MaxDepthExceededError");
    expect(result.error?.errorType).toBe("MAX_DEPTH_EXCEEDED");
    expect(result.error?.message).toContain("101 > 100");
  });
});
