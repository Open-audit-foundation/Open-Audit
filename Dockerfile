# syntax=docker/dockerfile:1

# ── Stage 1: deps ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

# ── Stage 2: builder ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the Next.js app
RUN npm run build

# Compile the custom server (outputs to .server-dist/)
RUN npx tsc --project tsconfig.server.json

# ── Stage 3: runner ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Only the files needed at runtime
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/.server-dist ./.server-dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./

# Production deps only
RUN npm ci --omit=dev --ignore-scripts

EXPOSE 3000

# The compiled server handles both HTTP/Next.js and the WebSocket indexer
CMD ["node", ".server-dist/server.js"]
