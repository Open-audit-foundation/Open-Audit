# Example Rust community parser

Reference guest for Open-Audit issue #405.

## Build

From the repository root:

```bash
bash lib/wasm-sandbox/examples/rust/build.sh
```

The script changes to this example's directory before running Cargo. Its local
`.cargo/config.toml` passes `--import-memory` to the linker so the compiled
`parser.wasm` uses the host's `env.memory`. Without this flag, Rust defines its
own memory and the sandbox rejects the module. The host still enforces its
configured memory maximum.

For a manual build, run these commands from this directory so Cargo discovers
the local configuration:

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/open_audit_community_parser.wasm ./parser.wasm
```

Use **`wasm32-unknown-unknown`**. WASI imports are rejected. A Cargo invocation
from another directory using only `--manifest-path` does not discover this
example's configuration; use the build script or change directory first.

## Manifest

See `manifest.json`. For CI / tests without a Rust toolchain, the repository
ships a precompiled WAT fixture (`fixtures/compiled/echo_parser.wasm`) that
satisfies the same ABI and is what `npm run test:wasm` exercises end-to-end.

## Compiled sandbox check

The [compiled-example job](https://github.com/woahwhattheheck/Open-Audit/actions/runs/37201229337)
built the original and repaired Rust examples with Rust/Cargo 1.98.1, LLVM
22.1.8 and Node 24.21.0 on Ubuntu 24.04.5. It used the unchanged worker from
`9befa56850ecb7bbe901119eeb6e916867cd8c4a` and completed successfully.

| Build or execution | Observed result |
| --- | --- |
| Original Cargo configuration | 36,966-byte module with private memory and no imports; rejected with `FORBIDDEN_IMPORTS` |
| Configuration above | 37,009-byte module importing only `env.memory`; emitted the expected sample transfer description |
| Repaired module's reported linear memory | 1,179,648 bytes (18 pages), within the supplied 256-page host cap |
| Same repaired module with a one-page host cap | Rejected with `MEMORY_LIMIT_EXCEEDED`, because the guest requires 17 initial pages |

The exact [controller](https://github.com/woahwhattheheck/Open-Audit/blob/6a8d2d744b7472cb5567dec5ce2838c9ab16bbcf/.github/workflows/oa455-rust-example-once.yml)
and [three-case worker driver](https://github.com/woahwhattheheck/Open-Audit/blob/6a8d2d744b7472cb5567dec5ce2838c9ab16bbcf/.github/scripts/oa455-rust-example-check.cjs)
remain on an isolated validation branch. The run's artifact contains both
compiled modules and raw results. The repaired module's SHA-256 is
`1fecb944b5f07f6d824db4902a737d27ed29cd228d95040161e69e73cd4d3432`.

The same binaries also passed all three cases against the composed worker
from `08de844a43681797a2b629cad69b7e986e68e6be` (worker Git blob
`69df2672dfbbfb80d91b3b64b5a4984495e84859`) on Node 24.19.0.
This checks compiled-guest compatibility and memory limits. The sample emits
a demonstration description; registry registration, real XDR decoding and
the full application are outside this execution. A single execution time is
not a statistical performance benchmark.
