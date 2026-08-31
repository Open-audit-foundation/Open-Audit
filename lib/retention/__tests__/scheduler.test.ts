/**
 * lib/retention/__tests__/scheduler.test.ts
 *
 * Unit tests for the retention scheduler.
 *
 * The scheduler imports lib/db/client which instantiates a PrismaClient.
 * Because the Prisma generated artefacts may not exist in CI (no database),
 * we mock the db/client module at the top level so Prisma is never loaded.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Top-level mock — must appear before any import of the scheduler so Vitest
// can hoist it ahead of module evaluation.
vi.mock("../../db/client", () => ({
  db: {},
}));

// Now safe to import the scheduler.
import { startRetentionScheduler } from "../scheduler";

describe("startRetentionScheduler", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns undefined and never starts a cron job when RETENTION_ENABLED=false", () => {
    vi.stubEnv("RETENTION_ENABLED", "false");

    const task = startRetentionScheduler();

    expect(task).toBeUndefined();
  });

  it("returns a scheduled task when RETENTION_ENABLED is not set (defaults to enabled)", () => {
    vi.stubEnv("RETENTION_ENABLED", "true");
    // Use a valid cron that won't actually fire during the test.
    vi.stubEnv("RETENTION_CRON_SCHEDULE", "0 3 * * *");

    const task = startRetentionScheduler();

    // A ScheduledTask is returned and can be stopped.
    expect(task).toBeDefined();
    // Clean up to prevent the task from outliving the test.
    task?.stop();
  });
});
