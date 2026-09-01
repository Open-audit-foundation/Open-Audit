/**
 * Translation Blueprint: Soroswap Router
 *
 * Soroswap is the primary automated-market-maker DEX on Stellar/Soroban.
 * All liquidity and swap operations are routed through a single Router
 * contract, which re-publishes an event for every add-liquidity,
 * remove-liquidity, and swap call it services.
 *
 * Source: https://github.com/soroswap/core/blob/main/contracts/router/src/event.rs
 *
 * Event structures
 * ────────────────
 * Every Soroswap Router event is a two-part topic tuple followed by a
 * struct-typed data payload (encoded as an XDR Map keyed by field name):
 *
 *   topics[0] = "SoroswapRouter"   — constant contract tag. XDR-encoded as
 *               SCV_STRING on live mainnet events (not SCV_SYMBOL — the
 *               14-character tag exceeds what earlier Soroban SDK versions
 *               allowed for Symbol), so both encodings are accepted below.
 *   topics[1] = Symbol("add" | "remove" | "swap")
 *
 * add / remove (AddLiquidityEvent / RemoveLiquidityEvent):
 *   data = {
 *     token_a: Address, token_b: Address, pair: Address,
 *     amount_a: i128, amount_b: i128, liquidity: i128, to: Address
 *   }
 *
 * swap (SwapEvent):
 *   data = {
 *     path: Vec<Address>,   // first = input token, last = output token
 *     amounts: Vec<i128>,   // parallel to path
 *     to: Address
 *   }
 *
 * Schema history
 * ──────────────
 * Only one field-shape schema has ever existed for this contract: the
 * router's event.rs has had no commits since its initial implementation
 * (github.com/soroswap/core commits touching contracts/router/src/event.rs
 * are all dated 2023-12-06/07, all pre-dating the first mainnet deployment).
 * Consequently no ledger-versioned schema is registered here — see
 * registry.ts's single `register(...)` call for this blueprint.
 *
 * The topics[0] String-vs-Symbol encoding above was found by decoding real
 * mainnet events (router mainnet ledger 63590516 for swap, 63614836 for add,
 * 63614765 for remove) — every one of them failed to translate under the
 * Symbol-only assumption this blueprint previously used.
 */

import { decodeMap, decodeScVal } from "../core";
import type {
  TranslationBlueprint,
  TranslationResult,
  RawEvent,
  Language,
  DecodedMap,
  DecodedVec,
  DecodedScVal,
} from "../types";
import { getTranslation } from "../translations";

// ─── Known Soroswap Router contract IDs ────────────────────────────────────────

/**
 * Contract IDs sourced from the Soroswap core repository's published
 * deployment manifests:
 *   https://github.com/soroswap/core/blob/main/public/mainnet.contracts.json
 *   https://github.com/soroswap/core/blob/main/public/testnet.contracts.json
 */
const SOROSWAP_ROUTER_CONTRACTS: Record<string, string> = {
  // Mainnet Soroswap Router
  CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH: "mainnet",
  // Testnet Soroswap Router
  CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD: "testnet",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Decodes a hex-encoded ScVal Symbol topic to its string name, or null if it isn't a Symbol. */
function decodeSymbolTopic(hex: string | undefined): string | null {
  if (!hex) return null;
  const decoded = decodeScVal(hex);
  return decoded.type === "Symbol" ? decoded.value : null;
}

/**
 * Decodes a hex-encoded ScVal Symbol OR String topic to its string value.
 *
 * The 14-character "SoroswapRouter" contract tag (topics[0]) is XDR-encoded
 * as SCV_STRING on live mainnet events, not SCV_SYMBOL — verified against a
 * real swap event (router mainnet ledger 63590516), whose topics[0] hex
 * begins with the SCV_STRING discriminant `0000000e`. topics[1] (the short
 * "add"/"remove"/"swap" event name) is still SCV_SYMBOL. This helper accepts
 * either encoding so the tag check isn't tied to one representation.
 */
function decodeNameTopic(hex: string | undefined): string | null {
  if (!hex) return null;
  const decoded = decodeScVal(hex);
  return decoded.type === "Symbol" || decoded.type === "String" ? decoded.value : null;
}

/** Looks up a field by name within a decoded Map's entries. */
function getMapField(map: DecodedMap, key: string): DecodedScVal | undefined {
  return map.entries.find((entry) => entry.key.type === "Symbol" && entry.key.value === key)
    ?.value;
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

type EventKind = "add" | "remove" | "swap";

/** Identifies which Soroswap Router event a raw event represents, if any. */
function identifyEventKind(event: RawEvent): EventKind | null {
  if (decodeNameTopic(event.topics[0]) !== "SoroswapRouter") return null;
  const kind = decodeSymbolTopic(event.topics[1]);
  return kind === "add" || kind === "remove" || kind === "swap" ? kind : null;
}

// ─── Individual event translators ─────────────────────────────────────────────

/** Translates an add_liquidity or remove_liquidity event. */
function translateLiquidityEvent(
  event: RawEvent,
  lang: Language,
  kind: "add" | "remove"
): TranslationResult | null {
  const map = decodeMap(event.data);
  const tokenA = getMapField(map, "token_a");
  const tokenB = getMapField(map, "token_b");
  const amountA = getMapField(map, "amount_a");
  const amountB = getMapField(map, "amount_b");
  const liquidity = getMapField(map, "liquidity");
  const to = getMapField(map, "to");
  if (!tokenA || !tokenB || !amountA || !amountB || !to) return null;

  const t = getTranslation(lang);
  const formattedA = formatStroops(amountA.value);
  const formattedB = formatStroops(amountB.value);
  const formattedLiquidity = formatStroops(liquidity?.value);

  const description =
    kind === "add"
      ? t.soroswap.addLiquidity(to.value, formattedA, tokenA.value, formattedB, tokenB.value, formattedLiquidity)
      : t.soroswap.removeLiquidity(to.value, formattedA, tokenA.value, formattedB, tokenB.value, formattedLiquidity);

  return {
    description,
    eventType: kind === "add" ? t.soroswap.eventTypes.AddLiquidity : t.soroswap.eventTypes.RemoveLiquidity,
  };
}

/** Translates a swap event. */
function translateSwap(event: RawEvent, lang: Language): TranslationResult | null {
  const map = decodeMap(event.data);
  const pathField = getMapField(map, "path");
  const amountsField = getMapField(map, "amounts");
  const to = getMapField(map, "to");
  if (!pathField || !amountsField || !to) return null;

  // Nested Vec fields decode to a DecodedVec shape (elements + summary) rather
  // than a scalar DecodedScVal — see core.ts decodeScValInternal's scvVec case.
  const path = pathField as unknown as DecodedVec;
  const amounts = amountsField as unknown as DecodedVec;
  if (!path.elements?.length || !amounts.elements?.length) return null;

  const tokenIn = path.elements[0];
  const tokenOut = path.elements[path.elements.length - 1];
  const amountIn = amounts.elements[0];
  const amountOut = amounts.elements[amounts.elements.length - 1];
  if (!tokenIn || !tokenOut || !amountIn || !amountOut) return null;

  const t = getTranslation(lang);
  const description = t.soroswap.swap(
    to.value,
    formatStroops(amountIn.value),
    tokenIn.value,
    formatStroops(amountOut.value),
    tokenOut.value
  );

  return {
    description,
    eventType: t.soroswap.eventTypes.Swap,
  };
}

// ─── Blueprint factory ────────────────────────────────────────────────────────

/** The unified translate function for the Soroswap Router blueprint. */
function translateSoroswapEvent(event: RawEvent, lang: Language): TranslationResult | null {
  const kind = identifyEventKind(event);
  if (!kind) return null;

  if (kind === "swap") return translateSwap(event, lang);
  return translateLiquidityEvent(event, lang, kind);
}

/**
 * Creates a TranslationBlueprint for a single Soroswap Router contract ID.
 */
export function createSoroswapRouterBlueprint(contractId: string): TranslationBlueprint {
  return {
    contractId,
    contractName: "Soroswap Router",
    matches: (event) => event.contractId === contractId,
    translate: translateSoroswapEvent,
  };
}

/**
 * Creates TranslationBlueprints for every known Soroswap Router contract ID.
 * Call this from buildRegistry() in registry.ts.
 */
export function createAllSoroswapRouterBlueprints(): TranslationBlueprint[] {
  return Object.keys(SOROSWAP_ROUTER_CONTRACTS).map((contractId) =>
    createSoroswapRouterBlueprint(contractId)
  );
}

/**
 * The set of all known Soroswap Router contract IDs, exported for use by
 * tests and the registry so they don't need to duplicate the list.
 */
export const SOROSWAP_ROUTER_CONTRACT_IDS: readonly string[] = Object.keys(
  SOROSWAP_ROUTER_CONTRACTS
);
