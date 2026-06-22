# syntax=docker/dockerfile:1.7
# Multi-stage build — targets linux/amd64 and linux/arm64 via Docker Buildx.
#
# Build-arg TARGETARCH is injected automatically by Buildx:
#   linux/amd64  → TARGETARCH=amd64
#   linux/arm64  → TARGETARCH=arm64

# ── Stage 1: rust-builder ──────────────────────────────────────────────────────
# Compiles the soroban-xdr-decode native N-API addon for the target platform.
# Kept in its own stage so the entire Rust toolchain (~900 MB) is discarded
# before the final image is assembled.
FROM node:20-bookworm-slim AS rust-builder

ARG TARGETARCH

# ── System dependencies ───────────────────────────────────────────────────────
# build-essential        — gcc/g++/make for the native (amd64) linker.
# gcc-aarch64-linux-gnu  — aarch64 cross-linker; needed on amd64 runners.
# libssl-dev             — satisfies openssl-sys build scripts on amd64.
# libssl-dev:arm64       — satisfies openssl-sys when cross-compiling to arm64.
# pkg-config             — used by build scripts to locate system libraries.
# curl                   — used by the rustup installer script.
#
# dpkg --add-architecture arm64 enables Debian multiarch so we can install
# both amd64 and arm64 variants of libssl-dev in the same image layer.
RUN dpkg --add-architecture arm64 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        gcc-aarch64-linux-gnu \
        libssl-dev \
        libssl-dev:arm64 \
        pkg-config \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ── Rust toolchain ────────────────────────────────────────────────────────────
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal

# ── Detect target triple from TARGETARCH ─────────────────────────────────────
# Buildx sets TARGETARCH to "amd64" or "arm64".
# Write the Rust target triple to /rust-target so later RUN steps can read it
# without repeating the case statement.
RUN case "$TARGETARCH" in \
      amd64) echo "x86_64-unknown-linux-gnu"  > /rust-target ;; \
      arm64) echo "aarch64-unknown-linux-gnu" > /rust-target ;; \
      *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    rustup target add "$(cat /rust-target)"

# ── Cross-compilation environment ────────────────────────────────────────────
# Tell Cargo which linker to use for aarch64 targets when running on an
# amd64 host.  The variable is ignored on native arm64 builds.
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc

# When cross-compiling, pkg-config must be told to search for the target
# architecture's libraries rather than the host's.  We override it with
# the multiarch-aware wrapper only when the target differs from the host.
RUN if [ "$TARGETARCH" = "arm64" ]; then \
      printf '#!/bin/sh\nPKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig \\\n  exec /usr/bin/pkg-config "$@"\n' \
        > /usr/local/bin/aarch64-linux-gnu-pkg-config && \
      chmod +x /usr/local/bin/aarch64-linux-gnu-pkg-config; \
    fi

ENV PKG_CONFIG_ALLOW_CROSS=1

WORKDIR /addon

# ── Install napi-cli ──────────────────────────────────────────────────────────
# Copy only the addon package.json first so this layer is cached independently
# from Rust source changes.
COPY native/soroban-xdr-decode/package.json ./package.json

# Use --no-package-lock so npm does not try to write a lockfile (the directory
# is later overwritten by the Rust source COPY anyway).
# Call node_modules/.bin/napi directly in the build step — avoids npx network
# resolution inside Docker.
RUN npm install --no-package-lock --ignore-scripts

# ── Rust source ───────────────────────────────────────────────────────────────
COPY native/soroban-xdr-decode/Cargo.toml  ./Cargo.toml
COPY native/soroban-xdr-decode/build.rs    ./build.rs
COPY native/soroban-xdr-decode/src         ./src
COPY native/soroban-xdr-decode/.cargo      ./.cargo

# ── Generate Cargo.lock inside the build container ───────────────────────────
# Running cargo generate-lockfile here means the lockfile does not need to be
# committed to the repository.  BuildKit's --mount=type=cache preserves the
# Cargo registry between builds so this step is fast after the first run.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo generate-lockfile

# ── Compile the native addon ──────────────────────────────────────────────────
# Uses the same registry cache mount so crate downloads are reused.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/addon/target \
    RUST_TARGET="$(cat /rust-target)" && \
    ./node_modules/.bin/napi build \
        --platform \
        --release \
        --target "$RUST_TARGET"

# ── Verify the binary was produced ───────────────────────────────────────────
# A zero-match glob in Docker COPY succeeds silently; we catch a missing
# binary here instead of letting the runner stage start with no addon.
RUN test -n "$(ls *.node 2>/dev/null)" || \
    { echo "ERROR: napi build produced no .node binary" >&2; exit 1; }

# ── Stage 2: deps ─────────────────────────────────────────────────────────────
# Install Node.js production + dev dependencies in a throw-away layer.
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --ignore-scripts

# ── Stage 3: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Copy the prebuilt .node binary from rust-builder.
# napi-rs names it: soroban-xdr-decode.<target>.node
# The glob captures it regardless of the exact target suffix.
COPY --from=rust-builder /addon/*.node ./native/soroban-xdr-decode/

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build && \
    npx tsc --project tsconfig.server.json

# ── Stage 4: runner ───────────────────────────────────────────────────────────
# Minimal runtime image — no Rust toolchain, no build deps, no npm cache.
FROM node:20-alpine AS runner

# libc6-compat + gcompat: required to dlopen a glibc-linked .node binary
# inside a musl-based Alpine container.
RUN apk add --no-cache libc6-compat gcompat

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next            ./.next
COPY --from=builder --chown=nextjs:nodejs /app/.server-dist     ./.server-dist
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json     ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/package-lock.json ./package-lock.json

# Carry the .node binary to the runtime image.
COPY --from=builder --chown=nextjs:nodejs \
    /app/native/soroban-xdr-decode/*.node \
    ./native/soroban-xdr-decode/

RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", ".server-dist/server.js"]
