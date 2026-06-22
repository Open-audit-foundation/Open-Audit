/**
 * lib/dag/engine.ts
 *
 * Soroban Execution DAG Reconstruction Engine.
 *
 * This module parses the DiagnosticEvent stream embedded inside
 * SorobanTransactionMeta and reconstructs the nested call stack as a typed
 * DAG (Directed Acyclic Graph).
 *
 * ## How it works
 *
 * The Soroban VM emits DiagnosticEvents in execution order:
 *
 *   fn_call  contract=A fn=transfer   ← push frame A onto the stack
 *     fn_call  contract=B fn=approve   ← push frame B (child of A)
 *     fn_return fn=approve cpuInsns=50 ← pop B, record gas
 *   fn_return fn=transfer cpuInsns=120 ← pop A, record gas (includes B's 50)
 *
 * The engine maintains a call stack.  Each `fn_call` creates a new DagNode
 * and pushes it; each `fn_return` / `fn_error` pops the top frame, records
 * the gas counters, and computes self-gas = total − Σ(children's total).
 *
 * ## Cycle prevention
 *
 * The Soroban VM enforces reentrancy guards (a contract cannot call itself
 * within the same transaction), so the call tree is guaranteed to be acyclic.
 * The engine adds a depth limit (MAX_DEPTH = 64) as a defensive backstop
 * against malformed event streams.
 *
 * ## Gas attribution
 *
 * Soroban reports cpuInsns / memBytes *cumulatively* per frame (i.e. the
 * number includes all nested calls).  This engine computes self-gas by
 * subtracting children's totals from the parent's total after all children
 * have resolved.
 */

import { xdr, StrKey } from "stellar-sdk";
import type {
  DiagnosticEventKind,
  FnCallEvent,
  FnReturnEvent,
  FnErrorEvent,
  LogEvent,
  DagNode,
  DagNodeId,
  ExecutionDag,
} from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_DEPTH = 64;

// ── XDR decoding helpers ──────────────────────────────────────────────────────

/**
 * Encode a raw XDR value to a `0x`-prefixed hex string.
 * Returns an empty string for null/undefined inputs.
 */
function toHex(xdrVal: { toXDR(enc: "hex"): string } | null | undefined): string {
  if (!xdrVal) return "";
  try {
    return `0x${xdrVal.toXDR("hex")}`;
  } catch {
    return "";
  }
}

/**
 * Decode a Soroban DiagnosticEvent XDR object into one of our plain-TS
 * DiagnosticEventKind variants.  Returns null for event types we don't
 * recognise (future-proofing against new diagnostic kinds).
 */
function decodeDiagnosticEvent(
  diagEvent: xdr.DiagnosticEvent
): DiagnosticEventKind | null {
  try {
    const event = diagEvent.event();
    const body = event.body();

    // Only v0 body is defined in the current XDR schema.
    const v0 = body.v0();
    const topics: xdr.ScVal[] = v0.topics() as xdr.ScVal[];
    const data: xdr.ScVal = v0.data() as xdr.ScVal;

    if (topics.length === 0) return null;

    // Topic[0] is always an ScVal::Symbol discriminating the event type.
    const kind = topics[0].value()?.toString() ?? "";

    switch (kind) {
      case "fn_call": {
        // fn_call: topics[0]=Symbol("fn_call"), topics[1]=Bytes(contractId),
        //          topics[2]=Symbol(fnName)
        //          data = ScVec of args
        const rawContractId = topics[1]?.value();
        let contractId = "unknown";
        if (rawContractId && Buffer.isBuffer(rawContractId)) {
          try {
            contractId = StrKey.encodeContract(rawContractId);
          } catch {
            contractId = rawContractId.toString("hex");
          }
        }

        const fnName = topics[2]?.value()?.toString() ?? "unknown";

        // Arguments are carried in the data field as a ScVec.
        const args: string[] = [];
        try {
          const vec = data.vec();
          if (vec) {
            for (const arg of vec) {
              args.push(toHex(arg));
            }
          }
        } catch {
          // data may not be a vec (e.g. void) — treat as no args.
        }

        return {
          kind: "fn_call",
          contractId,
          fnName,
          args,
        } satisfies FnCallEvent;
      }

      case "fn_return": {
        // fn_return: topics[0]=Symbol("fn_return"), topics[1]=Symbol(fnName)
        //            data = ScVec[returnValue, cpuInsns, memBytes]
        const fnName = topics[1]?.value()?.toString() ?? "unknown";

        let returnValue = "";
        let cpuInsns = 0n;
        let memBytes = 0n;

        try {
          const vec = data.vec();
          if (vec && vec.length >= 1) {
            returnValue = toHex(vec[0]);
          }
          if (vec && vec.length >= 2) {
            // cpuInsns is a U64 in XDR
            const insnsVal = vec[1];
            cpuInsns = BigInt(
              insnsVal.u64()?.toString() ??
              insnsVal.i64()?.toString() ??
              0
            );
          }
          if (vec && vec.length >= 3) {
            const memVal = vec[2];
            memBytes = BigInt(
              memVal.u64()?.toString() ??
              memVal.i64()?.toString() ??
              0
            );
          }
        } catch {
          // Partial data — use zero gas (won't crash reconstruction).
        }

        return {
          kind: "fn_return",
          fnName,
          returnValue,
          cpuInsns,
          memBytes,
        } satisfies FnReturnEvent;
      }

      case "fn_error": {
        const fnName = topics[1]?.value()?.toString() ?? "unknown";
        return {
          kind: "fn_error",
          fnName,
          errorVal: toHex(data),
        } satisfies FnErrorEvent;
      }

      case "log": {
        let message = "";
        try {
          // log messages are ScVal::String or ScVal::Symbol in data
          message =
            data.str()?.toString() ??
            data.sym()?.toString() ??
            data.value()?.toString() ??
            "";
        } catch {
          message = toHex(data);
        }
        return { kind: "log", message } satisfies LogEvent;
      }

      default:
        return null;
    }
  } catch {
    // Malformed event — skip silently.
    return null;
  }
}

// ── Engine state ──────────────────────────────────────────────────────────────

/**
 * DagBuilder accumulates fn_call/fn_return/fn_error events for a single
 * transaction and produces a complete ExecutionDag.
 *
 * Create one instance per transaction, feed it events in order, then call
 * `build()` to get the finished DAG.
 */
export class DagBuilder {
  private readonly txHash: string;
  private readonly ledger: number;
  private readonly timestamp: number;

  /** All nodes built so far. */
  private nodes: Map<DagNodeId, DagNode> = new Map();

  /** Per-builder node counter — ensures stable IDs isolated to this tx. */
  private nodeCounter = 0;

  private freshId(): DagNodeId {
    return `node-${this.nodeCounter++}`;
  }

  /**
   * Active call stack.  The top element is the currently executing frame.
   * Invariant: stack[i].depth === i.
   */
  private stack: DagNodeId[] = [];

  constructor(txHash: string, ledger: number, timestamp: number) {
    this.txHash = txHash;
    this.ledger = ledger;
    this.timestamp = timestamp;
  }

  // ── Feed ──────────────────────────────────────────────────────────────────

  /**
   * Process a single decoded DiagnosticEvent.
   * Events must be fed in the exact order they appear in the transaction meta.
   */
  feedEvent(event: DiagnosticEventKind): void {
    switch (event.kind) {
      case "fn_call":
        this.handleFnCall(event);
        break;
      case "fn_return":
        this.handleFnReturn(event);
        break;
      case "fn_error":
        this.handleFnError(event);
        break;
      case "log":
        this.handleLog(event);
        break;
    }
  }

  // ── fn_call ───────────────────────────────────────────────────────────────

  private handleFnCall(event: FnCallEvent): void {
    const depth = this.stack.length;

    // Defensive depth cap — malformed streams should not OOM the process.
    if (depth >= MAX_DEPTH) {
      console.warn(
        `[dag-engine] MAX_DEPTH (${MAX_DEPTH}) reached for tx ${this.txHash}; ignoring fn_call.`
      );
      return;
    }

    const parentId: DagNodeId | null =
      this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;

    const id = this.freshId();
    const node: DagNode = {
      id,
      contractId: event.contractId,
      fnName: event.fnName,
      args: event.args,
      returnValue: "",
      status: "pending",
      selfCpuInsns: 0n,
      totalCpuInsns: 0n,
      selfMemBytes: 0n,
      totalMemBytes: 0n,
      parentId,
      childIds: [],
      depth,
      logs: [],
    };

    this.nodes.set(id, node);
    this.stack.push(id);

    // Register this node as a child of the parent.
    if (parentId !== null) {
      const parent = this.nodes.get(parentId)!;
      parent.childIds.push(id);
    }
  }

  // ── fn_return ─────────────────────────────────────────────────────────────

  private handleFnReturn(event: FnReturnEvent): void {
    const topId = this.stack.pop();
    if (topId === undefined) return; // Unmatched return — skip.

    const node = this.nodes.get(topId)!;

    // Sanity check: function name should match (may differ if stream truncated).
    // We proceed regardless to avoid losing partial data.

    node.returnValue = event.returnValue;
    node.status = "success";
    node.totalCpuInsns = event.cpuInsns;
    node.totalMemBytes = event.memBytes;

    // Self-gas = frame total − sum of all direct children's totals.
    // (Children's totals are already finalised because they were popped earlier.)
    let childCpuSum = 0n;
    let childMemSum = 0n;
    for (const childId of node.childIds) {
      const child = this.nodes.get(childId)!;
      childCpuSum += child.totalCpuInsns;
      childMemSum += child.totalMemBytes;
    }
    node.selfCpuInsns = node.totalCpuInsns - childCpuSum;
    node.selfMemBytes = node.totalMemBytes - childMemSum;

    // Guard against negative self-gas (can happen with partial streams).
    if (node.selfCpuInsns < 0n) node.selfCpuInsns = 0n;
    if (node.selfMemBytes < 0n) node.selfMemBytes = 0n;
  }

  // ── fn_error ──────────────────────────────────────────────────────────────

  private handleFnError(event: FnErrorEvent): void {
    const topId = this.stack.pop();
    if (topId === undefined) return;

    const node = this.nodes.get(topId)!;
    node.status = "error";
    node.errorVal = event.errorVal;
    // Gas counters stay zero for error frames (no cpuInsns in fn_error events).
  }

  // ── log ───────────────────────────────────────────────────────────────────

  private handleLog(event: LogEvent): void {
    // Attach log to the currently active frame.
    if (this.stack.length === 0) return;
    const topId = this.stack[this.stack.length - 1];
    this.nodes.get(topId)?.logs.push(event.message);
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  /**
   * Finalise and return the ExecutionDag.
   *
   * Any frames still on the stack are still "pending" — this happens when the
   * event stream was truncated or the transaction failed mid-execution.
   */
  build(): ExecutionDag {
    // The root node is the first node ever pushed (depth === 0, no parent).
    let rootId: DagNodeId | null = null;
    for (const [id, node] of this.nodes) {
      if (node.parentId === null) {
        rootId = id;
        break;
      }
    }

    // Compute totals for the whole transaction.
    let totalCpuInsns = 0n;
    let totalMemBytes = 0n;
    if (rootId !== null) {
      const root = this.nodes.get(rootId)!;
      totalCpuInsns = root.totalCpuInsns;
      totalMemBytes = root.totalMemBytes;
    }

    const isComplete = this.stack.length === 0;

    return {
      txHash: this.txHash,
      ledger: this.ledger,
      timestamp: this.timestamp,
      nodes: this.nodes,
      rootId,
      totalCpuInsns,
      totalMemBytes,
      isComplete,
    };
  }
}

// ── Public entry-point: parse from raw XDR ───────────────────────────────────

/**
 * Reconstruct the execution DAG from raw `result_meta_xdr` (base64) as
 * returned by the Horizon transaction stream or `getTransaction` RPC.
 *
 * Returns `null` if the transaction has no Soroban metadata (i.e. it is a
 * classic Stellar payment, not a Soroban invocation).
 *
 * All errors during XDR decoding are caught and logged; they never propagate
 * to the caller — a partial DAG is returned instead.
 */
export function reconstructDagFromMetaXdr(
  resultMetaXdr: string,
  txHash: string,
  ledger: number,
  timestamp: number
): ExecutionDag | null {
  let diagnosticEvents: xdr.DiagnosticEvent[] = [];

  try {
    const meta = xdr.TransactionMeta.fromXDR(resultMetaXdr, "base64");
    const v = meta.switch();

    // v3 and v4 both carry SorobanTransactionMeta.
    if (v.value === xdr.TransactionMeta.v3().switch().value) {
      const soroban = meta.v3().sorobanMeta();
      if (!soroban) return null;
      diagnosticEvents = (soroban.diagnosticEvents?.() ?? []) as xdr.DiagnosticEvent[];
    } else if (v.value === 4) {
      // @ts-expect-error — v4 may not be in all stellar-sdk typings yet.
      const soroban = meta.v4()?.sorobanMeta?.();
      if (!soroban) return null;
      diagnosticEvents = (soroban.diagnosticEvents?.() ?? []) as xdr.DiagnosticEvent[];
    } else {
      // v1/v2 — no Soroban metadata.
      return null;
    }
  } catch (err) {
    console.warn(`[dag-engine] Failed to decode TransactionMeta for ${txHash}:`, err);
    return null;
  }

  if (diagnosticEvents.length === 0) return null;

  const builder = new DagBuilder(txHash, ledger, timestamp);

  for (const diagEvent of diagnosticEvents) {
    const decoded = decodeDiagnosticEvent(diagEvent);
    if (decoded !== null) {
      builder.feedEvent(decoded);
    }
  }

  return builder.build();
}

/**
 * Reconstruct the execution DAG from a pre-parsed array of
 * DiagnosticEvent XDR objects (e.g. from `getTransaction` RPC response).
 */
export function reconstructDagFromDiagnosticEvents(
  events: xdr.DiagnosticEvent[],
  txHash: string,
  ledger: number,
  timestamp: number
): ExecutionDag {
  const builder = new DagBuilder(txHash, ledger, timestamp);

  for (const diagEvent of events) {
    const decoded = decodeDiagnosticEvent(diagEvent);
    if (decoded !== null) {
      builder.feedEvent(decoded);
    }
  }

  return builder.build();
}
