/**
 * Translation Blueprint: Stellar Asset Contract (SAC) — Transfer Event
 *
 * The SAC is the canonical token contract on Stellar/Soroban.
 * It emits a "transfer" event whenever tokens move between accounts.
 *
 * Event structure:
 *   topics[0] = Symbol("transfer")
 *   topics[1] = Address(from)
 *   topics[2] = Address(to)
 *   data      = i128(amount)
 */

import { decodeAddress, decodeAmount, interpolateTemplate } from "../decode";
import type { TranslationBlueprint, TranslationResult, RawEvent, Language } from "../types";
import { getTranslation } from "../translations";

/** Known SAC contract IDs mapped to their asset symbol. */
const SAC_CONTRACTS: Record<string, string> = {
  CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC: "USDC",
  CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA: "XLM",
  CAZAQB3D7KSLSNOSQKYD2V4JP5V2Y3B4RDJZRLBFCCIXDCTE3WHSY3UE: "EURC",
  // Demo contract IDs for mock data
  CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM: "USDC",
  CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: "XLM",
};

/** The hex-encoded XDR Symbol for "transfer". */
const TRANSFER_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000074726e73";

/**
 * Attempts to translate a SAC transfer event.
 * Returns null if the event does not match the transfer pattern.
 */
function translateSacTransfer(event: RawEvent, lang: Language): TranslationResult | null {
  if (event.topics.length < 3) return null;
  if (!event.topics[0].includes("74726e73") && event.topics[0] !== TRANSFER_TOPIC) {
    return null;
  }

  const t = getTranslation(lang);
  const symbol = SAC_CONTRACTS[event.contractId] ?? "TOKEN";
  const from = decodeAddress(event.topics[1]);
  const to = decodeAddress(event.topics[2]);
  const amount = decodeAmount(event.data, symbol);

  const description = t.sac.transfer(from.short, amount.formatted, symbol, to.short);

  return {
    description,
    eventType: t.sac.eventTypes.Transfer,
  };
}

/**
 * Creates the SAC Transfer translation blueprint.
 * Handles the standard Stellar Asset Contract transfer event.
 */
export function createSacTransferBlueprint(contractId: string): TranslationBlueprint {
  return {
    contractId,
    contractName: `Stellar Asset Contract (${SAC_CONTRACTS[contractId] ?? "TOKEN"})`,
    translate: translateSacTransfer,
  };
}

/**
 * Creates translation blueprints for all known SAC contracts.
 */
export function createAllSacBlueprints(): TranslationBlueprint[] {
  return Object.keys(SAC_CONTRACTS).map((contractId) =>
    createSacTransferBlueprint(contractId)
  );
}
