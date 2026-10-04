#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/open_audit_community_parser.wasm ./parser.wasm
echo "Wrote $(pwd)/parser.wasm"
