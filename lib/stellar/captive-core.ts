import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { promises as fs } from "fs";
import net, { type Socket } from "net";
import os from "os";
import path from "path";
import { StrKey, xdr } from "stellar-sdk";
import type { RawEvent } from "../translator/types";
import { StellarNetworkException, XdrParsingException } from "../errors";
import { captureExceptionSync } from "../telemetry/index";
import type { IngestionStateSnapshot, IngestionStateStore } from "./ingestion-state";

export interface CaptiveCoreHistoryArchive {
  get: string;
  put?: string;
  mkdir?: string;
}

export interface CaptiveCoreTransportTcp {
  type: "tcp";
  host?: string;
  port?: number;
}

export interface CaptiveCoreTransportStdio {
  type: "stdio";
}

export type CaptiveCoreTransport = CaptiveCoreTransportTcp | CaptiveCoreTransportStdio;

export interface CaptiveCoreDecodedLedger {
  sequence: number;
  rawEvents: RawEvent[];
  rawXdr: string;
  receivedAt: string;
  structuredMeta?: unknown;
}

export interface CaptiveCoreDecoderContext {
  fallbackSequence: number;
  contractIds?: string[];
}

export interface CaptiveCoreTomlOptions {
  networkPassphrase: string;
  historyArchives: Record<string, string | CaptiveCoreHistoryArchive>;
  databaseUrl?: string;
  bucketDirPath?: string;
  httpPort?: number;
  publicHttpPort?: boolean;
  runStandalone?: boolean;
  nodeIsValidator?: boolean;
}

export interface CaptiveCoreLaunchContext {
  configPath: string;
  resumeFromLedger: number;
  transport: CaptiveCoreTransport;
}

export interface CaptiveCoreSupervisorOptions {
  binaryPath: string;
  networkPassphrase: string;
  historyArchives: Record<string, string | CaptiveCoreHistoryArchive>;
  stateStore?: IngestionStateStore;
  workingDirectory?: string;
  startLedger?: number;
  contractIds?: string[];
  restartDelayMs?: number;
  maxRestartAttempts?: number;
  heartbeatTimeoutMs?: number;
  startupTimeoutMs?: number;
  transport?: CaptiveCoreTransport;
  spawnOptions?: SpawnOptions;
  argsBuilder?: (context: CaptiveCoreLaunchContext) => string[];
  decoder?: (payload: Buffer, context: CaptiveCoreDecoderContext) => CaptiveCoreDecodedLedger;
  onLedger?: (ledger: CaptiveCoreDecodedLedger) => void | Promise<void>;
  onEvent?: (event: RawEvent) => void | Promise<void>;
  onError?: (error: Error) => void;
  onExhausted?: (error: Error) => void;
  spawnFn?: (
    command: string,
    args?: ReadonlyArray<string>,
    options?: SpawnOptions
  ) => ChildProcess;
}

export interface CaptiveCoreControls {
  stop: () => Promise<void>;
  getStatus: () => {
    mode: "starting" | "running" | "stopped" | "failed";
    restartAttempts: number;
    lastLedger: number;
  };
}

export class LengthPrefixedMessageDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];

    while (this.buffer.length >= 4) {
      const frameLength = this.buffer.readUInt32BE(0);
      if (this.buffer.length < frameLength + 4) {
        break;
      }

      frames.push(this.buffer.subarray(4, frameLength + 4));
      this.buffer = this.buffer.subarray(frameLength + 4);
    }

    return frames;
  }
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function renderCaptiveCoreToml(options: CaptiveCoreTomlOptions): string {
  const lines = [
    `NETWORK_PASSPHRASE="${escapeTomlString(options.networkPassphrase)}"`,
    `DATABASE="${escapeTomlString(options.databaseUrl ?? "sqlite3://:memory:")}"`,
    `BUCKET_DIR_PATH="${escapeTomlString(options.bucketDirPath ?? path.join(os.tmpdir(), "open-audit-buckets"))}"`,
    `HTTP_PORT=${options.httpPort ?? 11626}`,
    `PUBLIC_HTTP_PORT=${options.publicHttpPort ?? false}`,
    `RUN_STANDALONE=${options.runStandalone ?? true}`,
    `NODE_IS_VALIDATOR=${options.nodeIsValidator ?? false}`,
  ];

  for (const [name, archive] of Object.entries(options.historyArchives)) {
    const resolved =
      typeof archive === "string"
        ? { get: archive }
        : archive;
    lines.push("");
    lines.push(`[HISTORY.${JSON.stringify(name)}]`);
    lines.push(`get="${escapeTomlString(resolved.get)}"`);
    if (resolved.put) {
      lines.push(`put="${escapeTomlString(resolved.put)}"`);
    }
    if (resolved.mkdir) {
      lines.push(`mkdir="${escapeTomlString(resolved.mkdir)}"`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function defaultArgsBuilder(context: CaptiveCoreLaunchContext): string[] {
  const args = ["run", "--conf", context.configPath];
  if (context.resumeFromLedger > 0) {
    args.push("--start-at-ledger", String(context.resumeFromLedger));
  }
  return args;
}

function inferLedgerSequence(node: unknown, visited = new Set<unknown>(), depth = 0): number | undefined {
  if (depth > 6 || node === null || node === undefined) {
    return undefined;
  }

  if (typeof node === "number" && Number.isFinite(node) && node > 0) {
    return node;
  }

  if (typeof node !== "object" && typeof node !== "function") {
    return undefined;
  }

  if (visited.has(node)) {
    return undefined;
  }
  visited.add(node);

  const candidateMethods = ["ledgerSeq", "ledgerSequence", "sequence", "seqNum"];
  for (const methodName of candidateMethods) {
    const maybeMethod = (node as Record<string, unknown>)[methodName];
    if (typeof maybeMethod === "function") {
      try {
        const result = (maybeMethod as () => unknown)();
        const inferred = inferLedgerSequence(result, visited, depth + 1);
        if (inferred !== undefined) {
          return inferred;
        }
      } catch {
        // Ignore best-effort probe failures.
      }
    }
  }

  const candidateBranches = ["value", "ledgerHeader", "header", "headerScpValue", "v0", "v1", "v2"];
  for (const branch of candidateBranches) {
    const maybeBranch = (node as Record<string, unknown>)[branch];
    if (typeof maybeBranch === "function") {
      try {
        const inferred = inferLedgerSequence((maybeBranch as () => unknown)(), visited, depth + 1);
        if (inferred !== undefined) {
          return inferred;
        }
      } catch {
        // Ignore.
      }
    }
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    const inferred = inferLedgerSequence(value, visited, depth + 1);
    if (inferred !== undefined) {
      return inferred;
    }
  }

  return undefined;
}

function collectContractEvents(
  node: unknown,
  sequence: number,
  contractIds?: string[],
  seen = new Set<string>(),
  visited = new Set<unknown>(),
  depth = 0
): RawEvent[] {
  if (depth > 8 || node === null || node === undefined) {
    return [];
  }

  if (typeof node !== "object" && typeof node !== "function") {
    return [];
  }

  if (visited.has(node)) {
    return [];
  }
  visited.add(node);

  const events: RawEvent[] = [];
  const maybeRecord = node as {
    contractId?: () => unknown;
    body?: () => unknown;
    toXDR?: (encoding: "hex" | "base64") => string;
  };

  if (typeof maybeRecord.contractId === "function" && typeof maybeRecord.body === "function") {
    try {
      const contractIdValue = maybeRecord.contractId();
      const contractId = contractIdValue ? StrKey.encodeContract(contractIdValue as Parameters<typeof StrKey.encodeContract>[0]) : "unknown";
      if (!contractIds || contractIds.length === 0 || contractIds.includes(contractId)) {
        const body = maybeRecord.body() as {
          v0?: () => { topics: () => Array<{ toXDR: (encoding: "hex") => string }>; data: () => { toXDR: (encoding: "hex") => string } };
        };
        const v0 = body?.v0?.();
        if (v0) {
          const eventKey = typeof maybeRecord.toXDR === "function" ? maybeRecord.toXDR("hex") : `${contractId}-${sequence}-${seen.size}`;
          if (!seen.has(eventKey)) {
            seen.add(eventKey);
            events.push({
              id: `${sequence}-${seen.size - 1}`,
              contractId,
              topics: v0.topics().map((topic) => `0x${topic.toXDR("hex")}`),
              data: `0x${v0.data().toXDR("hex")}`,
              ledger: sequence,
              timestamp: Math.floor(Date.now() / 1000),
              txHash: "",
            });
          }
        }
      }
    } catch {
      // Ignore objects that only partially resemble contract events.
    }
  }

  const candidateBranches = [
    "value",
    "txProcessing",
    "txApplyProcessing",
    "sorobanMeta",
    "events",
    "operations",
    "changes",
    "v0",
    "v1",
    "v2",
    "v3",
    "v4",
  ];

  for (const branch of candidateBranches) {
    const maybeBranch = (node as Record<string, unknown>)[branch];
    if (typeof maybeBranch === "function") {
      try {
        const branchValue = (maybeBranch as () => unknown)();
        events.push(...collectContractEvents(branchValue, sequence, contractIds, seen, visited, depth + 1));
      } catch {
        // Ignore traversal errors.
      }
    }
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      events.push(...collectContractEvents(item, sequence, contractIds, seen, visited, depth + 1));
    }
    return events;
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    events.push(...collectContractEvents(value, sequence, contractIds, seen, visited, depth + 1));
  }

  return events;
}

export function decodeLedgerCloseMetaFrame(
  payload: Buffer,
  context: CaptiveCoreDecoderContext
): CaptiveCoreDecodedLedger {
  const factory = (xdr as unknown as Record<string, { fromXDR?: (input: Buffer) => unknown }>).LedgerCloseMeta;
  if (!factory?.fromXDR) {
    throw new XdrParsingException("stellar-sdk does not expose LedgerCloseMeta decoding", {
      ledgerSequence: context.fallbackSequence,
      operation: "decodeLedgerCloseMetaFrame",
    });
  }

  const structuredMeta = factory.fromXDR(payload);
  const sequence = inferLedgerSequence(structuredMeta) ?? context.fallbackSequence;

  return {
    sequence,
    rawEvents: collectContractEvents(structuredMeta, sequence, context.contractIds),
    rawXdr: payload.toString("base64"),
    receivedAt: new Date().toISOString(),
    structuredMeta,
  };
}

export async function startCaptiveCoreIndexer(
  options: CaptiveCoreSupervisorOptions
): Promise<CaptiveCoreControls> {
  const {
    binaryPath,
    networkPassphrase,
    historyArchives,
    stateStore,
    workingDirectory = path.join(os.tmpdir(), "open-audit-captive-core"),
    startLedger = 0,
    contractIds,
    restartDelayMs = 5000,
    maxRestartAttempts = 2,
    heartbeatTimeoutMs = 30000,
    startupTimeoutMs = 10000,
    transport = { type: "stdio" },
    spawnOptions,
    argsBuilder = defaultArgsBuilder,
    decoder = decodeLedgerCloseMetaFrame,
    onLedger,
    onEvent,
    onError,
    onExhausted,
    spawnFn = spawn,
  } = options;

  await fs.mkdir(workingDirectory, { recursive: true });

  let currentChild: ChildProcess | null = null;
  let currentSocket: Socket | null = null;
  let currentServer: net.Server | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let startupTimer: NodeJS.Timeout | null = null;
  let restartAttempts = 0;
  let lastFrameAt = Date.now();
  let lastLedger = startLedger;
  let status: "starting" | "running" | "stopped" | "failed" = "starting";
  let stopping = false;

  const currentSnapshot = async (): Promise<IngestionStateSnapshot> => {
    const persisted = await stateStore?.load();
    return {
      lastLedger: lastLedger || persisted?.lastLedger || startLedger,
      pagingToken: persisted?.pagingToken,
      updatedAt: new Date().toISOString(),
      source: "captive-core",
    };
  };

  const stopTimers = (): void => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (startupTimer) clearTimeout(startupTimer);
    heartbeatTimer = null;
    startupTimer = null;
  };

  const cleanupTransport = async (): Promise<void> => {
    stopTimers();

    if (currentSocket) {
      currentSocket.removeAllListeners();
      currentSocket.destroy();
      currentSocket = null;
    }

    if (currentServer) {
      await new Promise<void>((resolve) => currentServer!.close(() => resolve()));
      currentServer = null;
    }
  };

  const fail = async (error: Error): Promise<void> => {
    if (stopping) {
      return;
    }

    status = "failed";
    captureExceptionSync(error, { context: { operation: "captiveCoreSupervisor" } });
    onError?.(error);

    if (stateStore) {
      const snapshot = await currentSnapshot();
      await stateStore.archive(snapshot, error.message);
    }

    await cleanupTransport();

    if (currentChild) {
      currentChild.removeAllListeners();
      currentChild.kill("SIGTERM");
      currentChild = null;
    }

    if (restartAttempts < maxRestartAttempts) {
      restartAttempts += 1;
      console.warn(
        `[captive-core] Restarting after failure (${restartAttempts}/${maxRestartAttempts}): ${error.message}`
      );
      setTimeout(() => {
        void launch();
      }, restartDelayMs);
      return;
    }

    onExhausted?.(error);
  };

  const handleFrame = async (payload: Buffer): Promise<void> => {
    lastFrameAt = Date.now();
    const decoded = decoder(payload, {
      fallbackSequence: Math.max(lastLedger + 1, startLedger),
      contractIds,
    });

    status = "running";
    restartAttempts = 0;
    lastLedger = decoded.sequence;

    console.log(
      `[captive-core] Ledger ${decoded.sequence} received (${decoded.rawEvents.length} contract events)`
    );

    await onLedger?.(decoded);

    for (const event of decoded.rawEvents) {
      await onEvent?.(event);
    }

    await stateStore?.save({
      lastLedger: decoded.sequence,
      updatedAt: decoded.receivedAt,
      source: "captive-core",
    });
  };

  const attachFrameStream = (stream: NodeJS.ReadableStream): void => {
    const decoderState = new LengthPrefixedMessageDecoder();

    stream.on("data", (chunk: Buffer) => {
      const frames = decoderState.push(Buffer.from(chunk));
      for (const frame of frames) {
        void handleFrame(frame).catch((error) => {
          const wrapped =
            error instanceof Error
              ? error
              : new XdrParsingException("Failed to handle Captive Core frame", {
                  ledgerSequence: lastLedger,
                  operation: "handleCaptiveCoreFrame",
                }, error);
          void fail(wrapped);
        });
      }
    });

    stream.on("error", (error) => {
      void fail(
        new StellarNetworkException(
          error instanceof Error ? error.message : "Captive Core stream failed",
          { ledgerSequence: lastLedger, operation: "captiveCoreStream" },
          { retriable: true, cause: error }
        )
      );
    });
  };

  const createTcpServer = async (): Promise<CaptiveCoreTransportTcp> => {
    const host = transport.type === "tcp" ? transport.host ?? "127.0.0.1" : "127.0.0.1";
    const port = transport.type === "tcp" ? transport.port ?? 0 : 0;
    currentServer = net.createServer((socket) => {
      console.log("[captive-core] Captive Core connected to framed TCP stream");
      currentSocket = socket;
      attachFrameStream(socket);
    });

    await new Promise<void>((resolve, reject) => {
      currentServer!.once("error", reject);
      currentServer!.listen(port, host, () => resolve());
    });

    const address = currentServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to determine Captive Core TCP listen address");
    }

    return {
      type: "tcp",
      host: address.address,
      port: address.port,
    };
  };

  const launch = async (): Promise<void> => {
    status = "starting";
    const savedState = await stateStore?.load();
    lastLedger = Math.max(lastLedger, savedState?.lastLedger ?? startLedger);
    const resumeFromLedger = Math.max(1, (savedState?.lastLedger ?? lastLedger ?? startLedger) + 1);

    const transportForLaunch = transport.type === "tcp" ? await createTcpServer() : transport;
    const configPath = path.join(workingDirectory, "stellar-core.cfg");
    const toml = renderCaptiveCoreToml({
      networkPassphrase,
      historyArchives,
      bucketDirPath: path.join(workingDirectory, "buckets"),
    });
    await fs.writeFile(configPath, toml, "utf8");

    const args = argsBuilder({
      configPath,
      resumeFromLedger,
      transport: transportForLaunch,
    });

    console.log(`[captive-core] Launching ${binaryPath} ${args.join(" ")}`);
    currentChild = spawnFn(binaryPath, args, {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions,
    });

    currentChild.stderr?.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message.length > 0) {
        console.log(`[captive-core] ${message}`);
      }
    });

    currentChild.once("error", (error) => {
      void fail(
        new StellarNetworkException(error.message, {
          ledgerSequence: lastLedger,
          operation: "launchCaptiveCore",
        }, { retriable: true, cause: error })
      );
    });

    currentChild.once("exit", (code, signal) => {
      if (stopping) {
        return;
      }
      void fail(
        new StellarNetworkException(
          `Captive Core exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
          {
            ledgerSequence: lastLedger,
            operation: "captiverCoreExit",
          },
          { retriable: true }
        )
      );
    });

    if (transportForLaunch.type === "stdio" && currentChild.stdout) {
      attachFrameStream(currentChild.stdout);
    }

    startupTimer = setTimeout(() => {
      if (status === "starting") {
        void fail(
          new StellarNetworkException("Captive Core startup timed out", {
            ledgerSequence: lastLedger,
            operation: "captiverCoreStartup",
          }, { retriable: true })
        );
      }
    }, startupTimeoutMs);

    heartbeatTimer = setInterval(() => {
      if (status === "running" && Date.now() - lastFrameAt > heartbeatTimeoutMs) {
        void fail(
          new StellarNetworkException("Captive Core heartbeat timeout", {
            ledgerSequence: lastLedger,
            operation: "captiverCoreHeartbeat",
          }, { retriable: true })
        );
      }
    }, Math.max(1000, Math.floor(heartbeatTimeoutMs / 2)));
  };

  await launch();

  return {
    stop: async () => {
      stopping = true;
      status = "stopped";
      stopTimers();
      await cleanupTransport();
      if (currentChild) {
        currentChild.kill("SIGTERM");
        currentChild = null;
      }
    },
    getStatus: () => ({
      mode: status,
      restartAttempts,
      lastLedger,
    }),
  };
}
