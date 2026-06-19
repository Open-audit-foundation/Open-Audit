import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Mock ioredis so tests don't require a Redis server
      ioredis: path.resolve(__dirname, "__mocks__/ioredis.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        inline: ["next"],
      },
    },
  },
});
