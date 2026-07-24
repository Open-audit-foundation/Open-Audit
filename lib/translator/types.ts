/**
 * Core TypeScript interfaces for the Open-Audit Translation Registry.
 *
 * RawEvent  — the raw, hex-encoded event as it comes from the Stellar network.
 * TranslatedEvent — the enriched event with a human-readable description.
 * TranslationBlueprint — the contract-specific translation logic.
 */

/** Supported languages. */
export type Language = "en" | "es" | "fr" | "zh";

/**
 * The shape every locale file under `./translations/` must implement.
 * `generic` covers the registry/decoder fallback and error paths so that
 * unregistered-contract and unknown-event messages are locale-aware rather
 * than hardcoded English strings.
 */
export interface TranslationMap {
  sac: {
    transfer: (from: string, amount: string, symbol: string, to: string) => string;
    mint: (admin: string, amount: string, symbol: string, to: string) => string;
    burn: (from: string, amount: string, symbol: string) => string;
    eventTypes: {
      Transfer: string;
      Mint: string;
      Burn: string;
    };
  };
  sdex: {
    manageBuyOffer: (seller: string, amount: string, buyingAsset: string, sellingAsset: string) => string;
    manageSellOffer: (seller: string, amount: string, sellingAsset: string, buyingAsset: string) => string;
    offerFilled: (seller: string, amount: string, assetSold: string, buyer: string) => string;
    eventTypes: {
      ManageBuyOffer: string;
      ManageSellOffer: string;
      OfferFilled: string;
    };
  };
  generic: {
    /** Fallback contract name shown when an unregistered contract has no custom ABI name. */
    unregisteredContractName: string;
    /** Description shown when the generic decoder could produce a structure for an unregistered contract. */
    unregisteredContractDescription: (payload: string) => string;
    /** Description shown when no blueprint is registered for a contract at all. */
    unknownEventNoBlueprint: (contractId: string, data: string) => string;
    /** Description shown when a contract is registered but no schema applies at the event's ledger. */
    unknownEventNoBlueprintApplicable: (contractId: string, ledger: number, data: string) => string;
    /** Shown by the generic fallback decoder when a String value's declared length overruns the payload. */
    invalidStringLength: string;
    /** Shown by the generic fallback decoder when decoded bytes are not valid UTF-8. */
    invalidUtf8: string;
    /** Shown by the generic fallback decoder when a Symbol value's declared length overruns the payload. */
    invalidSymbolLength: string;
    /** Shown by the generic fallback decoder when an Address's discriminant is unrecognized. */
    unknownAddress: string;
  };
}

/** A raw Soroban contract event as fetched from Horizon/RPC. */
export interface RawEvent {
  /** Unique event identifier (ledger sequence + index). */
  id: string;
  /** The Soroban contract address that emitted this event. */
  contractId: string;
  /**
   * Ordered list of event topics encoded as hex strings.
   * Topic[0] is typically the event name/discriminant.
   */
  topics: string[];
  /** The event payload encoded as a hex string. */
  data: string;
  /** The ledger sequence number this event was emitted in. */
  ledger: number;
  /** Unix timestamp (seconds) of the ledger close time. */
  timestamp: number;
  /** The transaction hash that produced this event. */
  txHash: string;
}

/** The translation status of an event. */
export type TranslationStatus = "translated" | "cryptic" | "pending";

/** A fully processed event ready for display in the UI. */
export interface TranslatedEvent {
  /** The original raw event. */
  raw: RawEvent;
  /** Human-readable translation, or null if no blueprint matched. */
  description: string | null;
  /** Whether the event was successfully translated. */
  status: TranslationStatus;
  /**
   * The name of the blueprint that translated this event,
   * e.g. "Stellar Asset Contract (SAC)" or "Soroswap Router".
   */
  blueprintName: string | null;
  /** Short label for the event type, e.g. "Transfer", "Swap". */
  eventType: string | null;
  /**
   * The schema version label that was applied, if the blueprint is versioned.
   * e.g. "v2". Null when the blueprint has no version label.
   */
  schemaVersion: string | null;
}

/**
 * A translation blueprint for a specific contract.
 * Each blueprint knows how to translate events from one contract.
 */
export interface TranslationBlueprint {
  /** The Soroban contract address this blueprint handles. */
  contractId: string;
  /** Human-readable name for this contract. */
  contractName: string;
  /**
   * Optional event-level matcher used by the registry before calling translate().
   * This lets a blueprint declare multi-topic requirements such as:
   * topics[0] is "transfer" AND topics[2] is a specific status flag.
   */
  matches?: (event: RawEvent) => boolean;
  /**
   * Attempts to translate a raw event into a human-readable string.
   * Returns null if this blueprint cannot handle the given event.
   */
  translate: (event: RawEvent, lang: Language) => TranslationResult | null;
}

/**
 * A versioned schema for a contract, valid for a specific ledger range.
 */
export interface ContractSchema {
  /** Semantic version of this schema (e.g., "1.0.0"). */
  version: string;
  /** The ledger sequence this schema becomes valid from. */
  validFromLedger: number;
  /** The ledger sequence this schema is valid until (inclusive). Null means current. */
  validToLedger: number | null;
  /** The actual translation logic for this version. */
  blueprint: TranslationBlueprint;
  /** Optional metadata about this version (e.g. WASM hash, upgrade tx). */
  metadata?: Record<string, any>;
}

/**
 * The entry in the registry for a single contract, containing all its historical versions.
 */
export interface ContractRegistryEntry {
  contractId: string;
  contractName: string;
  schemas: ContractSchema[];
}

/** A single topic condition within a multi-topic match. */
export interface TopicCriterion {
  /** Ordered topic index to inspect. */
  index: number;
  /** Exact hex/string value expected at the topic index. */
  equals?: string;
  /** Case-insensitive fragment expected inside the topic value. */
  includes?: string;
  /** Event-name string expected after decoding a Symbol topic. */
  decodedName?: string;
}

/** Declarative criteria for matching a raw event before translation. */
export interface EventMatchCriteria {
  /** Contract ID expected for the event. */
  contractId?: string;
  /** All topic criteria must match. */
  topics?: TopicCriterion[];
}

/**
 * A versioned translation blueprint that is only active for events emitted
 * at or after a specific ledger sequence number.
 *
 * Use this when a contract upgrade changes its event schema. Register multiple
 * versioned blueprints for the same contract — the engine will automatically
 * select the most recent schema whose `validFromLedger` is ≤ the event ledger.
 *
 * If `validFromLedger` is omitted (or 0), the schema applies to all ledgers
 * (i.e. it is the original/baseline version).
 */
export interface VersionedTranslationBlueprint extends TranslationBlueprint {
  /**
   * The first ledger sequence number for which this schema is valid.
   * Defaults to 0 (applies from genesis).
   */
  validFromLedger?: number;
  /**
   * Optional human-readable version label, e.g. "v1", "v2.1".
   * Used for display and debugging only.
   */
  version?: string;
}

/** The result returned by a blueprint's translate function. */
export interface TranslationResult {
  /** The human-readable description of the event. */
  description: string;
  /** Short label for the event type. */
  eventType: string;
}

/**
 * A user-supplied ABI for a contract that is NOT (yet) in the global
 * Translation Registry. Parsed from a Soroban ABI JSON file and persisted
 * in the browser so developers can translate their own contracts locally.
 */
export interface CustomAbi {
  /** The deployed Soroban contract address this ABI describes. */
  contractId: string;
  /** Human-readable name for the contract. */
  contractName: string;
  /** The event definitions declared by the ABI. */
  events: CustomAbiEvent[];
}

/** A single event definition within a {@link CustomAbi}. */
export interface CustomAbiEvent {
  /** The event name, e.g. "transfer" or "swap". */
  name: string;
  /**
   * Ordered field definitions describing the event's payload.
   * Fields map positionally to topics[1..] followed by the data value.
   */
  fields: CustomAbiField[];
}

/** A single field within a {@link CustomAbiEvent}. */
export interface CustomAbiField {
  /** The field name, e.g. "from", "to", "amount". */
  name: string;
  /**
   * The Soroban value type. Used to choose how the value is rendered:
   * "address"-like types become shortened keys, numeric types become
   * decimal amounts, and anything else falls back to truncated hex.
   */
  type: string;
}

/** Decoded XDR address. The publicKey is a canonical Stellar address string
 *  starting with G (account) or C (contract). */
export interface DecodedAddress {
  /** The full canonical Stellar address (G... or C...). */
  publicKey: string;
  /** A shortened display version, e.g. "GABC...1234" or "CDLZ...YSC". */
  short: string;
}

/** Decoded token amount with symbol. */
export interface DecodedAmount {
  /** Raw integer value (in stroops or smallest unit). */
  raw: bigint;
  /** Human-readable decimal value. */
  formatted: string;
  /** Token symbol if known. */
  symbol: string;
}

/** Represents a Soroban ScVal type discriminator. */
export type ScValType =
  | "Bool"
  | "Void"
  | "Error"
  | "U32"
  | "I32"
  | "U64"
  | "I64"
  | "Timepoint"
  | "Duration"
  | "U128"
  | "I128"
  | "U256"
  | "I256"
  | "Bytes"
  | "String"
  | "Symbol"
  | "Vec"
  | "Map"
  | "Address"
  | "ContractInstance"
  | "LedgerKeyContractInstance"
  | "LedgerKeyNonce";

/** A decoded ScVal value with its type information. */
export interface DecodedScVal {
  /** The type of the ScVal. */
  type: ScValType;
  /** The decoded value as a string representation. */
  value: string;
  /** Raw hex representation for debugging. */
  hex: string;
}

/** A decoded Map entry (key-value pair). */
export interface DecodedMapEntry {
  /** The decoded key. */
  key: DecodedScVal;
  /** The decoded value. */
  value: DecodedScVal;
}

/** A decoded Soroban Map (ScMap). */
export interface DecodedMap {
  /** The type discriminator. */
  type: "Map";
  /** Array of key-value pairs. */
  entries: DecodedMapEntry[];
  /** Human-readable summary. */
  summary: string;
}

/** A decoded Soroban Vector (ScVec). */
export interface DecodedVec {
  /** The type discriminator. */
  type: "Vec";
  /** Array of decoded values. */
  elements: DecodedScVal[];
  /** Human-readable summary. */
  summary: string;
}

/** A decoded Soroban Enum (ScVal with enum variant). */
export interface DecodedEnum {
  /** The type discriminator. */
  type: "Enum";
  /** The enum variant name/discriminant. */
  variant: string;
  /** The decoded value if the enum has a payload. */
  value?: DecodedScVal;
  /** Human-readable summary. */
  summary: string;
}
