/**
 * Translation Blueprint: Soroswap Router
 *
 * The Soroswap Router is the primary decentralised exchange on Stellar/Soroban.
 * It emits events for swaps, add liquidity, and remove liquidity operations.
 *
 * Event structures
 * ────────────────
 * swap          — a token swap was executed.
 *   topics[0] = ("SoroswapRouter", Symbol("swap"))
 *   data      = Vec<Address>(path) + Vec<i128>(amounts) + Address(to)
 *
 * add_liquidity — liquidity was added to a pool.
 *   topics[0] = ("SoroswapRouter", Symbol("add"))
 *   data      = token_a, token_b, pair, amount_a, amount_b, liquidity, to
 *
 * remove_liquidity — liquidity was removed from a pool.
 *   topics[0] = ("SoroswapRouter", Symbol("remove"))
 *   data      = token_a, token_b, pair, amount_a, amount_b, liquidity, to
 */

import { decodeAddress, decodeAmount } from "../core";
import type { TranslationBlueprint, TranslationResult, RawEvent, Language } from "../types";
import { getTranslation } from "../translations";

// ─── Known Soroswap Router contract IDs ───────────────────────────────────────

const SOROSWAP_CONTRACTS: Record<string, string> = {
  // Mainnet: Soroswap Router (source: soroswap/core README)
  CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH: "SoroswapRouter",
  // Testnet / demo contract IDs used by mock data fixtures
  CSOROSWAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM: "SoroswapRouter",
  CSOROSWBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: "SoroswapRouter",
};

// ─── XDR hex topic discriminants ─────────────────────────────────────────────
//
// The Soroswap Router publishes events with a tuple topic
// ("SoroswapRouter", symbol_short!(...)). The first element encodes the
// contract namespace; the second is the short symbol. In raw hex this
// appears as a 32-byte zero-padded XDR Symbol for "swap", "add", or
// "remove". We match on the trailing fragment for robustness.

/** XDR Symbol for "swap" */
const SWAP_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000073776170";

/** XDR Symbol for "add" */
const ADD_TOPIC =
  "0x00000000000000000000000000000000000000000000000000000000616464";

/** XDR Symbol for "remove" */
const REMOVE_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000072656d6f7665";

// ─── Individual event translators ─────────────────────────────────────────────

/**
 * Translates a swap event.
 * Returns null if topics[0] does not identify this event type.
 */
function translateSwap(event: RawEvent, lang: Language): TranslationResult | null {
  const topic0 = event.topics[0];
  if (!topic0) return null;
  if (
    !topic0.includes("73776170") &&
    topic0 !== SWAP_TOPIC
  ) {
    return null;
  }

  const t = getTranslation(lang);
  const data = event.data;

  // Attempt to decode path (Vec<Address>) and amounts (Vec<i128>) from data.
  // Soroswap events are serialized as ScVals. We extract the components
  // heuristically from the hex payload.
  const pathDecoded = decodePath(data);
  const amountsDecoded = decodeAmounts(data);

  const to = decodeAddress(data.slice(-64));

  const pathStr = pathDecoded.length > 0
    ? pathDecoded.map((a) => a.short).join(" → ")
    : "unknown path";

  const amountsStr = amountsDecoded.length > 0
    ? amountsDecoded.map((a) => a.formatted).join(", ")
    : "unknown amounts";

  const description = t.soroswap.swap(pathStr, amountsStr, to.short);

  return {
    description,
    eventType: t.soroswap.eventTypes.Swap,
  };
}

/**
 * Translates an add liquidity event.
 * Returns null if topics[0] does not identify this event type.
 */
function translateAddLiquidity(event: RawEvent, lang: Language): TranslationResult | null {
  const topic0 = event.topics[0];
  if (!topic0) return null;
  if (
    !topic0.includes("616464") &&
    topic0 !== ADD_TOPIC
  ) {
    return null;
  }

  const t = getTranslation(lang);
  const data = event.data;

  const tokenA = decodeAddress(data.slice(0, 64));
  const tokenB = decodeAddress(data.slice(64, 128));
  const pair = decodeAddress(data.slice(128, 192));
  const amountA = decodeAmount(data.slice(192, 256), "TOKEN");
  const amountB = decodeAmount(data.slice(256, 320), "TOKEN");
  const liquidity = decodeAmount(data.slice(320, 384), "TOKEN");
  const to = decodeAddress(data.slice(384, 448));

  const description = t.soroswap.addLiquidity(
    tokenA.short,
    amountA.formatted,
    tokenB.short,
    amountB.formatted,
    liquidity.formatted,
    to.short
  );

  return {
    description,
    eventType: t.soroswap.eventTypes.AddLiquidity,
  };
}

/**
 * Translates a remove liquidity event.
 * Returns null if topics[0] does not identify this event type.
 */
function translateRemoveLiquidity(event: RawEvent, lang: Language): TranslationResult | null {
  const topic0 = event.topics[0];
  if (!topic0) return null;
  if (
    !topic0.includes("72656d6f7665") &&
    topic0 !== REMOVE_TOPIC
  ) {
    return null;
  }

  const t = getTranslation(lang);
  const data = event.data;

  const tokenA = decodeAddress(data.slice(0, 64));
  const tokenB = decodeAddress(data.slice(64, 128));
  const pair = decodeAddress(data.slice(128, 192));
  const amountA = decodeAmount(data.slice(192, 256), "TOKEN");
  const amountB = decodeAmount(data.slice(256, 320), "TOKEN");
  const liquidity = decodeAmount(data.slice(320, 384), "TOKEN");
  const to = decodeAddress(data.slice(384, 448));

  const description = t.soroswap.removeLiquidity(
    tokenA.short,
    amountA.formatted,
    tokenB.short,
    amountB.formatted,
    liquidity.formatted,
    to.short
  );

  return {
    description,
    eventType: t.soroswap.eventTypes.RemoveLiquidity,
  };
}

// ─── Data decoding helpers ────────────────────────────────────────────────────

/**
 * Attempts to decode a Vec<Address> from the data payload.
 * Addresses in Soroban events are 64 hex chars (32 bytes).
 */
function decodePath(hex: string): { publicKey: string; short: string }[] {
  const addresses: { publicKey: string; short: string }[] = [];
  const clean = hex.replace(/^0x/, "");

  // Heuristic: look for consecutive 64-char address patterns.
  // A real Vec<Address> has a type prefix; here we just scan for
  // embedded SCV_ADDRESS blocks.
  const addressRegex = /000000120000000000000000([0-9a-fA-F]{64})/g;
  let match: RegExpExecArray | null;
  while ((match = addressRegex.exec(clean)) !== null) {
    const addrHex = `0x${match[1]}`;
    const decoded = decodeAddress(addrHex);
    addresses.push({ publicKey: decoded.publicKey, short: decoded.short });
  }

  return addresses;
}

/**
 * Attempts to decode a Vec<i128> from the data payload.
 * i128 values are 32 bytes (64 hex chars) big-endian.
 */
function decodeAmounts(hex: string): { raw: bigint; formatted: string; symbol: string }[] {
  const amounts: { raw: bigint; formatted: string; symbol: string }[] = [];
  const clean = hex.replace(/^0x/, "");

  // Heuristic: look for consecutive 64-char i128 values.
  // In a Vec<i128>, each value is 32 bytes.
  const amountRegex = /([0-9a-fA-F]{64})/g;
  let match: RegExpExecArray | null;
  while ((match = amountRegex.exec(clean)) !== null) {
    const amountHex = `0x${match[1]}`;
    const decoded = decodeAmount(amountHex, "TOKEN");
    amounts.push({ raw: decoded.raw, formatted: decoded.formatted, symbol: decoded.symbol });
  }

  return amounts;
}

// ─── Blueprint factory ────────────────────────────────────────────────────────

/**
 * The unified translate function for the Soroswap Router blueprint.
 * Tries each event type in turn; the first match wins.
 */
function translateSoroswapEvent(event: RawEvent, lang: Language): TranslationResult | null {
  return (
    translateSwap(event, lang) ??
    translateAddLiquidity(event, lang) ??
    translateRemoveLiquidity(event, lang)
  );
}

/**
 * Creates a TranslationBlueprint for a single Soroswap Router contract ID.
 */
export function createSoroswapRouterBlueprint(contractId: string): TranslationBlueprint {
  return {
    contractId,
    contractName: SOROSWAP_CONTRACTS[contractId] ?? "Soroswap Router",
    matches: (event: RawEvent) => {
      if (event.contractId !== contractId) return false;
      const topic0 = event.topics[0];
      if (!topic0) return false;
      return (
        topic0.includes("73776170") ||
        topic0.includes("616464") ||
        topic0.includes("72656d6f7665")
      );
    },
    translate: translateSoroswapEvent,
  };
}

/**
 * Creates TranslationBlueprints for every known Soroswap Router contract ID.
 * Call this from buildRegistry() in registry.ts.
 */
export function createAllSoroswapBlueprints(): TranslationBlueprint[] {
  return Object.keys(SOROSWAP_CONTRACTS).map((contractId) =>
    createSoroswapRouterBlueprint(contractId)
  );
}

/**
 * The set of all known Soroswap Router contract IDs, exported for use by tests
 * and the registry so they don't need to duplicate the list.
 */
export const SOROSWAP_CONTRACT_IDS: readonly string[] = Object.keys(SOROSWAP_CONTRACTS);
