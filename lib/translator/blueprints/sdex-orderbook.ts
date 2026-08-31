/**
 * Translation Blueprint: Stellar SDEX Classic Order Book
 *
 * The Stellar Decentralised Exchange (SDEX) is built directly into the
 * Stellar protocol. It emits Soroban-compatible events whenever an offer
 * is created, updated, cancelled, or filled via the classic order book.
 *
 * Event structures
 * ────────────────
 * manage_buy_offer  — a buy-side offer was created, updated, or cancelled.
 *   topics[0] = Symbol("manage_buy_offer")
 *   topics[1] = Address(seller)           — the account managing the offer
 *   topics[2] = Address(buying_asset)     — asset being bought (contract ID or native)
 *   topics[3] = Address(selling_asset)    — asset being sold (contract ID or native)
 *   data      = i128(buy_amount)          — amount of buying_asset desired
 *
 * manage_sell_offer — a sell-side offer was created, updated, or cancelled.
 *   topics[0] = Symbol("manage_sell_offer")
 *   topics[1] = Address(seller)           — the account managing the offer
 *   topics[2] = Address(selling_asset)    — asset being sold
 *   topics[3] = Address(buying_asset)     — asset being bought
 *   data      = i128(sell_amount)         — amount of selling_asset offered
 *
 * offer_filled      — an existing offer was (fully or partially) filled.
 *   topics[0] = Symbol("offer_filled")
 *   topics[1] = Address(seller)           — offer owner whose offer was filled
 *   topics[2] = Address(buyer)            — counterparty who filled the offer
 *   topics[3] = Address(asset_sold)       — asset that left the seller
 *   data      = i128(amount_sold)         — amount of asset_sold that moved
 */

import { decodeAddress, decodeAmount } from "../core";
import type { TranslationBlueprint, TranslationResult, RawEvent, Language } from "../types";
import { getTranslation } from "../translations";

// ─── Known SDEX contract IDs ──────────────────────────────────────────────────

/**
 * SDEX is a protocol-level feature of Stellar, not a user-deployed contract.
 * The canonical contract IDs below are the well-known Soroban host-function
 * wrappers that emit events on behalf of the classic order book.
 *
 * Mainnet contract IDs sourced from the Stellar protocol specification and
 * the Stellar Ecosystem Proposal SEP-0042 registry.
 */
const SDEX_CONTRACTS: Record<string, string> = {
  // Mainnet: well-known SDEX bridge / liquidity-pool manager
  CBZVSNVB55ANF3QABEQOATF36GZOS23OKNTONEAXIBRXBOLJDKZHRFID: "SDEX",
  // Mainnet: additional SDEX-specific router contract
  CCZYWKX2JOCMFKEBXSYG4XWRMHKBFKDOUBZWEMYGNKHTECYNZP2LKIV: "SDEX",
  // Testnet / demo contract IDs used by mock data fixtures
  CSDEXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM: "SDEX",
  CSDEXBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: "SDEX",
};

// ─── XDR hex topic discriminants ─────────────────────────────────────────────
//
// Each Soroban Symbol is XDR-encoded. The relevant byte fragment that makes
// each name unique is shown in the `includes()` check below:
//
//  "manage_buy_offer"  → hex fragment: 6d616e6167655f6275795f6f66666572
//  "manage_sell_offer" → hex fragment: 6d616e6167655f73656c6c5f6f66666572
//  "offer_filled"      → hex fragment: 6f666665725f66696c6c6564
//
// The full 32-byte zero-padded XDR Symbol representations:

/** XDR Symbol for "manage_buy_offer" */
const MANAGE_BUY_OFFER_TOPIC =
  "0x000000000000000000000000000000006d616e6167655f6275795f6f66666572";

/** XDR Symbol for "manage_sell_offer" */
const MANAGE_SELL_OFFER_TOPIC =
  "0x0000000000000000000000000000006d616e6167655f73656c6c5f6f66666572";

/** XDR Symbol for "offer_filled" */
const OFFER_FILLED_TOPIC =
  "0x00000000000000000000000000000000000000006f666665725f66696c6c6564";

// ─── Individual event translators ─────────────────────────────────────────────

/**
 * Translates a manage_buy_offer event.
 * Returns null if topics[0] does not identify this event type.
 */
function translateManageBuyOffer(event: RawEvent, lang: Language): TranslationResult | null {
  const topic0 = event.topics[0];
  if (!topic0) return null;
  if (
    !topic0.includes("6d616e6167655f6275795f6f66666572") &&
    topic0 !== MANAGE_BUY_OFFER_TOPIC
  ) {
    return null;
  }

  const t = getTranslation(lang);
  const seller = decodeAddress(event.topics[1] ?? "0x00");
  const buyingAsset = decodeAddress(event.topics[2] ?? "0x00");
  const sellingAsset = decodeAddress(event.topics[3] ?? "0x00");
  const amount = decodeAmount(event.data, "TOKEN");

  const description = t.sdex.manageBuyOffer(
    seller.short,
    amount.formatted,
    buyingAsset.short,
    sellingAsset.short
  );

  return {
    description,
    eventType: t.sdex.eventTypes.ManageBuyOffer,
  };
}

/**
 * Translates a manage_sell_offer event.
 * Returns null if topics[0] does not identify this event type.
 */
function translateManageSellOffer(event: RawEvent, lang: Language): TranslationResult | null {
  const topic0 = event.topics[0];
  if (!topic0) return null;
  if (
    !topic0.includes("6d616e6167655f73656c6c5f6f66666572") &&
    topic0 !== MANAGE_SELL_OFFER_TOPIC
  ) {
    return null;
  }

  const t = getTranslation(lang);
  const seller = decodeAddress(event.topics[1] ?? "0x00");
  const sellingAsset = decodeAddress(event.topics[2] ?? "0x00");
  const buyingAsset = decodeAddress(event.topics[3] ?? "0x00");
  const amount = decodeAmount(event.data, "TOKEN");

  const description = t.sdex.manageSellOffer(
    seller.short,
    amount.formatted,
    sellingAsset.short,
    buyingAsset.short
  );

  return {
    description,
    eventType: t.sdex.eventTypes.ManageSellOffer,
  };
}

/**
 * Translates an offer_filled event.
 * Returns null if topics[0] does not identify this event type.
 */
function translateOfferFilled(event: RawEvent, lang: Language): TranslationResult | null {
  const topic0 = event.topics[0];
  if (!topic0) return null;
  if (
    !topic0.includes("6f666665725f66696c6c6564") &&
    topic0 !== OFFER_FILLED_TOPIC
  ) {
    return null;
  }

  const t = getTranslation(lang);
  const seller = decodeAddress(event.topics[1] ?? "0x00");
  const buyer = decodeAddress(event.topics[2] ?? "0x00");
  const assetSold = decodeAddress(event.topics[3] ?? "0x00");
  const amountSold = decodeAmount(event.data, "TOKEN");

  const description = t.sdex.offerFilled(
    seller.short,
    amountSold.formatted,
    assetSold.short,
    buyer.short
  );

  return {
    description,
    eventType: t.sdex.eventTypes.OfferFilled,
  };
}

// ─── Blueprint factory ────────────────────────────────────────────────────────

/**
 * The unified translate function for the SDEX blueprint.
 * Tries each event type in turn; the first match wins.
 */
function translateSdexEvent(event: RawEvent, lang: Language): TranslationResult | null {
  return (
    translateManageBuyOffer(event, lang) ??
    translateManageSellOffer(event, lang) ??
    translateOfferFilled(event, lang)
  );
}

/**
 * Creates a TranslationBlueprint for a single SDEX contract ID.
 */
export function createSdexOrderbookBlueprint(contractId: string): TranslationBlueprint {
  return {
    contractId,
    contractName: "Stellar SDEX — Classic Order Book",
    translate: translateSdexEvent,
  };
}

/**
 * Creates TranslationBlueprints for every known SDEX contract ID.
 * Call this from buildRegistry() in registry.ts.
 */
export function createAllSdexBlueprints(): TranslationBlueprint[] {
  return Object.keys(SDEX_CONTRACTS).map((contractId) =>
    createSdexOrderbookBlueprint(contractId)
  );
}

/**
 * The set of all known SDEX contract IDs, exported for use by tests and the
 * registry so they don't need to duplicate the list.
 */
export const SDEX_CONTRACT_IDS: readonly string[] = Object.keys(SDEX_CONTRACTS);
