#!/usr/bin/env bash
# Cross-platform-friendly build of the native XDR decoder inside a clean
# container. Useful when the host has no Rust toolchain, and as a CI check
# that the crate builds from a pristine environment.
#
# Produces native/soroban-xdr-decode/soroban-xdr-decode.linux-x64-gnu.node
# (or linux-arm64-gnu when run on an arm64 docker host).
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="${NATIVE_BUILD_IMAGE:-rust:1-bookworm}"

# Node is only needed inside the container to run scripts/build-native.mjs,
# which the rust image doesn't ship — install it on the fly from Debian's
# repo (any Node >= 16 works; the build script has no npm dependencies).
#
# The container uses its own cargo target dir (target/docker) so it never
# mixes root-owned artifacts into host builds, and chowns everything it
# produced back to the invoking user.
docker run --rm \
  -v "$PWD":/repo \
  -w /repo \
  -e CARGO_TARGET_DIR=/repo/native/soroban-xdr-decode/target/docker \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  "$IMAGE" \
  bash -ceu '
    if ! command -v node >/dev/null 2>&1; then
      apt-get update -qq && apt-get install -y -qq nodejs >/dev/null
    fi
    node scripts/build-native.mjs
    chown -R "$HOST_UID:$HOST_GID" \
      /repo/native/soroban-xdr-decode/target/docker \
      /repo/native/soroban-xdr-decode/*.node
  '

echo "Docker native build complete."
