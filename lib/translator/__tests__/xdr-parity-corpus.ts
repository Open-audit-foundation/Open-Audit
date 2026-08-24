/**
 * Deterministic corpus of ScVal payloads used to prove behavioral parity
 * between the pure-TypeScript parser (secureParseScValTs) and the native
 * Rust decoder (native/soroban-xdr-decode).
 *
 * It contains:
 *  - every payload/case exercised by fuzz-xdr-parser.test.ts and
 *    secure-xdr-parser.test.ts (the existing fuzz/security suites),
 *    with the random generators re-seeded deterministically so both
 *    implementations always see the exact same inputs;
 *  - additional grammar/guard boundary coverage (every ScVal variant,
 *    malformed discriminants, padding, symbol limits, UTF-8 edge cases,
 *    depth/collection/allocation limits at and around their boundaries).
 *
 * This file is a test helper, not a test — see native-ts-parity.test.ts.
 */

import { xdr as StellarXdr } from "stellar-sdk";

export interface ParityCase {
  name: string;
  /** Deliberately loose: the fuzz suite feeds null/undefined as well. */
  input: string | null | undefined;
}

export interface ParityCategory {
  category: string;
  cases: ParityCase[];
}

// ─── Deterministic PRNG (mulberry32) ────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Generators ported from fuzz-xdr-parser.test.ts (seeded) ────────────────

function generateRandomHex(rand: () => number, length: number): string {
  const chars = "0123456789abcdef";
  let hex = "0x";
  for (let i = 0; i < length; i++) {
    hex += chars[Math.floor(rand() * chars.length)];
  }
  return hex;
}

function mutateHex(rand: () => number, hex: string): string {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = cleanHex.split("");
  const mutationCount = Math.floor(rand() * 5) + 1;
  for (let i = 0; i < mutationCount; i++) {
    const pos = Math.floor(rand() * bytes.length);
    bytes[pos] = Math.floor(rand() * 16).toString(16);
  }
  return "0x" + bytes.join("");
}

/** Same construction as the fuzz suite's generateDeepNesting. */
function generateDeepNesting(depth: number): string {
  let hex = "0x0000000e0000000178"; // String "x" at the core
  for (let i = 0; i < depth; i++) {
    const vecHex = "0x00000010";
    const countHex = "00000001";
    hex = vecHex + countHex + hex.slice(2);
  }
  return hex;
}

// ─── SDK-built helpers ──────────────────────────────────────────────────────

function sdkHex(scVal: StellarXdr.ScVal): string {
  return "0x" + scVal.toXDR("hex");
}

function deepVec(depth: number): StellarXdr.ScVal {
  let scVal: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(42);
  for (let i = 0; i < depth; i++) {
    scVal = StellarXdr.ScVal.scvVec([scVal]);
  }
  return scVal;
}

function deepMap(depth: number): StellarXdr.ScVal {
  let scVal: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(42);
  for (let i = 0; i < depth; i++) {
    scVal = StellarXdr.ScVal.scvMap([
      new StellarXdr.ScMapEntry({
        key: StellarXdr.ScVal.scvSymbol("nested"),
        val: scVal,
      }),
    ]);
  }
  return scVal;
}

function bigVec(count: number): StellarXdr.ScVal {
  const items: StellarXdr.ScVal[] = new Array(count);
  for (let i = 0; i < count; i++) {
    items[i] = StellarXdr.ScVal.scvU32(i >>> 0);
  }
  return StellarXdr.ScVal.scvVec(items);
}

function bigMap(count: number): StellarXdr.ScVal {
  const entries: StellarXdr.ScMapEntry[] = new Array(count);
  for (let i = 0; i < count; i++) {
    entries[i] = new StellarXdr.ScMapEntry({
      key: StellarXdr.ScVal.scvU32(i >>> 0),
      val: StellarXdr.ScVal.scvVoid(),
    });
  }
  return StellarXdr.ScVal.scvMap(entries);
}

/** Raw scvString payload from arbitrary (possibly invalid UTF-8) bytes. */
function rawStringScVal(bytes: number[]): string {
  const len = bytes.length;
  const pad = (4 - (len % 4)) % 4;
  const body = Buffer.concat([
    Buffer.from([0, 0, 0, 14]), // SCV_STRING
    u32be(len),
    Buffer.from(bytes),
    Buffer.alloc(pad),
  ]);
  return "0x" + body.toString("hex");
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function accountAddress(): StellarXdr.ScVal {
  return StellarXdr.ScVal.scvAddress(
    StellarXdr.ScAddress.scAddressTypeAccount(
      StellarXdr.PublicKey.publicKeyTypeEd25519(Buffer.alloc(32, 7))
    )
  );
}

function contractAddress(): StellarXdr.ScVal {
  return StellarXdr.ScVal.scvAddress(
    StellarXdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, 9))
  );
}

function contractInstance(storageVal?: StellarXdr.ScVal): StellarXdr.ScVal {
  return StellarXdr.ScVal.scvContractInstance(
    new StellarXdr.ScContractInstance({
      executable: StellarXdr.ContractExecutable.contractExecutableWasm(
        Buffer.alloc(32, 1)
      ),
      storage: storageVal
        ? [
            new StellarXdr.ScMapEntry({
              key: StellarXdr.ScVal.scvSymbol("k"),
              val: storageVal,
            }),
          ]
        : null,
    })
  );
}

/**
 * Builds a payload whose traversal allocation estimate exceeds
 * MAX_PAYLOAD_SIZE_BYTES (10 MB) while the raw input stays under the hex
 * length limit: five nested maps of 9,000 void entries each (each entry is
 * estimated at 100 bytes) around a 1.7 MB invalid-UTF-8 string whose lossy
 * decoding triples in size (0xff → U+FFFD, 3 bytes).
 */
function allocationBomb(): string {
  const STRING_BYTES = 1_700_000;
  const ENTRIES = 9_000;
  const LEVELS = 5;

  const voidVal = Buffer.from([0, 0, 0, 1]);
  const strHeader = Buffer.concat([
    Buffer.from([0, 0, 0, 14]),
    u32be(STRING_BYTES),
  ]);
  let core = Buffer.concat([
    strHeader,
    Buffer.alloc(STRING_BYTES, 0xff), // multiple of 4, no padding needed
  ]);

  for (let level = 0; level < LEVELS; level++) {
    const filler = Buffer.concat([voidVal, voidVal]); // key: void, val: void
    const parts: Buffer[] = [
      Buffer.from([0, 0, 0, 17]), // SCV_MAP
      Buffer.from([0, 0, 0, 1]), // option: present
      u32be(ENTRIES + 1),
    ];
    for (let i = 0; i < ENTRIES; i++) parts.push(filler);
    parts.push(voidVal, core); // final entry: key void, val = previous level
    core = Buffer.concat(parts);
  }

  return "0x" + core.toString("hex");
}

// ─── Corpus ─────────────────────────────────────────────────────────────────

export function buildParityCorpus(): ParityCategory[] {
  const categories: ParityCategory[] = [];
  const add = (category: string, cases: ParityCase[]) =>
    categories.push({ category, cases });

  // ——— Cases lifted verbatim from fuzz-xdr-parser.test.ts ———
  add("fuzz: malformed hex strings", [
    { name: "empty string", input: "" },
    { name: "0xGGGGGGGG", input: "0xGGGGGGGG" },
    { name: "not-hex-at-all", input: "not-hex-at-all" },
    { name: "0x!!!", input: "0x!!!" },
    { name: "emoji", input: "🎉🎊" },
    { name: "null", input: null },
    { name: "undefined", input: undefined },
  ]);

  add("fuzz: truncated hex strings", [
    { name: "0x00", input: "0x00" },
    { name: "0x0000", input: "0x0000" },
    { name: "0x000000", input: "0x000000" },
    { name: "0x00000010", input: "0x00000010" },
  ]);

  add("fuzz: oversized hex strings", [
    { name: "500KB of 0xa", input: "0x" + "a".repeat(1000000) },
    {
      name: "over MAX_HEX_STRING_LENGTH",
      input: "0x" + "0".repeat(2 * 1024 * 1024 * 2 + 10),
    },
  ]);

  {
    // The fuzz suite's hand-rolled nesting builders, double-"0x" bug included:
    // the parity contract is "identical behavior on identical inputs".
    let vecHex = "0x0000000e";
    vecHex += "00000001";
    vecHex += "78";
    for (let i = 0; i < 150; i++) {
      vecHex = "0x00000010" + "00000001" + vecHex.slice(2);
    }
    let mapHex = "0x0000000e";
    mapHex += "00000001";
    mapHex += "78";
    for (let i = 0; i < 150; i++) {
      mapHex = "0x00000011" + "00000001" + "0x0000000e0000000178" + mapHex.slice(2);
    }
    add("fuzz: hand-rolled nesting payloads", [
      { name: "nested vec builder output", input: "0x" + vecHex },
      { name: "nested map builder output", input: "0x" + mapHex },
    ]);
  }

  {
    let largeVec = "0x00000010" + "00004e20";
    for (let i = 0; i < 100; i++) largeVec += "00000000";
    add("fuzz: large collection payloads", [
      { name: "vec claiming 20000 elements", input: "0x" + largeVec },
      { name: "map claiming 20000 entries", input: "0x" + "0x00000011" + "00004e20" },
      { name: "vec with huge count marker", input: "0x00000010" + "FFFFFFFF" },
      { name: "map with huge count marker", input: "0x00000011" + "FFFFFFFF" },
    ]);
  }

  {
    const rand = mulberry32(0xa11ce);
    const mutations: ParityCase[] = [];
    const validHex = "0x0000000e0000000568656c6c6f"; // String "hello"
    for (let i = 0; i < 100; i++) {
      mutations.push({ name: `mutation #${i}`, input: mutateHex(rand, validHex) });
    }
    add("fuzz: seeded mutations of a valid payload", mutations);

    const randoms: ParityCase[] = [];
    for (let i = 0; i < 200; i++) {
      randoms.push({
        name: `random hex #${i}`,
        input: generateRandomHex(rand, Math.floor(rand() * 1000)),
      });
    }
    add("fuzz: seeded random hex strings", randoms);
  }

  add("fuzz: deep nesting generator", [
    { name: "depth 50", input: generateDeepNesting(50) },
    { name: "depth 150", input: generateDeepNesting(150) },
  ]);

  // ——— Cases lifted from secure-xdr-parser.test.ts (SDK-built) ———
  add("integration: valid payloads", [
    { name: "bool", input: sdkHex(StellarXdr.ScVal.scvBool(true)) },
    { name: "u32", input: sdkHex(StellarXdr.ScVal.scvU32(42)) },
    { name: "u32 zero", input: sdkHex(StellarXdr.ScVal.scvU32(0)) },
    { name: "u32 max", input: sdkHex(StellarXdr.ScVal.scvU32(0xffffffff)) },
    { name: "string hello", input: sdkHex(StellarXdr.ScVal.scvString("hello")) },
    { name: "symbol transfer", input: sdkHex(StellarXdr.ScVal.scvSymbol("transfer")) },
    {
      name: "vec of u32",
      input: sdkHex(
        StellarXdr.ScVal.scvVec([
          StellarXdr.ScVal.scvU32(1),
          StellarXdr.ScVal.scvU32(2),
          StellarXdr.ScVal.scvU32(3),
        ])
      ),
    },
    {
      name: "map amount:100",
      input: sdkHex(
        StellarXdr.ScVal.scvMap([
          new StellarXdr.ScMapEntry({
            key: StellarXdr.ScVal.scvSymbol("amount"),
            val: StellarXdr.ScVal.scvU32(100),
          }),
        ])
      ),
    },
    { name: "empty vec", input: sdkHex(StellarXdr.ScVal.scvVec([])) },
    { name: "empty map", input: sdkHex(StellarXdr.ScVal.scvMap([])) },
    {
      name: "i128 amount",
      input: sdkHex(
        StellarXdr.ScVal.scvI128(
          new StellarXdr.Int128Parts({
            hi: StellarXdr.Int64.fromString("0"),
            lo: StellarXdr.Uint64.fromString("1000000"),
          })
        )
      ),
    },
    {
      name: "complex struct {amounts:[100,200,300]}",
      input: sdkHex(
        StellarXdr.ScVal.scvMap([
          new StellarXdr.ScMapEntry({
            key: StellarXdr.ScVal.scvSymbol("amounts"),
            val: StellarXdr.ScVal.scvVec([
              StellarXdr.ScVal.scvU32(100),
              StellarXdr.ScVal.scvU32(200),
              StellarXdr.ScVal.scvU32(300),
            ]),
          }),
        ])
      ),
    },
  ]);

  add("integration: nesting depth boundaries", [
    { name: "vec depth 10", input: sdkHex(deepVec(10)) },
    { name: "map depth 10", input: sdkHex(deepMap(10)) },
    { name: "vec depth 99", input: sdkHex(deepVec(99)) },
    { name: "vec depth 100", input: sdkHex(deepVec(100)) },
    { name: "vec depth 101", input: sdkHex(deepVec(101)) },
    { name: "vec depth 102", input: sdkHex(deepVec(102)) },
    { name: "vec depth 150", input: sdkHex(deepVec(150)) },
    { name: "vec depth 300", input: sdkHex(deepVec(300)) },
    { name: "map depth 99", input: sdkHex(deepMap(99)) },
    { name: "map depth 100", input: sdkHex(deepMap(100)) },
    { name: "map depth 101", input: sdkHex(deepMap(101)) },
    { name: "map depth 150", input: sdkHex(deepMap(150)) },
  ]);

  add("guards: collection size boundaries", [
    { name: "vec with 9999 elements", input: sdkHex(bigVec(9999)) },
    { name: "vec with 10000 elements", input: sdkHex(bigVec(10000)) },
    { name: "vec with 10001 elements", input: sdkHex(bigVec(10001)) },
    { name: "map with 10000 entries", input: sdkHex(bigMap(10000)) },
    { name: "map with 10001 entries", input: sdkHex(bigMap(10001)) },
  ]);

  add("guards: allocation limit", [
    { name: "utf8 lossy allocation bomb", input: allocationBomb() },
  ]);

  // ——— Full grammar coverage ———
  add("grammar: every ScVal variant", [
    { name: "void", input: sdkHex(StellarXdr.ScVal.scvVoid()) },
    { name: "bool false", input: sdkHex(StellarXdr.ScVal.scvBool(false)) },
    {
      name: "error contract code",
      input: sdkHex(
        StellarXdr.ScVal.scvError(StellarXdr.ScError.sceContract(1234))
      ),
    },
    {
      name: "error wasm vm",
      input: sdkHex(
        StellarXdr.ScVal.scvError(
          StellarXdr.ScError.sceWasmVm(StellarXdr.ScErrorCode.scecInvalidInput())
        )
      ),
    },
    {
      name: "error auth",
      input: sdkHex(
        StellarXdr.ScVal.scvError(
          StellarXdr.ScError.sceAuth(StellarXdr.ScErrorCode.scecUnexpectedSize())
        )
      ),
    },
    { name: "i32 negative", input: sdkHex(StellarXdr.ScVal.scvI32(-42)) },
    {
      name: "u64",
      input: sdkHex(StellarXdr.ScVal.scvU64(StellarXdr.Uint64.fromString("18446744073709551615"))),
    },
    {
      name: "i64",
      input: sdkHex(StellarXdr.ScVal.scvI64(StellarXdr.Int64.fromString("-9223372036854775808"))),
    },
    {
      name: "timepoint",
      input: sdkHex(StellarXdr.ScVal.scvTimepoint(StellarXdr.Uint64.fromString("1700000000"))),
    },
    {
      name: "duration",
      input: sdkHex(StellarXdr.ScVal.scvDuration(StellarXdr.Uint64.fromString("3600"))),
    },
    {
      name: "u128",
      input: sdkHex(
        StellarXdr.ScVal.scvU128(
          new StellarXdr.UInt128Parts({
            hi: StellarXdr.Uint64.fromString("1"),
            lo: StellarXdr.Uint64.fromString("2"),
          })
        )
      ),
    },
    {
      name: "u256",
      input: sdkHex(
        StellarXdr.ScVal.scvU256(
          new StellarXdr.UInt256Parts({
            hiHi: StellarXdr.Uint64.fromString("1"),
            hiLo: StellarXdr.Uint64.fromString("2"),
            loHi: StellarXdr.Uint64.fromString("3"),
            loLo: StellarXdr.Uint64.fromString("4"),
          })
        )
      ),
    },
    {
      name: "i256",
      input: sdkHex(
        StellarXdr.ScVal.scvI256(
          new StellarXdr.Int256Parts({
            hiHi: StellarXdr.Int64.fromString("-1"),
            hiLo: StellarXdr.Uint64.fromString("2"),
            loHi: StellarXdr.Uint64.fromString("3"),
            loLo: StellarXdr.Uint64.fromString("4"),
          })
        )
      ),
    },
    { name: "bytes", input: sdkHex(StellarXdr.ScVal.scvBytes(Buffer.from([1, 2, 3, 4, 5]))) },
    { name: "bytes empty", input: sdkHex(StellarXdr.ScVal.scvBytes(Buffer.alloc(0))) },
    { name: "symbol 32 chars", input: sdkHex(StellarXdr.ScVal.scvSymbol("a".repeat(32))) },
    { name: "account address", input: sdkHex(accountAddress()) },
    { name: "contract address", input: sdkHex(contractAddress()) },
    { name: "contract instance (no storage)", input: sdkHex(contractInstance()) },
    {
      name: "contract instance (flat storage)",
      input: sdkHex(contractInstance(StellarXdr.ScVal.scvU32(7))),
    },
    {
      name: "contract instance (deep storage, validation blind spot)",
      input: sdkHex(contractInstance(deepMap(150))),
    },
    {
      name: "stellar asset executable",
      input: sdkHex(
        StellarXdr.ScVal.scvContractInstance(
          new StellarXdr.ScContractInstance({
            executable: StellarXdr.ContractExecutable.contractExecutableStellarAsset(),
            storage: null,
          })
        )
      ),
    },
    { name: "ledger key contract instance", input: sdkHex(StellarXdr.ScVal.scvLedgerKeyContractInstance()) },
    {
      name: "ledger key nonce",
      input: sdkHex(
        StellarXdr.ScVal.scvLedgerKeyNonce(
          new StellarXdr.ScNonceKey({ nonce: StellarXdr.Int64.fromString("-5") })
        )
      ),
    },
  ]);

  add("grammar: malformed structures", [
    { name: "bool with value 2", input: "0x" + "00000000" + "00000002" },
    { name: "unknown discriminant 22", input: "0x" + "00000016" + "00000000" },
    { name: "negative discriminant", input: "0x" + "ffffffff" },
    { name: "vec option flag 2", input: "0x" + "00000010" + "00000002" },
    { name: "map option flag 2", input: "0x" + "00000011" + "00000002" },
    { name: "null vec (option absent)", input: "0x" + "00000010" + "00000000" },
    { name: "null map (option absent)", input: "0x" + "00000011" + "00000000" },
    { name: "symbol length 33", input: "0x" + "0000000f" + "00000021" + "61".repeat(33) + "000000" },
    { name: "bytes nonzero padding", input: "0x" + "0000000d" + "00000001" + "aa" + "000001" },
    { name: "bytes valid padding", input: "0x" + "0000000d" + "00000001" + "aa" + "000000" },
    { name: "bytes length beyond buffer", input: "0x" + "0000000d" + "00000010" + "aabb" },
    { name: "trailing bytes after valid scval", input: "0x" + "00000001" + "00" },
    { name: "trailing word after valid scval", input: "0x" + "00000001" + "00000000" },
    { name: "error type 10", input: "0x" + "00000002" + "0000000a" },
    { name: "error code 10", input: "0x" + "00000002" + "00000008" + "0000000a" },
    { name: "error code -1", input: "0x" + "00000002" + "00000008" + "ffffffff" },
    { name: "error code 9 (valid)", input: "0x" + "00000002" + "00000008" + "00000009" },
    { name: "address type 2", input: "0x" + "00000012" + "00000002" + "00".repeat(32) },
    { name: "public key type 1", input: "0x" + "00000012" + "00000000" + "00000001" + "00".repeat(32) },
    { name: "executable type 2", input: "0x" + "00000013" + "00000002" + "00000000" },
    { name: "truncated u128", input: "0x" + "00000009" + "0000000000000001" },
    { name: "truncated address hash", input: "0x" + "00000012" + "00000001" + "00".repeat(16) },
  ]);

  add("grammar: hex encoding quirks", [
    { name: "bare 0x", input: "0x" },
    { name: "bare x", input: "x" },
    { name: "uppercase 0X prefix (not stripped)", input: "0X00000001" },
    { name: "no prefix valid void", input: "00000001" },
    { name: "uppercase hex digits", input: "0x0000000E0000000568656C6C6F000000" },
    { name: "odd length valid prefix", input: "0x000000010" },
    { name: "odd length truncating", input: "0x0000000e0000000568656c6c6f0000005" },
    { name: "invalid char mid-payload", input: "0x00000001zz000000" },
    { name: "invalid char making prefix valid", input: "0x00000001g" },
    { name: "whitespace in hex", input: "0x000000 01" },
    { name: "leading whitespace", input: " 0x00000001" },
  ]);

  {
    const rand = mulberry32(0xbeef);
    const strings: ParityCase[] = [
      { name: "valid ascii", input: rawStringScVal([0x68, 0x69]) },
      { name: "valid multibyte", input: rawStringScVal([0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x8e, 0x89]) },
      { name: "lone 0xff", input: rawStringScVal([0xff]) },
      { name: "0xc3 0x28 (bad continuation)", input: rawStringScVal([0xc3, 0x28]) },
      { name: "truncated 3-byte seq", input: rawStringScVal([0xe2, 0x82]) },
      { name: "truncated 4-byte seq", input: rawStringScVal([0xf0, 0x9f, 0x8e]) },
      { name: "utf16 surrogate (CESU)", input: rawStringScVal([0xed, 0xa0, 0x80]) },
      { name: "beyond U+10FFFF", input: rawStringScVal([0xf4, 0x90, 0x80, 0x80]) },
      { name: "overlong slash", input: rawStringScVal([0xc0, 0xaf]) },
      { name: "mixed valid/invalid", input: rawStringScVal([0x61, 0xff, 0x62, 0xe2, 0x82, 0x63]) },
      { name: "nul bytes", input: rawStringScVal([0x00, 0x00, 0x00]) },
    ];
    for (let i = 0; i < 30; i++) {
      const len = Math.floor(rand() * 12);
      const bytes: number[] = [];
      for (let j = 0; j < len; j++) bytes.push(Math.floor(rand() * 256));
      strings.push({ name: `random bytes string #${i}`, input: rawStringScVal(bytes) });
    }
    add("grammar: string UTF-8 edge cases", strings);
  }

  {
    const base = sdkHex(
      StellarXdr.ScVal.scvMap([
        new StellarXdr.ScMapEntry({
          key: StellarXdr.ScVal.scvSymbol("amounts"),
          val: StellarXdr.ScVal.scvVec([
            StellarXdr.ScVal.scvU32(100),
            accountAddress(),
            StellarXdr.ScVal.scvBytes(Buffer.alloc(10, 3)),
          ]),
        }),
      ])
    );
    const prefixes: ParityCase[] = [];
    for (let end = 2; end < base.length; end += 8) {
      prefixes.push({ name: `prefix of ${end} chars`, input: base.slice(0, end) });
    }
    add("grammar: truncation sweep of a realistic payload", prefixes);
  }

  return categories;
}
