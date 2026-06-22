import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "lib/stellar/__tests__/indexer.test.ts",
      "lib/stellar/__tests__/captive-core.test.ts",
    ],
    setupFiles: [],
  },
});
