import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
    alias: {
      // ioredis is a server-only dependency; stub it in tests
      ioredis: new URL("./lib/__mocks__/ioredis.ts", import.meta.url).pathname,
    },
  },
});
