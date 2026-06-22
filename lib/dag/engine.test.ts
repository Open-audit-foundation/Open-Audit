/**
 * lib/dag/engine.test.ts
 *
 * Unit tests for the DAG reconstruction engine.
 * Uses the DagBuilder directly (no XDR required) so the test suite runs
 * without a Stellar network connection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DagBuilder } from "./engine";
import type { FnCallEvent, FnReturnEvent, FnErrorEvent, LogEvent } from "./types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TX = "abc123";
const LEDGER = 50_000;
const TS = 1_700_000_000;

const CONTRACT_A = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const CONTRACT_B = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function call(contractId: string, fnName: string, args: string[] = []): FnCallEvent {
  return { kind: "fn_call", contractId, fnName, args };
}

function ret(fnName: string, cpuInsns: bigint, memBytes: bigint = 0n): FnReturnEvent {
  return { kind: "fn_return", fnName, returnValue: "0x", cpuInsns, memBytes };
}

function err(fnName: string): FnErrorEvent {
  return { kind: "fn_error", fnName, errorVal: "0x" };
}

function log(message: string): LogEvent {
  return { kind: "log", message };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DagBuilder", () => {
  let builder: DagBuilder;

  beforeEach(() => {
    builder = new DagBuilder(TX, LEDGER, TS);
  });

  // ── Basic single-frame ─────────────────────────────────────────────────────

  describe("single frame", () => {
    it("produces a root node on fn_call", () => {
      builder.feedEvent(call(CONTRACT_A, "transfer"));
      builder.feedEvent(ret("transfer", 1000n));
      const dag = builder.build();

      expect(dag.rootId).not.toBeNull();
      const root = dag.nodes.get(dag.rootId!)!;
      expect(root.contractId).toBe(CONTRACT_A);
      expect(root.fnName).toBe("transfer");
      expect(root.status).toBe("success");
      expect(root.depth).toBe(0);
      expect(root.parentId).toBeNull();
    });

    it("records total and self gas as equal with no children", () => {
      builder.feedEvent(call(CONTRACT_A, "transfer"));
      builder.feedEvent(ret("transfer", 1000n, 512n));
      const dag = builder.build();

      const root = dag.nodes.get(dag.rootId!)!;
      expect(root.totalCpuInsns).toBe(1000n);
      expect(root.selfCpuInsns).toBe(1000n);
      expect(root.totalMemBytes).toBe(512n);
      expect(root.selfMemBytes).toBe(512n);
    });

    it("marks isComplete true when stack is empty after build", () => {
      builder.feedEvent(call(CONTRACT_A, "transfer"));
      builder.feedEvent(ret("transfer", 1000n));
      expect(builder.build().isComplete).toBe(true);
    });

    it("marks isComplete false when a frame is still pending", () => {
      builder.feedEvent(call(CONTRACT_A, "transfer"));
      // No matching fn_return → stack still has one frame.
      expect(builder.build().isComplete).toBe(false);
    });
  });

  // ── Error frame ───────────────────────────────────────────────────────────

  describe("error frame", () => {
    it("sets status to error on fn_error", () => {
      builder.feedEvent(call(CONTRACT_A, "transfer"));
      builder.feedEvent(err("transfer"));
      const dag = builder.build();

      const root = dag.nodes.get(dag.rootId!)!;
      expect(root.status).toBe("error");
      expect(root.errorVal).toBe("0x");
    });

    it("does not attribute gas to an error frame", () => {
      builder.feedEvent(call(CONTRACT_A, "transfer"));
      builder.feedEvent(err("transfer"));
      const dag = builder.build();

      const root = dag.nodes.get(dag.rootId!)!;
      expect(root.totalCpuInsns).toBe(0n);
      expect(root.selfCpuInsns).toBe(0n);
    });
  });

  // ── Nested calls ──────────────────────────────────────────────────────────

  describe("nested calls", () => {
    it("correctly links parent and child", () => {
      builder.feedEvent(call(CONTRACT_A, "swap"));
      builder.feedEvent(call(CONTRACT_B, "approve"));
      builder.feedEvent(ret("approve", 50n));
      builder.feedEvent(ret("swap", 120n));
      const dag = builder.build();

      expect(dag.nodes.size).toBe(2);

      const root = dag.nodes.get(dag.rootId!)!;
      expect(root.fnName).toBe("swap");
      expect(root.childIds).toHaveLength(1);

      const childId = root.childIds[0];
      const child = dag.nodes.get(childId)!;
      expect(child.fnName).toBe("approve");
      expect(child.contractId).toBe(CONTRACT_B);
      expect(child.parentId).toBe(root.id);
      expect(child.depth).toBe(1);
    });

    it("computes self-gas correctly for parent with one child", () => {
      builder.feedEvent(call(CONTRACT_A, "swap"));
      builder.feedEvent(call(CONTRACT_B, "approve"));
      builder.feedEvent(ret("approve", 50n));
      builder.feedEvent(ret("swap", 120n));

      const dag = builder.build();
      const root = dag.nodes.get(dag.rootId!)!;
      const child = dag.nodes.get(root.childIds[0])!;

      // Child's total = 50; parent total = 120; parent self = 120 - 50 = 70.
      expect(root.totalCpuInsns).toBe(120n);
      expect(root.selfCpuInsns).toBe(70n);
      expect(child.totalCpuInsns).toBe(50n);
      expect(child.selfCpuInsns).toBe(50n);
    });

    it("handles multiple children at the same depth", () => {
      builder.feedEvent(call(CONTRACT_A, "execute"));
      builder.feedEvent(call(CONTRACT_B, "step1"));
      builder.feedEvent(ret("step1", 30n));
      builder.feedEvent(call(CONTRACT_B, "step2"));
      builder.feedEvent(ret("step2", 40n));
      builder.feedEvent(ret("execute", 100n));

      const dag = builder.build();
      const root = dag.nodes.get(dag.rootId!)!;
      expect(root.childIds).toHaveLength(2);
      // self = 100 - 30 - 40 = 30
      expect(root.selfCpuInsns).toBe(30n);
    });
  });

  // ── Deep nesting ──────────────────────────────────────────────────────────

  describe("deep recursion", () => {
    it("handles 3-level nesting correctly", () => {
      builder.feedEvent(call(CONTRACT_A, "a"));
      builder.feedEvent(call(CONTRACT_B, "b"));
      builder.feedEvent(call(CONTRACT_A, "c"));
      builder.feedEvent(ret("c", 10n));
      builder.feedEvent(ret("b", 30n));
      builder.feedEvent(ret("a", 60n));

      const dag = builder.build();
      expect(dag.nodes.size).toBe(3);
      expect(dag.isComplete).toBe(true);

      const root = dag.nodes.get(dag.rootId!)!;
      expect(root.selfCpuInsns).toBe(30n); // 60 - 30
      expect(root.depth).toBe(0);

      const mid = dag.nodes.get(root.childIds[0])!;
      expect(mid.depth).toBe(1);
      expect(mid.selfCpuInsns).toBe(20n); // 30 - 10

      const leaf = dag.nodes.get(mid.childIds[0])!;
      expect(leaf.depth).toBe(2);
      expect(leaf.selfCpuInsns).toBe(10n);
    });
  });

  // ── Logs ──────────────────────────────────────────────────────────────────

  describe("diagnostic logs", () => {
    it("attaches logs to the active frame", () => {
      builder.feedEvent(call(CONTRACT_A, "transfer"));
      builder.feedEvent(log("sending tokens"));
      builder.feedEvent(log("done"));
      builder.feedEvent(ret("transfer", 1000n));

      const dag = builder.build();
      const root = dag.nodes.get(dag.rootId!)!;
      expect(root.logs).toEqual(["sending tokens", "done"]);
    });

    it("ignores logs with no active frame", () => {
      builder.feedEvent(log("orphan message")); // Stack is empty — should not crash.
      expect(builder.build().nodes.size).toBe(0);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles unmatched fn_return gracefully", () => {
      // fn_return with no prior fn_call — should not throw.
      expect(() => {
        builder.feedEvent(ret("transfer", 100n));
        builder.build();
      }).not.toThrow();
    });

    it("handles empty event stream", () => {
      const dag = builder.build();
      expect(dag.rootId).toBeNull();
      expect(dag.nodes.size).toBe(0);
      expect(dag.isComplete).toBe(true);
    });

    it("does not report negative self-gas when child totals exceed parent", () => {
      // Shouldn't happen in real transactions, but guards against corrupt data.
      builder.feedEvent(call(CONTRACT_A, "transfer"));
      builder.feedEvent(call(CONTRACT_B, "sub"));
      builder.feedEvent(ret("sub", 200n)); // Child 200
      builder.feedEvent(ret("transfer", 100n)); // Parent 100 < child sum
      const dag = builder.build();
      const root = dag.nodes.get(dag.rootId!)!;
      expect(root.selfCpuInsns).toBe(0n); // Clamped to 0.
    });
  });

  // ── Gas totals ────────────────────────────────────────────────────────────

  describe("transaction-level totals", () => {
    it("sets totalCpuInsns from root node", () => {
      builder.feedEvent(call(CONTRACT_A, "main"));
      builder.feedEvent(ret("main", 999n, 1024n));
      const dag = builder.build();
      expect(dag.totalCpuInsns).toBe(999n);
      expect(dag.totalMemBytes).toBe(1024n);
    });
  });
});
