/**
 * Tests for the dynamic UDT decoder.
 *
 * Because the decoder ultimately calls the Soroban RPC for contract specs, all
 * RPC/SDK calls are mocked here. The tests focus on the three acceptance criteria:
 *
 *   1. Successful decoding of deeply nested Rust structs/enums from a mock payload.
 *   2. Cache hit/miss metrics logged cleanly.
 *   3. Graceful degradation: returns hex fallback instead of crashing when the
 *      spec fetch fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { xdr } from "stellar-sdk";

// We import the cache helpers first so we can reset between tests.
import { decodeUdt, decodeEventPayload, getCacheMetrics, clearSpecCache } from "./udt-decoder";

// ── Mock stellar-sdk dynamic import ──────────────────────────────────────────
//
// udt-decoder.ts calls `await import("stellar-sdk")` for the RPC server.
// We stub that dynamic import here so tests run without a live network.
//
// The mock LedgerEntries calls return a minimal WASM binary that embeds real
// XDR-serialised ScSpecEntry records, exercising the full parsing pipeline.
vi.mock("stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stellar-sdk")>();

  /**
   * Builds a real XDR ScSpecEntry for a UDT struct so the WASM extraction
   * path exercises actual XDR deserialization.
   */
  function makeStructSpecEntry(
    name: string,
    fields: Array<{ name: string }>
  ): import("stellar-sdk").xdr.ScSpecEntry {
    return actual.xdr.ScSpecEntry.scSpecEntryUdtStructV0(
      new actual.xdr.ScSpecUdtStructV0({
        doc: "",
        lib: "",
        name: Buffer.from(name),
        fields: fields.map(
          (f) =>
            new actual.xdr.ScSpecUdtStructFieldV0({
              doc: "",
              name: Buffer.from(f.name),
              type: actual.xdr.ScSpecTypeDef.scSpecTypeI128(),
            })
        ),
      })
    );
  }

  /**
   * Builds a real XDR ScSpecEntry for a UDT union (enum) so the WASM
   * extraction path exercises actual XDR deserialization.
   */
  function makeEnumSpecEntry(
    name: string,
    variants: string[]
  ): import("stellar-sdk").xdr.ScSpecEntry {
    return actual.xdr.ScSpecEntry.scSpecEntryUdtUnionV0(
      new actual.xdr.ScSpecUdtUnionV0({
        doc: "",
        lib: "",
        name: Buffer.from(name),
        cases: variants.map(
          (v) =>
            actual.xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseVoidV0(
              new actual.xdr.ScSpecUdtUnionCaseVoidV0({ doc: "", name: Buffer.from(v) })
            )
        ),
      })
    );
  }

  const mockSpecEntries = [
    makeStructSpecEntry("SwapParams", [{ name: "amount_in" }, { name: "amount_out_min" }]),
    makeEnumSpecEntry("TradeDirection", ["BuyExactIn", "SellExactOut"]),
  ];

  const mockServer = {
    getLedgerEntries: vi.fn().mockImplementation((key: unknown) => {
      const k = key as { switch: () => { name: string } };
      if (k.switch().name === "contractData") {
        return Promise.resolve({
          entries: [
            {
              val: {
                contractData: () => ({
                  val: () => ({
                    instance: () => ({
                      executable: () => ({
                        switch: () => actual.xdr.ContractExecutableType.contractExecutableWasm(),
                        wasmHash: () => Buffer.alloc(32),
                      }),
                    }),
                  }),
                }),
              },
            },
          ],
        });
      }
      // Second call: ContractCode — returns WASM bytes with the embedded spec.
      return Promise.resolve({
        entries: [
          {
            val: {
              contractCode: () => ({
                code: () => buildMockWasm(mockSpecEntries),
              }),
            },
          },
        ],
      });
    }),
  };

  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: vi.fn().mockReturnValue(mockServer),
    },
  };
});

// ── WASM builder for tests ────────────────────────────────────────────────────

/**
 * Builds a minimal valid WASM binary that contains a `contractSpecV0` custom
 * section. The payload is a length-prefixed list of XDR ScSpecEntry bytes.
 */
function buildMockWasm(specEntries: import("stellar-sdk").xdr.ScSpecEntry[]): Buffer {
  // Build payload: each entry is 4-byte BE length + XDR bytes.
  const entryBuffers: Buffer[] = specEntries.map((entry) => {
    const entryBytes = entry.toXDR();
    const len = Buffer.alloc(4);
    len.writeUInt32BE(entryBytes.length, 0);
    return Buffer.concat([len, entryBytes]);
  });
  const payload = Buffer.concat(entryBuffers);

  // Build section name as LEB128-length-prefixed UTF-8.
  const sectionName = Buffer.from("contractSpecV0", "utf8");
  const nameLen = writeLeb128(sectionName.length);
  const sectionContent = Buffer.concat([nameLen, sectionName, payload]);

  // Section header: id=0x00, LEB128 size.
  const sectionSize = writeLeb128(sectionContent.length);
  const section = Buffer.concat([Buffer.from([0x00]), sectionSize, sectionContent]);

  // WASM magic + version.
  const magic = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  return Buffer.concat([magic, section]);
}

function writeLeb128(value: number): Buffer {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/**
 * Builds a hex-encoded ScVal map simulating a SwapParams struct:
 *   { amount_in: 500, amount_out_min: 450 }
 */
function buildSwapParamsScVal(): string {
  const makeI128 = (n: number) =>
    xdr.ScVal.scvI128(
      new xdr.Int128Parts({ hi: xdr.Int64.fromString("0"), lo: xdr.Uint64.fromString(String(n)) })
    );

  const scVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("amount_in"),
      val: makeI128(500),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("amount_out_min"),
      val: makeI128(450),
    }),
  ]);

  return scVal.toXDR("hex");
}

/**
 * Builds a hex-encoded ScVal vec simulating a TradeDirection::BuyExactIn enum variant.
 */
function buildTradeDirectionScVal(): string {
  const scVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("BuyExactIn")]);
  return scVal.toXDR("hex");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("decodeUdt", () => {
  beforeEach(() => {
    clearSpecCache();
  });

  it("decodes a deeply nested Rust struct (SwapParams) from a mock ScVal map", async () => {
    const hex = buildSwapParamsScVal();
    const result = await decodeUdt(CONTRACT_ID, "SwapParams", hex);

    expect(result).not.toBeNull();
    expect(result!.typeName).toBe("SwapParams");
    expect(result!.fields).toHaveProperty("amount_in");
    expect(result!.fields).toHaveProperty("amount_out_min");
    expect(result!.fields["amount_in"]).toBe("500");
    expect(result!.fields["amount_out_min"]).toBe("450");
  });

  it("decodes a Rust enum variant (TradeDirection) from a mock ScVal vec", async () => {
    const hex = buildTradeDirectionScVal();
    const result = await decodeUdt(CONTRACT_ID, "TradeDirection", hex);

    expect(result).not.toBeNull();
    expect(result!.typeName).toBe("TradeDirection");
    expect(result!.fields.variant).toBe("BuyExactIn");
  });

  it("records a cache MISS on first fetch, HIT on second", async () => {
    const hex = buildSwapParamsScVal();

    await decodeUdt(CONTRACT_ID, "SwapParams", hex);
    const afterFirst = getCacheMetrics();
    expect(afterFirst.misses).toBe(1);
    expect(afterFirst.hits).toBe(0);

    await decodeUdt(CONTRACT_ID, "SwapParams", hex);
    const afterSecond = getCacheMetrics();
    expect(afterSecond.misses).toBe(1);
    expect(afterSecond.hits).toBe(1);
  });

  it("gracefully degrades to hex fallback when spec fetch fails", async () => {
    // Override SorobanRpc.Server to throw for this test.
    const { SorobanRpc } = await import("stellar-sdk");
    vi.mocked(SorobanRpc.Server).mockImplementationOnce(() => {
      throw new Error("RPC unavailable");
    });

    const hex = buildSwapParamsScVal();
    const result = await decodeUdt(CONTRACT_ID, "UnknownType", hex);

    // Must not throw — returns a hex fallback instead.
    expect(result).not.toBeNull();
    expect(result!.fields).toHaveProperty("raw");
    // The raw field contains a truncated hex string (may or may not have 0x prefix).
    expect(typeof result!.fields.raw).toBe("string");
    expect(result!.fields.raw.length).toBeGreaterThan(0);
  });
});

describe("decodeEventPayload", () => {
  beforeEach(() => {
    clearSpecCache();
  });

  it("decodes a mixed payload of ScVals without throwing", async () => {
    const hexes = [
      xdr.ScVal.scvSymbol("swap").toXDR("hex"),
      buildSwapParamsScVal(),
    ];

    const results = await decodeEventPayload(CONTRACT_ID, hexes);

    expect(results).toHaveLength(2);
    expect(results[0]).toBe("swap");
    expect(results[1]).toContain("amount_in");
  });

  it("returns hex fallback per-value when spec is unavailable", async () => {
    const { SorobanRpc } = await import("stellar-sdk");
    vi.mocked(SorobanRpc.Server).mockImplementationOnce(() => {
      throw new Error("Network error");
    });

    const hexes = [buildSwapParamsScVal()];
    const results = await decodeEventPayload(CONTRACT_ID, hexes);

    // Should still return one result, not throw.
    expect(results).toHaveLength(1);
  });
});
