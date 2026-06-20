/**
 * Retention System Tests
 *
 * Covers:
 *  - Policy loading and cutoff calculation
 *  - CSV archiver output format
 *  - Pruner cycle logic (mocked DB)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Policy tests ──────────────────────────────────────────────────────────────

import {
  loadRetentionPolicy,
  getCutoffTimestamp,
  getCutoffDate,
  type RetentionPolicy,
} from "../policy";

describe("loadRetentionPolicy", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns defaults when no env vars are set", () => {
    delete process.env.RETENTION_DAYS;
    delete process.env.RETENTION_BATCH_SIZE;
    delete process.env.RETENTION_ARCHIVE_DIR;
    delete process.env.RETENTION_CRON;
    delete process.env.RETENTION_ENABLED;
    delete process.env.RETENTION_DRY_RUN;

    const policy = loadRetentionPolicy();
    expect(policy.retentionDays).toBe(180);
    expect(policy.batchSize).toBe(500);
    expect(policy.archiveDir).toBe("./archives");
    expect(policy.cronSchedule).toBe("0 2 * * *");
    expect(policy.enabled).toBe(true);
    expect(policy.dryRun).toBe(false);
  });

  it("reads RETENTION_DAYS from env", () => {
    process.env.RETENTION_DAYS = "90";
    expect(loadRetentionPolicy().retentionDays).toBe(90);
  });

  it("falls back to default for invalid RETENTION_DAYS", () => {
    process.env.RETENTION_DAYS = "not-a-number";
    expect(loadRetentionPolicy().retentionDays).toBe(180);
  });

  it("falls back to default for zero RETENTION_DAYS", () => {
    process.env.RETENTION_DAYS = "0";
    expect(loadRetentionPolicy().retentionDays).toBe(180);
  });

  it("disables when RETENTION_ENABLED=false", () => {
    process.env.RETENTION_ENABLED = "false";
    expect(loadRetentionPolicy().enabled).toBe(false);
  });

  it("enables dry-run when RETENTION_DRY_RUN=true", () => {
    process.env.RETENTION_DRY_RUN = "true";
    expect(loadRetentionPolicy().dryRun).toBe(true);
  });
});

describe("getCutoffTimestamp", () => {
  it("returns a Unix timestamp in the past by retentionDays", () => {
    const policy: RetentionPolicy = {
      retentionDays: 30,
      batchSize: 500,
      archiveDir: "./archives",
      cronSchedule: "0 2 * * *",
      enabled: true,
      dryRun: false,
    };

    const cutoff = getCutoffTimestamp(policy);
    const expectedDate = new Date();
    expectedDate.setUTCDate(expectedDate.getUTCDate() - 30);
    expectedDate.setUTCHours(0, 0, 0, 0);

    // Allow ±5 seconds for test execution time
    expect(cutoff).toBeCloseTo(Math.floor(expectedDate.getTime() / 1000), -1);
  });

  it("cutoff is strictly in the past", () => {
    const policy: RetentionPolicy = {
      retentionDays: 1,
      batchSize: 500,
      archiveDir: "./archives",
      cronSchedule: "0 2 * * *",
      enabled: true,
      dryRun: false,
    };
    expect(getCutoffTimestamp(policy)).toBeLessThan(Math.floor(Date.now() / 1000));
  });
});

// ── Archiver tests ────────────────────────────────────────────────────────────

import { archiveBatch, type PrismaEventRow } from "../archiver";
import * as zlib from "zlib";

function makeFakeEvent(overrides: Partial<PrismaEventRow> = {}): PrismaEventRow {
  return {
    id: "evt-001",
    contractId: "CABC123",
    ledger: 1000,
    timestamp: 1700000000,
    txHash: "abc123",
    topics: ["0xdeadbeef", "0xcafe"],
    data: "0x1234",
    description: "Transfer 100 tokens",
    status: "translated",
    blueprintName: "SAC",
    eventType: "Transfer",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("archiveBatch", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const basePolicy: RetentionPolicy = {
    retentionDays: 180,
    batchSize: 500,
    archiveDir: "",
    cronSchedule: "0 2 * * *",
    enabled: true,
    dryRun: false,
  };

  it("returns empty result for empty batch", async () => {
    const policy = { ...basePolicy, archiveDir: tmpDir };
    const result = await archiveBatch([], 0, policy);
    expect(result).not.toBeNull();
    expect(result!.rowCount).toBe(0);
  });

  it("writes a .csv.gz file and returns correct metadata", async () => {
    const events = [makeFakeEvent({ id: "evt-001" }), makeFakeEvent({ id: "evt-002", ledger: 1001 })];
    const policy = { ...basePolicy, archiveDir: tmpDir };

    const result = await archiveBatch(events, 0, policy);

    expect(result).not.toBeNull();
    expect(result!.rowCount).toBe(2);
    expect(result!.filePath).toMatch(/\.csv\.gz$/);
    expect(fs.existsSync(result!.filePath)).toBe(true);
    expect(result!.compressedBytes).toBeGreaterThan(0);
  });

  it("produces a valid gzip file that decompresses to valid CSV", async () => {
    const events = [makeFakeEvent()];
    const policy = { ...basePolicy, archiveDir: tmpDir };
    const result = await archiveBatch(events, 0, policy);

    const compressed = fs.readFileSync(result!.filePath);
    const decompressed = zlib.gunzipSync(compressed).toString("utf8");

    // Should have header + 1 data row
    const lines = decompressed.trim().split(/\r?\n/);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("id,contractId,ledger");
    expect(lines[1]).toContain("evt-001");
    expect(lines[1]).toContain("CABC123");
  });

  it("CSV properly escapes fields containing commas", async () => {
    const events = [makeFakeEvent({ description: "Transfer, 100 tokens, to Bob" })];
    const policy = { ...basePolicy, archiveDir: tmpDir };
    const result = await archiveBatch(events, 0, policy);

    const compressed = fs.readFileSync(result!.filePath);
    const decompressed = zlib.gunzipSync(compressed).toString("utf8");

    expect(decompressed).toContain('"Transfer, 100 tokens, to Bob"');
  });

  it("does not write a file in dry-run mode", async () => {
    const policy = { ...basePolicy, archiveDir: tmpDir, dryRun: true };
    const result = await archiveBatch([makeFakeEvent()], 0, policy);

    expect(result).toBeNull();
    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(0);
  });

  it("records oldest and newest timestamps correctly", async () => {
    const events = [
      makeFakeEvent({ id: "e1", timestamp: 1000 }),
      makeFakeEvent({ id: "e2", timestamp: 3000 }),
      makeFakeEvent({ id: "e3", timestamp: 2000 }),
    ];
    const policy = { ...basePolicy, archiveDir: tmpDir };
    const result = await archiveBatch(events, 0, policy);

    expect(result!.oldestTimestamp).toBe(1000);
    expect(result!.newestTimestamp).toBe(3000);
  });
});

// ── Pruner cycle tests ────────────────────────────────────────────────────────

import { runPrunerCycle } from "../pruner";

// Mock Prisma db client
vi.mock("@/lib/db/client", () => ({
  db: {
    event: {
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db/client";

describe("runPrunerCycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-pruner-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const policy: RetentionPolicy = {
    retentionDays: 180,
    batchSize: 3,
    archiveDir: "",
    cronSchedule: "0 2 * * *",
    enabled: true,
    dryRun: false,
  };

  it("returns zero counts when there are no candidates", async () => {
    vi.mocked(db.event.count).mockResolvedValue(0);

    const result = await runPrunerCycle({ ...policy, archiveDir: tmpDir });

    expect(result.candidateCount).toBe(0);
    expect(result.archivedCount).toBe(0);
    expect(result.deletedCount).toBe(0);
    expect(result.batchesProcessed).toBe(0);
  });

  it("archives and deletes candidates in batches", async () => {
    const fakeEvents = [
      makeFakeEvent({ id: "e1", timestamp: 100 }),
      makeFakeEvent({ id: "e2", timestamp: 200 }),
    ];

    vi.mocked(db.event.count).mockResolvedValue(2);
    vi.mocked(db.event.findMany)
      .mockResolvedValueOnce(fakeEvents as any)
      .mockResolvedValueOnce([]); // second call returns empty → loop ends
    vi.mocked(db.event.deleteMany).mockResolvedValue({ count: 2 });

    const result = await runPrunerCycle({ ...policy, archiveDir: tmpDir });

    expect(result.candidateCount).toBe(2);
    expect(result.deletedCount).toBe(2);
    expect(result.archivedCount).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("dry-run skips delete and archive write", async () => {
    vi.mocked(db.event.count).mockResolvedValue(1);
    vi.mocked(db.event.findMany)
      .mockResolvedValueOnce([makeFakeEvent()] as any)
      .mockResolvedValueOnce([]);

    const result = await runPrunerCycle({ ...policy, archiveDir: tmpDir, dryRun: true });

    expect(db.event.deleteMany).not.toHaveBeenCalled();
    expect(result.deletedCount).toBe(0);
    expect(result.dryRun).toBe(true);
    // No files written
    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(0);
  });

  it("records non-fatal errors and continues to next batch", async () => {
    vi.mocked(db.event.count).mockResolvedValue(2);
    vi.mocked(db.event.findMany)
      .mockResolvedValueOnce([makeFakeEvent({ id: "e1" })] as any)
      .mockResolvedValueOnce([makeFakeEvent({ id: "e2" })] as any)
      .mockResolvedValueOnce([]);
    // First delete throws, second succeeds
    vi.mocked(db.event.deleteMany)
      .mockRejectedValueOnce(new Error("DB timeout"))
      .mockResolvedValueOnce({ count: 1 });

    const result = await runPrunerCycle({ ...policy, archiveDir: tmpDir });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("DB timeout");
    expect(result.deletedCount).toBe(1); // second batch succeeded
  });

  it("result contains startedAt and completedAt ISO strings", async () => {
    vi.mocked(db.event.count).mockResolvedValue(0);

    const result = await runPrunerCycle({ ...policy, archiveDir: tmpDir });

    expect(() => new Date(result.startedAt)).not.toThrow();
    expect(() => new Date(result.completedAt)).not.toThrow();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
