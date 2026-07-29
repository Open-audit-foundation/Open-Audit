/**
 * Translation Blueprint: Blend Protocol — Lending Pool
 *
 * Blend is the primary isolated-lending-pool protocol on Stellar/Soroban.
 * Each deployed pool contract emits an event for every supply, withdraw,
 * borrow, and repay action, plus an event whenever an auction (including a
 * user liquidation) is filled.
 *
 * Source: https://github.com/blend-capital/blend-contracts/blob/main/pool/src/pool/actions.rs
 *
 * Event structures
 * ────────────────
 * supply / withdraw / borrow / repay:
 *   topics[0] = Symbol(eventName)
 *   topics[1] = Address(asset)   — the reserve asset acted on
 *   topics[2] = Address(from)    — the account performing the action
 *   data      = (amount: i128, bOrDTokens: i128)   — encoded as a 2-element Vec
 *
 * liquidate (fill_auction, auction_type 0 — user liquidation):
 *   topics[0] = Symbol("fill_auction")
 *   topics[1] = Address(user)          — the account being liquidated
 *   topics[2] = u32(auction_type)      — 0 = user liquidation
 *   data      = (filler: Address, amount: i128)   — encoded as a 2-element Vec
 *
 * Only auction_type == 0 is translated as "Liquidate"; bad-debt (1) and
 * interest (2) auctions are protocol-internal and fall through as cryptic.
 */

import { decodeAddress, decodeVec, decodeScVal } from "../core";
import type { TranslationBlueprint, TranslationResult, RawEvent, Language, DecodedVec } from "../types";
import { getTranslation } from "../translations";

// ─── Known Blend Pool contract IDs ─────────────────────────────────────────────

/**
 * Contract IDs sourced from the Blend Capital deployment manifests:
 *   https://github.com/blend-capital/blend-utils/blob/main/mainnet.contracts.json
 *   https://github.com/blend-capital/blend-utils/blob/main/testnet.contracts.json
 */
const BLEND_POOL_CONTRACTS: Record<string, string> = {
  // Mainnet: Fixed pool (V2)
  CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD: "mainnet",
  // Mainnet: YieldBlox pool (V2)
  CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS: "mainnet",
  // Testnet: Testnet pool (V2)
  CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF: "testnet",
};

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

/** Formats a raw stroop-denominated integer string as a decimal amount. */
function formatStroops(raw: string | undefined): string {
  if (!raw) return "0.00";
  try {
    return (Number(BigInt(raw)) / 10_000_000).toFixed(2);
  } catch {
    return "0.00";
  }
}

const RESERVE_ACTION_EVENTS = new Set(["supply", "withdraw", "borrow", "repay"]);

// ─── Individual event translators ─────────────────────────────────────────────

/** Translates a supply, withdraw, borrow, or repay event. */
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
  const formattedAmount = formatStroops(amount.value);

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
function translateLiquidate(event: RawEvent, lang: Language): TranslationResult | null {
  if (decodeSymbolTopic(event.topics[0]) !== "fill_auction") return null;
  if (event.topics.length < 3) return null;
  if (decodeU32Topic(event.topics[2]) !== 0) return null;

  const user = decodeAddress(event.topics[1] ?? "0x00");
  const data = decodeVec(event.data) as unknown as DecodedVec;
  const fillerField = data.elements?.[0];
  const amountField = data.elements?.[1];
  if (!fillerField || !amountField) return null;

  const t = getTranslation(lang);
  const description = t.blend.liquidate(user.short, fillerField.value, formatStroops(amountField.value));

  return {
    description,
    eventType: t.blend.eventTypes.Liquidate,
  };
}

// ─── Blueprint factory ────────────────────────────────────────────────────────

/** The unified translate function for the Blend Pool blueprint. */
function translateBlendEvent(event: RawEvent, lang: Language): TranslationResult | null {
  return translateReserveAction(event, lang) ?? translateLiquidate(event, lang);
}

/**
 * Creates a TranslationBlueprint for a single Blend Pool contract ID.
 */
export function createBlendPoolBlueprint(contractId: string): TranslationBlueprint {
  return {
    contractId,
    contractName: "Blend Lending Pool",
    matches: (event) => event.contractId === contractId,
    translate: translateBlendEvent,
  };
}

/**
 * Creates TranslationBlueprints for every known Blend Pool contract ID.
 * Call this from buildRegistry() in registry.ts.
 */
export function createAllBlendPoolBlueprints(): TranslationBlueprint[] {
  return Object.keys(BLEND_POOL_CONTRACTS).map((contractId) => createBlendPoolBlueprint(contractId));
}

/**
 * The set of all known Blend Pool contract IDs, exported for use by tests
 * and the registry so they don't need to duplicate the list.
 */
export const BLEND_POOL_CONTRACT_IDS: readonly string[] = Object.keys(BLEND_POOL_CONTRACTS);
