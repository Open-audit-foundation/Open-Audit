/**
 * End-to-end integration tests for the Soroswap Router and Blend Pool
 * blueprints, built from real hex-encoded event payloads captured from
 * Stellar mainnet (via Soroban RPC's getEvents), not synthetic fixtures.
 *
 * Each `topics`/`data` hex blob below is the raw XDR of a real on-chain
 * event, base64-decoded from a live `getEvents` response and re-encoded as
 * the "0x"-prefixed hex this codebase's RawEvent expects. The associated
 * ledger/txHash let you look the transaction up on any Stellar explorer.
 *
 * Capturing these events against the pre-fix blueprints is what surfaced two
 * real bugs (both fixed alongside this test):
 *   1. Soroswap Router's "SoroswapRouter" tag topic is XDR-encoded as
 *      SCV_STRING on mainnet, not SCV_SYMBOL — every real swap/add/remove
 *      event was silently falling through to "cryptic".
 *   2. Blend's v2 fill_auction event has a different topic order and data
 *      shape than v1 (see blueprints/blend-pool.ts) — real liquidations on
 *      the currently-active v2 pools were also falling through to "cryptic".
 *
 * A live user-liquidation (fill_auction, auction_type=0) event could not be
 * found within the ~5-day retention window of public Soroban RPC nodes at
 * the time this was written, so those two cases (and "borrow", which also
 * didn't appear in the sampled window) use schema-accurate fixtures built
 * with the real stellar-sdk XDR encoders instead — clearly separated below
 * from the real captures. Their shape is verified against the same
 * blend-contracts-v2 / blend-contracts source cited in blueprints/blend-pool.ts.
 */

import { describe, it, expect } from "vitest";
import { xdr as StellarXdr } from "stellar-sdk";
import { translateEvent } from "../registry";
import { BLEND_POOL_V1_CONTRACT_IDS, BLEND_POOL_V2_CONTRACT_IDS } from "../blueprints/blend-pool";
import type { RawEvent } from "../types";

const LANGS = ["en", "es", "fr", "zh"] as const;

type LocalizedExpectation = { eventType: string; description: string };

function expectAllLanguages(
  event: RawEvent,
  expected: Record<(typeof LANGS)[number], LocalizedExpectation>
) {
  for (const lang of LANGS) {
    const result = translateEvent(event, undefined, lang);
    expect(result.status).toBe("translated");
    expect(result.eventType).toBe(expected[lang].eventType);
    expect(result.description).toBe(expected[lang].description);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Real captured mainnet events
// ══════════════════════════════════════════════════════════════════════════

// ─── Soroswap Router (mainnet CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH) ───

const REAL_SWAP_EVENT: RawEvent = {
  id: "0273119186556911616-0000000004",
  contractId: "CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH",
  topics: [
    "0x0000000e0000000e536f726f73776170526f757465720000",
    "0x0000000f0000000473776170",
  ],
  data: "0x0000001100000001000000030000000f00000007616d6f756e7473000000001000000001000000020000000a000000000000000000000000f2313dad0000000a0000000000000000000000002e19cd420000000f0000000470617468000000100000000100000002000000120000000125b4fcd859aec2fa6348438c489b3c3c10c98b6d21be4fd3cb30cb68953ef9770000001200000001adefce59aee52968f76061d494c2525b75659fa4296a65f499ef29e56477e4960000000f00000002746f00000000001200000000000000005a66ed64895c2e4149de154cc4e131498cafb715b8d8482bd1a26aea08c849ca",
  ledger: 63590516,
  timestamp: 1784697145,
  txHash: "76b1309dea7e799b573e0a2125c8a715cfd6cafc813a7dacbf4c162f4361e300",
};

const REAL_ADD_LIQUIDITY_EVENT: RawEvent = {
  id: "0273223640161644544-0000000005",
  contractId: "CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH",
  topics: [
    "0x0000000e0000000e536f726f73776170526f757465720000",
    "0x0000000f0000000361646400",
  ],
  data: "0x0000001100000001000000070000000f00000008616d6f756e745f610000000a000000000000000000000002540be4000000000f00000008616d6f756e745f620000000a0000000000000000000000005f78b8800000000f000000096c69717569646974790000000000000a000000000000000000000000e415a31e0000000f000000047061697200000012000000012744dc7477e5294c0a952bdc53d194c3c0f41541e03aebd098aee0f3d3f496cb0000000f00000002746f0000000000120000000000000000a722a1027e336d47c7b035d45867862450a53405eb839a90fabdc37799879ce40000000f00000007746f6b656e5f6100000000120000000125b4fcd859aec2fa6348438c489b3c3c10c98b6d21be4fd3cb30cb68953ef9770000000f00000007746f6b656e5f62000000001200000001e6a7d9eb7523006a469aa7483ad1107247443c0d82e62763de670848c4e97c90",
  ledger: 63614836,
  timestamp: 1784833914,
  txHash: "92499c725e7da3f5c6cce5c43e829888eb124deb0e16f976b9d01bb9fa4768f2",
};

const REAL_REMOVE_LIQUIDITY_EVENT: RawEvent = {
  id: "0273223335219187712-0000000006",
  contractId: "CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH",
  topics: [
    "0x0000000e0000000e536f726f73776170526f757465720000",
    "0x0000000f0000000672656d6f76650000",
  ],
  data: "0x0000001100000001000000070000000f00000008616d6f756e745f610000000a000000000000000000000585c130f37e0000000f00000008616d6f756e745f620000000a0000000000000000000000e2729eef5b0000000f000000096c69717569646974790000000000000a00000000000000000000021cfd9ade130000000f000000047061697200000012000000012744dc7477e5294c0a952bdc53d194c3c0f41541e03aebd098aee0f3d3f496cb0000000f00000002746f0000000000120000000000000000a88b8a26b1cbced533202b1a655bf927c54ce8d78fd1af7c0eaf50cd4272e07b0000000f00000007746f6b656e5f6100000000120000000125b4fcd859aec2fa6348438c489b3c3c10c98b6d21be4fd3cb30cb68953ef9770000000f00000007746f6b656e5f62000000001200000001e6a7d9eb7523006a469aa7483ad1107247443c0d82e62763de670848c4e97c90",
  ledger: 63614765,
  timestamp: 1784833514,
  txHash: "d2195d46b55354dd47417ec33c52440cd3aad116764d8a48eb4769ac4ce84d0f",
};

describe("Soroswap Router — real mainnet events", () => {
  it("translates a real swap event (ledger 63590516) in all four locales", () => {
    expectAllLanguages(REAL_SWAP_EVENT, {
      en: { eventType: "Swap", description: "Account [GBNG...UQV7] swapped 406.33 of asset [CAS3...OWMA] for 77.34 of asset [CCW6...MI75]" },
      es: { eventType: "Intercambio", description: "La cuenta [GBNG...UQV7] intercambió 406.33 del activo [CAS3...OWMA] por 77.34 del activo [CCW6...MI75]" },
      fr: { eventType: "Échange", description: "Le compte [GBNG...UQV7] a échangé 406.33 de l&#39;actif [CAS3...OWMA] contre 77.34 de l&#39;actif [CCW6...MI75]" },
      zh: { eventType: "兑换", description: "账户 [GBNG...UQV7] 用 406.33 的资产 [CAS3...OWMA] 兑换了 77.34 的资产 [CCW6...MI75]" },
    });
  });

  it("translates a real add_liquidity event (ledger 63614836) in all four locales", () => {
    expectAllLanguages(REAL_ADD_LIQUIDITY_EVENT, {
      en: { eventType: "Add Liquidity", description: "Account [GCTS...JUF6] added 1000.00 of asset [CAS3...OWMA] and 160.17 of asset [CDTK...BQLV] to the pool, receiving 382.66 liquidity tokens" },
      es: { eventType: "Agregar Liquidez", description: "La cuenta [GCTS...JUF6] agregó 1000.00 del activo [CAS3...OWMA] y 160.17 del activo [CDTK...BQLV] al pool, recibiendo 382.66 tokens de liquidez" },
      fr: { eventType: "Ajout de Liquidité", description: "Le compte [GCTS...JUF6] a ajouté 1000.00 de l&#39;actif [CAS3...OWMA] et 160.17 de l&#39;actif [CDTK...BQLV] au pool, recevant 382.66 jetons de liquidité" },
      zh: { eventType: "添加流动性", description: "账户 [GCTS...JUF6] 向资金池添加了 1000.00 的资产 [CAS3...OWMA] 和 160.17 的资产 [CDTK...BQLV]，获得了 382.66 个流动性代币" },
    });
  });

  it("translates a real remove_liquidity event (ledger 63614765) in all four locales", () => {
    expectAllLanguages(REAL_REMOVE_LIQUIDITY_EVENT, {
      en: { eventType: "Remove Liquidity", description: "Account [GCUI...WGVD] removed 607203.00 of asset [CAS3...OWMA] and 97258.56 of asset [CDTK...BQLV] from the pool, burning 232353.71 liquidity tokens" },
      es: { eventType: "Retirar Liquidez", description: "La cuenta [GCUI...WGVD] retiró 607203.00 del activo [CAS3...OWMA] y 97258.56 del activo [CDTK...BQLV] del pool, quemando 232353.71 tokens de liquidez" },
      fr: { eventType: "Retrait de Liquidité", description: "Le compte [GCUI...WGVD] a retiré 607203.00 de l&#39;actif [CAS3...OWMA] et 97258.56 de l&#39;actif [CDTK...BQLV] du pool, brûlant 232353.71 jetons de liquidité" },
      zh: { eventType: "移除流动性", description: "账户 [GCUI...WGVD] 从资金池移除了 607203.00 的资产 [CAS3...OWMA] 和 97258.56 的资产 [CDTK...BQLV]，销毁了 232353.71 个流动性代币" },
    });
  });
});

// ─── Blend Pool v2 (mainnet FixedV2, CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD) ───

const REAL_SUPPLY_EVENT: RawEvent = {
  id: "0273112250184794112-0000000000",
  contractId: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
  topics: [
    "0x0000000f00000006737570706c790000",
    "0x0000001200000001adefce59aee52968f76061d494c2525b75659fa4296a65f499ef29e56477e496",
    "0x000000120000000168ac4c147c5f6cffc023468308182e8b42aabbfe3247e132c204c0bc2f485ea5",
  ],
  data: "0x0000001000000001000000020000000a00000000000000000000000002faf0800000000a00000000000000000000000002a10d05",
  ledger: 63588901,
  timestamp: 1784688069,
  txHash: "8410538040e4aabe2b5017da04094aac747f1c8435c95c425d3e7d0fef6c93f5",
};

const REAL_WITHDRAW_EVENT: RawEvent = {
  id: "0273112293134233600-0000000000",
  contractId: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
  topics: [
    "0x0000000f000000087769746864726177",
    "0x0000001200000001adefce59aee52968f76061d494c2525b75659fa4296a65f499ef29e56477e496",
    "0x000000120000000168ac4c147c5f6cffc023468308182e8b42aabbfe3247e132c204c0bc2f485ea5",
  ],
  data: "0x0000001000000001000000020000000a000000000000000000000000051bada00000000a00000000000000000000000004819be8",
  ledger: 63588911,
  timestamp: 1784688125,
  txHash: "b77084a4c6f6c13bb6e2610a9dfb23ff9ced63b8b52a474be0fc5b07a28348a2",
};

const REAL_REPAY_EVENT: RawEvent = {
  id: "0273113272387239936-0000000002",
  contractId: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
  topics: [
    "0x0000000f000000057265706179000000",
    "0x000000120000000125b4fcd859aec2fa6348438c489b3c3c10c98b6d21be4fd3cb30cb68953ef977",
    "0x0000001200000001388ecdf0010be17b41e511f40da303e7d8d1b2c183eb4b0d442e759b89716fa6",
  ],
  data: "0x0000001000000001000000020000000a00000000000000000000000004340ffe0000000a000000000000000000000000043282a9",
  ledger: 63589139,
  timestamp: 1784689399,
  txHash: "dc74ff86ca0be6916b873c396ebe8fd0609ea6c7f936139bccc2e96f51b57baf",
};

// A real fill_auction event, but auction_type=2 (interest auction, not a
// user liquidation) — confirms the v2 topic order/data shape decodes
// correctly against live data while auction_type filtering still rejects
// non-liquidation fills.
const REAL_INTEREST_AUCTION_EVENT: RawEvent = {
  id: "0273114436323192832-0000000010",
  contractId: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
  topics: [
    "0x0000000f0000000c66696c6c5f61756374696f6e",
    "0x0000000300000002",
    "0x00000012000000012108f6560dd483654f0e467da99d343a6a4dea0fd202890d5e422edaef4aa26d",
  ],
  data: "0x000000100000000100000003000000120000000159a30a367153209af1ba77ef001d60a3052c4d5cba73173227224fa0d2f1b6060000000a000000000000000000000000000000640000001100000001000000030000000f0000000362696400000000110000000100000001000000120000000125b4fcd859aec2fa6348438c489b3c3c10c98b6d21be4fd3cb30cb68953ef9770000000a000000000000000000000001f103b91e0000000f00000005626c6f636b0000000000000303ca4b370000000f000000036c6f74000000001100000001000000020000001200000001adefce59aee52968f76061d494c2525b75659fa4296a65f499ef29e56477e4960000000a000000000000000000000000745d15b00000001200000001e6a7d9eb7523006a469aa7483ad1107247443c0d82e62763de670848c4e97c900000000a00000000000000000000000007f6906b",
  ledger: 63589410,
  timestamp: 1784690924,
  txHash: "3e4826033dc034b13a174e76e97e4537f312a941ec15832ba47b4eb03be64514",
};

describe("Blend Pool (v2) — real mainnet events", () => {
  it("translates a real supply event (ledger 63588901) in all four locales", () => {
    expectAllLanguages(REAL_SUPPLY_EVENT, {
      en: { eventType: "Supply", description: "Account [CBUK...KZCR] supplied 5.00 of asset [CCW6...MI75] to the pool" },
      es: { eventType: "Suministro", description: "La cuenta [CBUK...KZCR] suministró 5.00 del activo [CCW6...MI75] al pool" },
      fr: { eventType: "Approvisionnement", description: "Le compte [CBUK...KZCR] a fourni 5.00 de l&#39;actif [CCW6...MI75] au pool" },
      zh: { eventType: "存入", description: "账户 [CBUK...KZCR] 向资金池存入了 5.00 的资产 [CCW6...MI75]" },
    });
  });

  it("translates a real withdraw event (ledger 63588911) in all four locales", () => {
    expectAllLanguages(REAL_WITHDRAW_EVENT, {
      en: { eventType: "Withdraw", description: "Account [CBUK...KZCR] withdrew 8.57 of asset [CCW6...MI75] from the pool" },
      es: { eventType: "Retiro", description: "La cuenta [CBUK...KZCR] retiró 8.57 del activo [CCW6...MI75] del pool" },
      fr: { eventType: "Retrait", description: "Le compte [CBUK...KZCR] a retiré 8.57 de l&#39;actif [CCW6...MI75] du pool" },
      zh: { eventType: "提取", description: "账户 [CBUK...KZCR] 从资金池提取了 8.57 的资产 [CCW6...MI75]" },
    });
  });

  it("translates a real repay event (ledger 63589139) in all four locales", () => {
    expectAllLanguages(REAL_REPAY_EVENT, {
      en: { eventType: "Repay", description: "Account [CA4I...NSMH] repaid 7.05 of asset [CAS3...OWMA] to the pool" },
      es: { eventType: "Pago", description: "La cuenta [CA4I...NSMH] pagó 7.05 del activo [CAS3...OWMA] al pool" },
      fr: { eventType: "Remboursement", description: "Le compte [CA4I...NSMH] a remboursé 7.05 de l&#39;actif [CAS3...OWMA] au pool" },
      zh: { eventType: "还款", description: "账户 [CA4I...NSMH] 向资金池偿还了 7.05 的资产 [CAS3...OWMA]" },
    });
  });

  it("does not translate a real interest-auction fill (auction_type=2, ledger 63589410) as a liquidation", () => {
    const result = translateEvent(REAL_INTEREST_AUCTION_EVENT);
    expect(result.status).toBe("cryptic");
    expect(result.eventType).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Schema-accurate fixtures (no live example found within RPC retention)
// ══════════════════════════════════════════════════════════════════════════
//
// borrow and both liquidate generations didn't appear in the ~6,000 events
// sampled across the FixedV2 pool's queryable history. These are built with
// the real stellar-sdk XDR encoders against the verified v1/v2 shapes
// (see blueprints/blend-pool.ts), not captured transactions.

function symbolHex(name: string): string {
  return "0x" + StellarXdr.ScVal.scvSymbol(Buffer.from(name)).toXDR("hex");
}
function addressHex(fillByte: number): string {
  const scAddress = StellarXdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, fillByte));
  return "0x" + StellarXdr.ScVal.scvAddress(scAddress).toXDR("hex");
}
function addressScVal(fillByte: number): StellarXdr.ScVal {
  const scAddress = StellarXdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, fillByte));
  return StellarXdr.ScVal.scvAddress(scAddress);
}
function u32Hex(value: number): string {
  return "0x" + StellarXdr.ScVal.scvU32(value).toXDR("hex");
}
function i128ScVal(value: bigint): StellarXdr.ScVal {
  const hi = value >> 64n;
  const lo = value & 0xffffffffffffffffn;
  const parts = new StellarXdr.Int128Parts({
    hi: StellarXdr.Int64.fromString(hi.toString()),
    lo: StellarXdr.Uint64.fromString(lo.toString()),
  });
  return StellarXdr.ScVal.scvI128(parts);
}
function vecHex(values: StellarXdr.ScVal[]): string {
  return "0x" + StellarXdr.ScVal.scvVec(values).toXDR("hex");
}

const V1_POOL = BLEND_POOL_V1_CONTRACT_IDS[0];
const V2_POOL = BLEND_POOL_V2_CONTRACT_IDS[0];
const ASSET_TOPIC = addressHex(30);
const FROM_TOPIC = addressHex(31);
const USER_TOPIC = addressHex(32);
const FILLER_SCVAL = addressScVal(33);

const BORROW_EVENT: RawEvent = {
  id: "fixture-borrow-1",
  contractId: V2_POOL,
  topics: [symbolHex("borrow"), ASSET_TOPIC, FROM_TOPIC],
  data: vecHex([i128ScVal(250_000_0000n), i128ScVal(258_500_0000n)]),
  ledger: 63600000,
  timestamp: 1784700000,
  txHash: "fixture-borrow-tx",
};

const V1_LIQUIDATE_EVENT: RawEvent = {
  id: "fixture-liquidate-v1-1",
  contractId: V1_POOL,
  topics: [symbolHex("fill_auction"), USER_TOPIC, u32Hex(0)],
  data: vecHex([FILLER_SCVAL, i128ScVal(100n)]),
  ledger: 40000000,
  timestamp: 1700000000,
  txHash: "fixture-liquidate-v1-tx",
};

const V2_LIQUIDATE_EVENT: RawEvent = {
  id: "fixture-liquidate-v2-1",
  contractId: V2_POOL,
  topics: [symbolHex("fill_auction"), u32Hex(0), USER_TOPIC],
  data: vecHex([FILLER_SCVAL, i128ScVal(45n), StellarXdr.ScVal.scvU32(0)]),
  ledger: 63600000,
  timestamp: 1784700000,
  txHash: "fixture-liquidate-v2-tx",
};

describe("Blend Pool — schema-accurate fixtures (borrow, liquidate v1/v2)", () => {
  it("translates a borrow event in all four locales", () => {
    expectAllLanguages(BORROW_EVENT, {
      en: { eventType: "Borrow", description: "Account [CAPR...77LP] borrowed 250.00 of asset [CAPB...4QTN] from the pool" },
      es: { eventType: "Préstamo", description: "La cuenta [CAPR...77LP] pidió prestado 250.00 del activo [CAPB...4QTN] del pool" },
      fr: { eventType: "Emprunt", description: "Le compte [CAPR...77LP] a emprunté 250.00 de l&#39;actif [CAPB...4QTN] au pool" },
      zh: { eventType: "借款", description: "账户 [CAPR...77LP] 从资金池借出了 250.00 的资产 [CAPB...4QTN]" },
    });
  });

  it("translates a v1-shaped liquidate event (topics: user, auction_type) in all four locales", () => {
    expectAllLanguages(V1_LIQUIDATE_EVENT, {
      en: { eventType: "Liquidate", description: "Account [CAQS...DFYJ] liquidated 100% of collateral from account [CAQC...AKAL]" },
      es: { eventType: "Liquidación", description: "La cuenta [CAQS...DFYJ] liquidó 100% de garantía de la cuenta [CAQC...AKAL]" },
      fr: { eventType: "Liquidation", description: "Le compte [CAQS...DFYJ] a liquidé 100% de garantie du compte [CAQC...AKAL]" },
      zh: { eventType: "清算", description: "账户 [CAQS...DFYJ] 清算了账户 [CAQC...AKAL] 的 100% 抵押品" },
    });
  });

  it("translates a v2-shaped liquidate event (topics: auction_type, user) in all four locales", () => {
    expectAllLanguages(V2_LIQUIDATE_EVENT, {
      en: { eventType: "Liquidate", description: "Account [CAQS...DFYJ] liquidated 45% of collateral from account [CAQC...AKAL]" },
      es: { eventType: "Liquidación", description: "La cuenta [CAQS...DFYJ] liquidó 45% de garantía de la cuenta [CAQC...AKAL]" },
      fr: { eventType: "Liquidation", description: "Le compte [CAQS...DFYJ] a liquidé 45% de garantie du compte [CAQC...AKAL]" },
      zh: { eventType: "清算", description: "账户 [CAQS...DFYJ] 清算了账户 [CAQC...AKAL] 的 45% 抵押品" },
    });
  });
});
