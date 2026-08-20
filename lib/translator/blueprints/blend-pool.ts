/**
 * Translation Blueprint: Blend Protocol — Lending Pool
 *
 * Blend is the primary isolated-lending-pool protocol on Stellar/Soroban.
 * Each deployed pool contract emits an event for every supply, withdraw,
 * borrow, and repay action, plus an event whenever an auction (including a
 * user liquidation) is filled.
 *
 * Sources:
 *   - v1 events (inline in pool actions):
 *     https://github.com/blend-capital/blend-contracts/blob/main/pool/src/pool/actions.rs
 *   - v2 events (centralized PoolEvents module):
 *     https://github.com/blend-capital/blend-contracts-v2/blob/main/pool/src/events.rs
 *   - Deployed contract IDs:
 *     https://github.com/blend-capital/blend-utils/blob/main/mainnet.contracts.json
 *     https://github.com/blend-capital/blend-utils/blob/main/testnet.contracts.json
 *
 * v1 -> v2 schema change
 * ───────────────────────
 * Blend v2 is a distinct set of pool deployments (new contract IDs, not an
 * in-place wasm upgrade of the v1 pools) that introduced a centralized
 * `PoolEvents` module. Diffing the two sources above shows the `supply`,
 * `withdraw`, `borrow`, and `repay` events are byte-for-byte identical
 * between generations, but the auction-fill event's topic order and data
 * shape changed:
 *
 *   v1 fill_auction:
 *     topics = [Symbol("fill_auction"), user: Address, auction_type: u32]
 *     data   = (filler: Address, percent: i128)
 *
 *   v2 fill_auction:
 *     topics = [Symbol("fill_auction"), auction_type: u32, user: Address]
 *     data   = (filler: Address, percent: i128, filled_auction_data: AuctionData)
 *
 * In both generations the second data element is the percentage of the
 * auction filled (e.g. `100` for a full fill), not a token amount — verified
 * against a live mainnet fill_auction(auction_type=2) event on the FixedV2
 * pool (ledger 63589410), which carried a plain value of 100.
 *
 * Only auction_type == 0 (user liquidation) is translated as "Liquidate";
 * bad-debt (1) and interest (2) auctions are protocol-internal and fall
 * through as cryptic.
 *
 * Reserve-action events
 * ──────────────────────
 * supply / withdraw / borrow / repay (identical in v1 and v2):
 *   topics[0] = Symbol(eventName)
 *   topics[1] = Address(asset)   — the reserve asset acted on
 *   topics[2] = Address(from)    — the account performing the action
 *   data      = (amount: i128, bOrDTokens: i128)   — encoded as a 2-element Vec
 */

import { decodeAddress, decodeVec, decodeScVal } from "../core";
import type { TranslationBlueprint, TranslationResult, RawEvent, Language, DecodedVec, DecodedValue } from "../types";
import { getTranslation } from "../translations";

// ─── Known Blend Pool contract IDs ─────────────────────────────────────────────

/**
 * v1 pool deployments (original "Fixed" and "YieldBlox" pools).
 * Source: blend-capital/blend-utils mainnet.contracts.json, keys "Fixed"/"YieldBlox".
 */
const BLEND_POOL_V1_CONTRACTS: Record<string, string> = {
  CDVQVKOY2YSXS2IC7KN6MNASSHPAO7UN2UR2ON4OI2SKMFJNVAMDX6DP: "mainnet", // Fixed (v1)
  CBP7NO6F7FRDHSOFQBT2L2UWYIZ2PU76JKVRYAQTG3KZSQLYAOKIF2WB: "mainnet", // YieldBlox (v1)
};

/**
 * v2 pool deployments ("FixedV2", "YieldBloxV2", and the testnet "TestnetV2" pool).
 * Source: blend-capital/blend-utils mainnet.contracts.json / testnet.contracts.json,
 * keys "FixedV2"/"YieldBloxV2"/"TestnetV2".
 */
const BLEND_POOL_V2_CONTRACTS: Record<string, string> = {
  CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD: "mainnet", // FixedV2
  CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS: "mainnet", // YieldBloxV2
  CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF: "testnet", // TestnetV2
};

export type BlendPoolSchemaVersion = "v1" | "v2";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Decodes a hex-encoded ScVal Symbol topic to its string name, or null if it isn't a Symbol. */
function decodeSymbolTopic(hex: string | undefined): string | null {
  if (!hex) return null;
  const decoded = decodeScVal(hex);
  return decoded.type === "Symbol" ? decoded.value : null;
}

/** Decodes a hex-encoded ScVal U32 topic, or null if it isn't a U32. */
function decodeU32Topic(hex: string | undefined): number | null {
  if (!hex) return null;
  const decoded = decodeScVal(hex);
  return decoded.type === "U32" ? Number(decoded.value) : null;
}

/** Extracts the scalar `.value` from a decoded ScVal, or undefined for Map/Vec results. */
function scalarValue(decoded: DecodedValue | undefined): string | undefined {
  return decoded && "value" in decoded ? decoded.value : undefined;
}

/** Formats a raw stroop-denominated integer string as a decimal amount. */
function formatStroops(raw: string | undefined): string {
  if (!raw) return "0.00";
  try {
    return (Number(BigInt(raw)) / 10_000_000).toFixed(2);
  } catch {
    return "0.00";
  }
}

/** Formats a raw auction fill-percentage value (e.g. "100" -> "100%"). */
function formatPercent(raw: string | undefined): string {
  if (!raw) return "0%";
  try {
    return `${BigInt(raw).toString()}%`;
  } catch {
    return "0%";
  }
}

const RESERVE_ACTION_EVENTS = new Set(["supply", "withdraw", "borrow", "repay"]);

// ─── Individual event translators ─────────────────────────────────────────────

/** Translates a supply, withdraw, borrow, or repay event. Identical shape in v1 and v2. */
function translateReserveAction(event: RawEvent, lang: Language): TranslationResult | null {
  const eventName = decodeSymbolTopic(event.topics[0]);
  if (!eventName || !RESERVE_ACTION_EVENTS.has(eventName)) return null;
  if (event.topics.length < 3) return null;

  const asset = decodeAddress(event.topics[1] ?? "0x00");
  const from = decodeAddress(event.topics[2] ?? "0x00");
  const data = decodeVec(event.data) as unknown as DecodedVec;
  const amount = data.elements?.[0];
  if (!amount) return null;

  const t = getTranslation(lang);
  const formattedAmount = formatStroops(scalarValue(amount));

  switch (eventName) {
    case "supply":
      return { description: t.blend.supply(from.short, formattedAmount, asset.short), eventType: t.blend.eventTypes.Supply };
    case "withdraw":
      return { description: t.blend.withdraw(from.short, formattedAmount, asset.short), eventType: t.blend.eventTypes.Withdraw };
    case "borrow":
      return { description: t.blend.borrow(from.short, formattedAmount, asset.short), eventType: t.blend.eventTypes.Borrow };
    case "repay":
      return { description: t.blend.repay(from.short, formattedAmount, asset.short), eventType: t.blend.eventTypes.Repay };
    default:
      return null;
  }
}

/** Translates a fill_auction event representing a user liquidation (auction_type 0). */
function translateLiquidate(
  event: RawEvent,
  lang: Language,
  schemaVersion: BlendPoolSchemaVersion
): TranslationResult | null {
  if (decodeSymbolTopic(event.topics[0]) !== "fill_auction") return null;
  if (event.topics.length < 3) return null;

  // v1 topics: [fill_auction, user: Address, auction_type: u32]
  // v2 topics: [fill_auction, auction_type: u32, user: Address]
  const userTopic = schemaVersion === "v1" ? event.topics[1] : event.topics[2];
  const auctionTypeTopic = schemaVersion === "v1" ? event.topics[2] : event.topics[1];

  if (decodeU32Topic(auctionTypeTopic) !== 0) return null;

  const user = decodeAddress(userTopic ?? "0x00");
  const data = decodeVec(event.data) as unknown as DecodedVec;
  const fillerField = data.elements?.[0];
  const percentField = data.elements?.[1];
  if (!fillerField || !percentField) return null;

  const t = getTranslation(lang);
  const description = t.blend.liquidate(
    user.short,
    scalarValue(fillerField) ?? "unknown",
    formatPercent(scalarValue(percentField))
  );

  return {
    description,
    eventType: t.blend.eventTypes.Liquidate,
  };
}

// ─── Blueprint factory ────────────────────────────────────────────────────────

/** The unified translate function for a Blend Pool blueprint of a given schema generation. */
function translateBlendEvent(event: RawEvent, lang: Language, schemaVersion: BlendPoolSchemaVersion): TranslationResult | null {
  return translateReserveAction(event, lang) ?? translateLiquidate(event, lang, schemaVersion);
}

/**
 * Creates a TranslationBlueprint for a single Blend Pool contract ID.
 * `schemaVersion` selects the fill_auction topic order / data shape to apply
 * ("v2" is the default since it's the shape used by every currently-active
 * mainnet and testnet pool).
 */
export function createBlendPoolBlueprint(
  contractId: string,
  schemaVersion: BlendPoolSchemaVersion = "v2"
): TranslationBlueprint {
  return {
    contractId,
    contractName: "Blend Lending Pool",
    matches: (event) => event.contractId === contractId,
    translate: (event, lang) => translateBlendEvent(event, lang, schemaVersion),
  };
}

/**
 * Creates TranslationBlueprints for every known v1-generation Blend Pool
 * contract ID (the original "Fixed" and "YieldBlox" pools).
 * Call this from buildRegistry() in registry.ts.
 */
export function createAllBlendPoolV1Blueprints(): TranslationBlueprint[] {
  return Object.keys(BLEND_POOL_V1_CONTRACTS).map((contractId) => createBlendPoolBlueprint(contractId, "v1"));
}

/**
 * Creates TranslationBlueprints for every known v2-generation Blend Pool
 * contract ID ("FixedV2", "YieldBloxV2", and the testnet "TestnetV2" pool).
 * Call this from buildRegistry() in registry.ts.
 */
export function createAllBlendPoolV2Blueprints(): TranslationBlueprint[] {
  return Object.keys(BLEND_POOL_V2_CONTRACTS).map((contractId) => createBlendPoolBlueprint(contractId, "v2"));
}

/** The set of all known v1-generation Blend Pool contract IDs. */
export const BLEND_POOL_V1_CONTRACT_IDS: readonly string[] = Object.keys(BLEND_POOL_V1_CONTRACTS);

/** The set of all known v2-generation Blend Pool contract IDs. */
export const BLEND_POOL_V2_CONTRACT_IDS: readonly string[] = Object.keys(BLEND_POOL_V2_CONTRACTS);

/**
 * The set of every known Blend Pool contract ID across both schema
 * generations, exported for use by tests and the registry so they don't
 * need to duplicate the list.
 */
export const BLEND_POOL_CONTRACT_IDS: readonly string[] = [
  ...BLEND_POOL_V1_CONTRACT_IDS,
  ...BLEND_POOL_V2_CONTRACT_IDS,
];
