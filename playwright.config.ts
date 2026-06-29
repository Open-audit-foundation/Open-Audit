import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration for Open-Audit
 *
 * Tests the core data flow: Soroban RPC event → WebSocket → Translated text in DOM
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html"], ["github"]] : "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx ts-node --project tsconfig.server.json server.ts",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      E2E_TEST_MODE: "true",
      NEXT_PUBLIC_NETWORK: "testnet",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://openaudit:openaudit@localhost:5432/openaudit",
    },
  },
});
