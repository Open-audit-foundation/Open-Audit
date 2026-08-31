import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@testing-library/jest-dom/matchers": path.resolve(
        __dirname,
        "node_modules/@testing-library/jest-dom/dist/matchers.js"
      ),
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    server: {
      deps: {
        inline: [/@asamuzakjp\/css-color/, /@csstools\/css-calc/, /@testing-library\/jest-dom/],
      },
    },
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
  },
});