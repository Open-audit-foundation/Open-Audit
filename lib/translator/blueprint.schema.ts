import { z } from "zod";

/**
 * Zod Schema for RawEvent (input to matches and translate functions).
 */
export const RawEventSchema = z.object({
  id: z.string(),
  contractId: z.string().regex(/^C[A-Z0-9]{55,57}$/i, {
    message: "contractId must be a valid 56-to-58-character Stellar contract ID starting with C",
  }),
  topics: z.array(z.string()),
  data: z.string(),
  ledger: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  txHash: z.string(),
});

/**
 * Zod Schema for supported languages.
 */
export const LanguageSchema = z.union([
  z.literal("en"),
  z.literal("es"),
  z.literal("fr"),
  z.literal("zh"),
]);

/**
 * Zod Schema for TranslationResult (return type of translate function).
 */
export const TranslationResultSchema = z.object({
  description: z.string().min(1, { message: "description must be a non-empty string" }),
  eventType: z.string().min(1, { message: "eventType must be a non-empty string" }),
});

/**
 * Zod Schema for a TranslationBlueprint and VersionedTranslationBlueprint.
 */
export const BlueprintSchema = z.object({
  contractId: z.string().regex(/^C[A-Z0-9]{55,57}$/i, {
    message: "contractId must be a valid 56-to-58-character Stellar contract ID starting with C",
  }),
  contractName: z.string().min(1, {
    message: "contractName must be a non-empty string",
  }),
  matches: z.function().optional(),
  translate: z.function(),
  validFromLedger: z.number().int().nonnegative().optional(),
  version: z.string().min(1).optional(),
});
