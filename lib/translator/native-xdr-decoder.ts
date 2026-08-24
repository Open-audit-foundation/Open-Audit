/**
 * Loader for the optional native XDR decoder (native/soroban-xdr-decode).
 *
 * The native addon is a performance optimization only: when it is missing,
 * fails to load, or misbehaves at runtime, callers transparently fall back to
 * the pure-TypeScript parser in secure-xdr-parser.ts. Nothing here should
 * ever throw out of getNativeXdrDecoder().
 *
 * Set OPEN_AUDIT_DISABLE_NATIVE_XDR=1 to force the TypeScript path (useful
 * for debugging and benchmarking); no configuration is needed to enable the
 * native path — it is used automatically when the addon has been built via
 * `npm run build:native`.
 */

import { createRequire } from "module";
import * as path from "path";

/** Result shape returned by the native decodeScVal (see native crate lib.rs). */
export interface NativeDecodeOutcome {
  success: boolean;
  errorType?: string | null;
  /** Offending value for guard errors (depth reached, bytes allocated, ...). */
  actual?: number | null;
  /** The limit that was exceeded, for guard errors. */
  limit?: number | null;
  /** Parse error detail for MALFORMED_XDR. */
  message?: string | null;
}

export interface NativeXdrDecoder {
  decodeScVal(hex: string): NativeDecodeOutcome;
}

// undefined = not yet resolved; null = resolved to "unavailable"
let cached: NativeXdrDecoder | null | undefined;
// Test hook: undefined = inactive, otherwise overrides the cached value.
let testOverride: NativeXdrDecoder | null | undefined;

/**
 * Returns the native decoder if it is built and healthy on this platform,
 * or null when the TypeScript fallback should be used. Never throws.
 */
export function getNativeXdrDecoder(): NativeXdrDecoder | null {
  if (testOverride !== undefined) return testOverride;
  if (cached === undefined) {
    cached = loadNativeDecoder();
  }
  return cached;
}

/** Overrides the loaded decoder in tests (pass null to simulate "not built"). */
export function __setNativeXdrDecoderForTests(
  decoder: NativeXdrDecoder | null
): void {
  testOverride = decoder;
}

/** Clears the test override and any cached load result. */
export function __resetNativeXdrDecoderForTests(): void {
  testOverride = undefined;
  cached = undefined;
}

function loadNativeDecoder(): NativeXdrDecoder | null {
  try {
    const disabled = process.env.OPEN_AUDIT_DISABLE_NATIVE_XDR;
    if (disabled === "1" || disabled === "true") return null;

    const suffix = platformSuffix();
    if (!suffix) return null;

    const candidates: string[] = [];
    if (process.env.OPEN_AUDIT_NATIVE_XDR_PATH) {
      candidates.push(process.env.OPEN_AUDIT_NATIVE_XDR_PATH);
    }
    const binary = `soroban-xdr-decode.${suffix}.node`;
    // __dirname exists when compiled to CommonJS (tsconfig.server.json); under
    // bundlers/ESM test runners we fall back to resolving from the repo root.
    if (typeof __dirname !== "undefined") {
      candidates.push(
        path.join(__dirname, "..", "..", "native", "soroban-xdr-decode", binary)
      );
    }
    candidates.push(
      path.join(process.cwd(), "native", "soroban-xdr-decode", binary)
    );

    const req = createRequire(path.join(process.cwd(), "package.json"));
    for (const candidate of candidates) {
      try {
        const mod = req(candidate) as Partial<NativeXdrDecoder>;
        if (typeof mod?.decodeScVal === "function" && selfTest(mod as NativeXdrDecoder)) {
          return mod as NativeXdrDecoder;
        }
      } catch {
        // Try the next candidate; fall back to TS if none load.
      }
    }
  } catch {
    // Any unexpected failure (no process, no fs access, ...) → TS fallback.
  }
  return null;
}

/**
 * Sanity-checks a freshly loaded addon against two known vectors so a stale
 * or broken binary is discarded rather than trusted.
 */
function selfTest(decoder: NativeXdrDecoder): boolean {
  try {
    const ok = decoder.decodeScVal("0x00000001"); // scvVoid
    const bad = decoder.decodeScVal("not-hex"); // malformed
    return (
      ok?.success === true &&
      bad?.success === false &&
      bad?.errorType === "MALFORMED_XDR"
    );
  } catch {
    return false;
  }
}

function platformSuffix(): string | null {
  const { platform, arch } = process;
  if (platform === "linux") {
    const abi = isMusl() ? "musl" : "gnu";
    if (arch === "x64") return `linux-x64-${abi}`;
    if (arch === "arm64") return `linux-arm64-${abi}`;
  }
  if (platform === "darwin") {
    if (arch === "x64") return "darwin-x64";
    if (arch === "arm64") return "darwin-arm64";
  }
  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";
  return null;
}

function isMusl(): boolean {
  try {
    return !(process.report?.getReport() as { header?: { glibcVersionRuntime?: string } })
      ?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}
