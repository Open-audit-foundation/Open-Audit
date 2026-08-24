# soroban-xdr-decode

Native (Rust, N-API) decoder for Soroban `ScVal` XDR payloads. This is the
optional performance path behind `secureParseScVal` in
[`lib/translator/secure-xdr-parser.ts`](../../lib/translator/secure-xdr-parser.ts);
the TypeScript implementation is the reference and the automatic fallback.

## Contract

`decodeScVal(hex: string)` performs the same pipeline as the TypeScript
parser — hex-length guard, allocation accounting, Node-compatible hex
decoding, full protocol-21 `ScVal` grammar parse with `@stellar/js-xdr`
acceptance rules, and a validation traversal replicating
`validateScValStructure` — and returns
`{ success, errorType?, actual?, limit?, message? }`. The TypeScript wrapper
reconstructs the exact `ParserSecurityError` subclasses from that outcome.

**Security guards must never be weaker here than in
`lib/translator/parser-security.ts`.** Any change to either implementation
must keep `npm run test:parity` green — that suite runs the shared
fuzz/security corpus against both implementations and asserts identical
results.

## Building

From the repository root:

```bash
npm run build:native          # release build → soroban-xdr-decode.<platform>.node
npm run build:native:debug
npm run build:native:docker   # clean-container build (no local Rust required)
```

Supported platforms: Linux x64/arm64 (glibc & musl), macOS x64/arm64,
Windows x64. Elsewhere the build script exits with a message and the
TypeScript parser is used automatically.

The `.node` binaries are intentionally not committed; the loader
(`lib/translator/native-xdr-decoder.ts`) falls back to TypeScript when no
binary is present.
