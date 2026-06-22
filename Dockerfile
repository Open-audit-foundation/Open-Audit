# syntax=docker/dockerfile:1.7
# Multi-stage build — targets linux/amd64 and linux/arm64 via Docker Buildx.
# Each stage is pinned to a digest-stable tag to keep security scans clean.

# ── Stage 1: rust-builder ──────────────────────────────────────────────────────
# Compiles the soroban-xdr-decode native N-API addon.
# Kept in its own stage so Rust toolchain artefacts never bleed into the
# final image (saves ~1 GB).
FROM node:20-bookworm-slim AS rust-builder

# build-essential:  gcc / g++ / make (required by napi-build linker).
# libssl-dev:       Rust crates that use openssl-sys.
# pkg-config:       Helps Rust find system libraries.
# curl:             Used by rustup installer.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libssl-dev \
        pkg-config \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install the latest stable Rust toolchain via rustup (non-interactive).
# RUSTUP_HOME / CARGO_HOME are set so the toolchain lands in /usr/local,
# making it easy to reference from later stages if needed.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal \
    && rustup target add x86_64-unknown-linux-gnu

WORKDIR /addon

# Copy only what is needed to compile the Rust crate — leverages layer cache.
COPY native/soroban-xdr-decode/Cargo.toml  ./Cargo.toml
COPY native/soroban-xdr-decode/build.rs    ./build.rs
COPY native/soroban-xdr-decode/src        ./src
COPY native/soroban-xdr-decode/package.json ./package.json

# Install @napi-rs/cli (napi-cli) just for this stage.
RUN npm install --save-dev @napi-rs/cli@2.18.4 --ignore-scripts

# Build the release .node binary for linux/amd64.
# NODE_AUTH_TOKEN is intentionally NOT set — this is a public build.
RUN npx napi build --platform --release --target x86_64-unknown-linux-gnu

# ── Stage 2: deps ──────────────────────────────────────────────────────────────
# Install production + dev Node deps in a throw-away layer so the final image
# never carries the npm cache or build tooling.
FROM node:20-alpine AS deps

# Install libc compatibility shim needed by some native addons on Alpine.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy manifests first — Docker layer cache skips re-install when unchanged.
COPY package.json package-lock.json ./

# --ignore-scripts prevents post-install scripts from running as root.
RUN npm ci --ignore-scripts

# ── Stage 3: builder ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Bring in installed modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Copy the prebuilt native .node binary from the rust-builder stage.
# napi-rs places it at <package-root>/index.node by default.
COPY --from=rust-builder /addon/*.node ./native/soroban-xdr-decode/

# Disable Next.js telemetry during CI/CD builds.
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js static output and compile the custom WebSocket server.
RUN npm run build && \
    npx tsc --project tsconfig.server.json

# ── Stage 4: runner ────────────────────────────────────────────────────────────
# Minimal runtime image — no build tooling, no dev deps, no npm cache.
FROM node:20-alpine AS runner

# gcompat provides GNU libc compatibility shim required by the musl-based
# Alpine image to load the .so symbols from the napi .node binary when
# it was compiled against glibc (linux/amd64 gnu target).
RUN apk add --no-cache libc6-compat gcompat

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Run as an unprivileged user (defense-in-depth, satisfies most CVE scanners).
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 --ingroup nodejs nextjs

# Copy only the artefacts required at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/.next                          ./.next
COPY --from=builder --chown=nextjs:nodejs /app/.server-dist                   ./.server-dist
COPY --from=builder --chown=nextjs:nodejs /app/public                         ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json                   ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/package-lock.json              ./package-lock.json
# Native addon binary — must be at the path that xdr-binding.ts resolves.
COPY --from=builder --chown=nextjs:nodejs /app/native/soroban-xdr-decode/*.node \
                                                      ./native/soroban-xdr-decode/

# Install production-only deps (no devDependencies, no scripts).
RUN npm ci --omit=dev --ignore-scripts && \
    # Remove npm cache left by ci install to shrink the layer.
    npm cache clean --force

USER nextjs

EXPOSE 3000

# Healthcheck lets the container runtime (and compose) detect a broken app.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", ".server-dist/server.js"]
