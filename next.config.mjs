/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Keeps Node.js-only packages out of the browser bundle.
  // @sentry/node uses diagnostics_channel and other Node.js built-ins that
  // do not exist in a browser environment. Without this, Next.js tries to
  // bundle it when a client component imports registry.ts -> lib/telemetry/index.ts,
  // causing "Module not found: Can't resolve 'diagnostics_channel'".
  serverExternalPackages: [
    "@sentry/node",
    "@sentry/node-core",
    "pino",
    "ioredis",
    "bull",
  ],

  // Enables Dockerfile.web standalone output tracing.
  output: "standalone",

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://* https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://horizon.stellar.org https://mainnet.stellar.validationcloud.io; img-src 'self' data:; font-src 'self' data:;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
