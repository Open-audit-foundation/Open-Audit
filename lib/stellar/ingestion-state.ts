import { promises as fs } from "fs";
import path from "path";

export type IngestionSource = "rpc" | "horizon" | "captive-core" | "fallback";

export interface IngestionStateSnapshot {
  lastLedger: number;
  pagingToken?: string;
  updatedAt: string;
  source?: IngestionSource;
}

export interface IngestionStateStore {
  load: () => Promise<IngestionStateSnapshot | null>;
  save: (snapshot: IngestionStateSnapshot) => Promise<void>;
  archive: (snapshot: IngestionStateSnapshot, reason: string) => Promise<void>;
}

function sanitizeArchiveReason(reason: string): string {
  return reason.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "unknown";
}

export function createMemoryIngestionStateStore(
  initialState: IngestionStateSnapshot | null = null
): IngestionStateStore {
  let state = initialState ? { ...initialState } : null;
  const archiveHistory: Array<{ snapshot: IngestionStateSnapshot; reason: string }> = [];

  return {
    async load() {
      return state ? { ...state } : null;
    },
    async save(snapshot) {
      state = { ...snapshot };
    },
    async archive(snapshot, reason) {
      archiveHistory.push({
        snapshot: { ...snapshot },
        reason,
      });
    },
  };
}

export function createFileIngestionStateStore(filePath: string): IngestionStateStore {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const directory = path.dirname(resolvedPath);
  const archiveDirectory = path.join(directory, "archive");

  async function ensureDirectories(): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
    await fs.mkdir(archiveDirectory, { recursive: true });
  }

  return {
    async load() {
      try {
        const raw = await fs.readFile(resolvedPath, "utf8");
        return JSON.parse(raw) as IngestionStateSnapshot;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async save(snapshot) {
      await ensureDirectories();
      const tempPath = `${resolvedPath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(snapshot, null, 2), "utf8");
      await fs.rename(tempPath, resolvedPath);
    },
    async archive(snapshot, reason) {
      await ensureDirectories();
      const archivePath = path.join(
        archiveDirectory,
        `${new Date().toISOString().replace(/[:.]/g, "-")}-${sanitizeArchiveReason(reason)}.json`
      );
      await fs.writeFile(archivePath, JSON.stringify(snapshot, null, 2), "utf8");
    },
  };
}
