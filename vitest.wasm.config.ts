import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Node environment is required: worker_threads + WebAssembly sandbox tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["lib/wasm-sandbox/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
