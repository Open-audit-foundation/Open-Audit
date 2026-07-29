#!/usr/bin/env node
/**
 * open-audit-cli - Standalone CLI for Testing Translation Registry Blueprints
 *
 * Enables offline testing of translation specifications without deploying the
 * full Open-Audit ecosystem. Parse raw hex event data against draft blueprint
 * files to verify translation output instantly.
 *
 * Usage:
 *   open-audit-cli test --hex <raw_hex_data> --spec <path_to_spec>
 *   open-audit-cli --help
 *
 * Tech Stack: Node.js + Commander.js for CLI framework
 */

import { Command } from "commander";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";
import type {
  RawEvent,
  TranslationBlueprint,
  Language,
  VersionedTranslationBlueprint,
} from "../lib/translator/types";

// ============================================================================
// CLI Configuration
// ============================================================================

const program = new Command();

program
  .name("open-audit-cli")
  .version("1.0.0")
  .description(
    "Standalone CLI for testing Open-Audit translation registry blueprints offline"
  )
  .addHelpText(
    "after",
    `
Examples:
  $ open-audit-cli test --hex 0x1234567890abcdef --spec ./blueprints/my-contract.json
  $ open-audit-cli test -x 0xabcd --spec ./draft/token-swap.yaml --contract CDLZ...YSC
  $ open-audit-cli test --help
  
Documentation:
  https://github.com/your-org/Open-Audit/blob/main/cli/README.md
`
  );

// ============================================================================
// Test Command
// ============================================================================

program
  .command("test")
  .description(
    "Test a raw hex event against a draft translation specification (JSON/YAML)"
  )
  .requiredOption(
    "-x, --hex <hex_data>",
    "Raw hex-encoded event data (topics and data concatenated or just data)"
  )
  .requiredOption(
    "-s, --spec <file_path>",
    "Path to draft blueprint specification file (JSON or YAML)"
  )
  .option(
    "-c, --contract <contract_id>",
    "Stellar contract ID (C...)",
    "CTEST0000000000000000000000000000000000000000000000000000"
  )
  .option(
    "-l, --lang <language>",
    "Output language (en, es, fr, zh)",
    "en"
  )
  .option(
    "-t, --topics <topics...>",
    "Optional: Separate topic hex strings (space-separated)"
  )
  .option(
    "--ledger <number>",
    "Ledger sequence number for versioned blueprints",
    "1000000"
  )
  .option(
    "--verbose",
    "Enable verbose output (includes parsed spec and debug info)",
    false
  )
  .option(
    "--no-telemetry",
    "Disable telemetry (default: no telemetry collected)",
    true
  )
  .action(async (options) => {
    await runTest(options);
  });

// ============================================================================
// Test Execution Logic
// ============================================================================

interface TestOptions {
  hex: string;
  spec: string;
  contract: string;
  lang: string;
  topics?: string[];
  ledger: string;
  verbose: boolean;
  telemetry: boolean;
}

async function runTest(options: TestOptions): Promise<void> {
  try {
    // Step 1: Validate and parse inputs
    const { hex, specPath, contractId, language, topicsArray, ledger, verbose } =
      validateInputs(options);

    if (verbose) {
      console.log("🔍 Open-Audit CLI - Test Mode\n");
      console.log("Configuration:");
      console.log(`  Hex Data:     ${hex}`);
      console.log(`  Spec File:    ${specPath}`);
      console.log(`  Contract ID:  ${contractId}`);
      console.log(`  Language:     ${language}`);
      console.log(`  Ledger:       ${ledger}`);
      console.log(`  Topics:       ${topicsArray.length > 0 ? topicsArray.join(", ") : "(auto-parsed)"}\n`);
    }

    // Step 2: Load and parse specification file
    const blueprint = loadSpecification(specPath, contractId, verbose);

    // Step 3: Create mock RawEvent from hex data
    const event = createMockEvent(hex, contractId, topicsArray, ledger);

    if (verbose) {
      console.log("📋 Raw Event:");
      console.log(JSON.stringify(event, null, 2));
      console.log("");
    }

    // Step 4: Execute translation (pure function, no side effects)
    const result = executeTranslation(event, blueprint, language as Language);

    // Step 5: Output results
    if (result.success) {
      // SUCCESS: Print to stdout
      if (verbose) {
        console.log("✅ Translation Successful\n");
        console.log("Event Type:", result.eventType);
        console.log("Blueprint:", result.blueprintName);
        console.log("Description:");
      }
      console.log(result.description);

      if (verbose && result.schemaVersion) {
        console.log(`\nSchema Version: ${result.schemaVersion}`);
      }

      process.exit(0);
    } else {
      // FAILURE: Print to stderr with non-zero exit
      console.error("❌ Translation Failed\n");
      console.error("Reason:", result.error);

      if (verbose && result.details) {
        console.error("\nDetails:", result.details);
      }

      process.exit(1);
    }
  } catch (error) {
    // Unhandled errors: Print to stderr
    console.error("❌ Fatal Error:\n");
    console.error(error instanceof Error ? error.message : String(error));

    if (options.verbose && error instanceof Error && error.stack) {
      console.error("\nStack Trace:");
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// ============================================================================
// Input Validation
// ============================================================================

function validateInputs(options: TestOptions) {
  // Validate hex data
  const hex = sanitizeHex(options.hex);
  if (!hex) {
    throw new Error("Invalid hex data: Must be a valid hex string (0x... or raw hex)");
  }

  // Validate spec file
  const specPath = resolve(options.spec);
  if (!existsSync(specPath)) {
    throw new Error(`Specification file not found: ${specPath}`);
  }

  // Validate contract ID
  const contractId = options.contract.trim();
  if (!contractId.startsWith("C")) {
    throw new Error(
      "Invalid contract ID: Must start with 'C' (Stellar contract address)"
    );
  }

  // Validate language
  const validLanguages = ["en", "es", "fr", "zh"];
  const language = options.lang.toLowerCase();
  if (!validLanguages.includes(language)) {
    throw new Error(`Invalid language: ${language}. Must be one of: ${validLanguages.join(", ")}`);
  }

  // Parse topics array
  const topicsArray = options.topics || [];

  // Parse ledger number
  const ledger = parseInt(options.ledger, 10);
  if (isNaN(ledger) || ledger < 0) {
    throw new Error("Invalid ledger number: Must be a positive integer");
  }

  return {
    hex,
    specPath,
    contractId,
    language,
    topicsArray,
    ledger,
    verbose: options.verbose,
  };
}

function sanitizeHex(hex: string): string {
  const clean = hex.trim();
  if (!clean) return "";

  // Remove 0x prefix if present
  const withoutPrefix = clean.startsWith("0x") ? clean.slice(2) : clean;

  // Validate hex characters
  if (!/^[0-9a-fA-F]+$/.test(withoutPrefix)) {
    return "";
  }

  return `0x${withoutPrefix}`;
}

// ============================================================================
// Specification Loading
// ============================================================================

interface BlueprintSpec {
  contractId: string;
  contractName: string;
  version?: string;
  validFromLedger?: number;
  events: EventSpec[];
}

interface EventSpec {
  name: string;
  template: string;
  topics?: TopicMatcher[];
  fields: FieldMapping[];
}

interface TopicMatcher {
  index: number;
  equals?: string;
  includes?: string;
  decodedName?: string;
}

interface FieldMapping {
  name: string;
  source: "topic" | "data";
  index?: number;
  type: string;
  format?: string;
}

function loadSpecification(
  filePath: string,
  contractId: string,
  verbose: boolean
): TranslationBlueprint {
  const fileContent = readFileSync(filePath, "utf-8");
  const extension = filePath.toLowerCase();

  let spec: BlueprintSpec;

  try {
    if (extension.endsWith(".json")) {
      spec = JSON.parse(fileContent);
    } else if (extension.endsWith(".yaml") || extension.endsWith(".yml")) {
      spec = parseYaml(fileContent);
    } else {
      throw new Error(
        "Unsupported file format. Must be .json, .yaml, or .yml"
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to parse specification file: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Validate required fields
  if (!spec.contractName) {
    throw new Error("Specification missing required field: contractName");
  }

  if (!spec.events || spec.events.length === 0) {
    throw new Error("Specification missing required field: events (must have at least 1 event)");
  }

  // Override contract ID from spec or CLI
  spec.contractId = spec.contractId || contractId;

  if (verbose) {
    console.log("📄 Loaded Specification:");
    console.log(`  Contract Name: ${spec.contractName}`);
    console.log(`  Version:       ${spec.version || "none"}`);
    console.log(`  Events:        ${spec.events.length}`);
    console.log("");
  }

  // Build blueprint from spec
  return buildBlueprint(spec);
}

function buildBlueprint(spec: BlueprintSpec): VersionedTranslationBlueprint {
  return {
    contractId: spec.contractId,
    contractName: spec.contractName,
    version: spec.version,
    validFromLedger: spec.validFromLedger,

    // Optional matcher for multi-topic requirements
    matches: spec.events.some((e) => e.topics && e.topics.length > 0)
      ? (event: RawEvent) => matchesAnyEvent(event, spec.events)
      : undefined,

    // Translation function
    translate: (event: RawEvent, lang: Language) => {
      for (const eventSpec of spec.events) {
        if (matchesEvent(event, eventSpec)) {
          const description = translateEvent(event, eventSpec, lang);
          return {
            description,
            eventType: eventSpec.name,
          };
        }
      }
      return null; // No matching event
    },
  };
}

function matchesAnyEvent(event: RawEvent, events: EventSpec[]): boolean {
  return events.some((eventSpec) => matchesEvent(event, eventSpec));
}

function matchesEvent(event: RawEvent, eventSpec: EventSpec): boolean {
  if (!eventSpec.topics || eventSpec.topics.length === 0) {
    return true; // No topic requirements, matches all
  }

  for (const topicMatcher of eventSpec.topics) {
    const topic = event.topics[topicMatcher.index];
    if (!topic) return false;

    if (topicMatcher.equals && topic !== topicMatcher.equals) {
      return false;
    }

    if (
      topicMatcher.includes &&
      !topic.toLowerCase().includes(topicMatcher.includes.toLowerCase())
    ) {
      return false;
    }

    if (topicMatcher.decodedName) {
      const decoded = decodeEventName(topic);
      if (decoded !== topicMatcher.decodedName) {
        return false;
      }
    }
  }

  return true;
}

function translateEvent(
  event: RawEvent,
  eventSpec: EventSpec,
  lang: Language
): string {
  const params: Record<string, string> = {};

  // Extract field values from event
  for (const field of eventSpec.fields) {
    let rawValue: string;

    if (field.source === "topic" && field.index !== undefined) {
      rawValue = event.topics[field.index] || "";
    } else {
      rawValue = event.data;
    }

    // Format value based on type
    params[field.name] = formatValue(rawValue, field.type, field.format);
  }

  // Interpolate template
  return interpolateTemplate(eventSpec.template, params);
}

function formatValue(hex: string, type: string, format?: string): string {
  if (!hex) return "unknown";

  switch (type.toLowerCase()) {
    case "address":
      return shortenAddress(decodeAddress(hex));

    case "amount":
    case "u128":
    case "i128":
      return formatAmount(hex, format || "XLM");

    case "string":
      return decodeString(hex);

    case "symbol":
      return decodeSymbol(hex);

    case "hex":
    case "bytes":
      return truncateHex(hex);

    default:
      return hex;
  }
}

// ============================================================================
// Mock Event Creation
// ============================================================================

function createMockEvent(
  hex: string,
  contractId: string,
  topics: string[],
  ledger: number
): RawEvent {
  // If no topics provided, try to parse from hex
  let parsedTopics = topics;
  let dataHex = hex;

  if (topics.length === 0 && hex.length > 130) {
    // Assume first 64 chars (after 0x) is topic[0]
    const withoutPrefix = hex.startsWith("0x") ? hex.slice(2) : hex;
    parsedTopics = [`0x${withoutPrefix.slice(0, 64)}`];
    dataHex = `0x${withoutPrefix.slice(64)}`;
  }

  return {
    id: `mock-${Date.now()}`,
    contractId,
    topics: parsedTopics,
    data: dataHex,
    ledger,
    timestamp: Math.floor(Date.now() / 1000),
    txHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  };
}

// ============================================================================
// Pure Translation Execution (No Side Effects)
// ============================================================================

interface TranslationResult {
  success: boolean;
  description?: string;
  eventType?: string;
  blueprintName?: string;
  schemaVersion?: string;
  error?: string;
  details?: string;
}

function executeTranslation(
  event: RawEvent,
  blueprint: TranslationBlueprint,
  lang: Language
): TranslationResult {
  try {
    // Check if blueprint matches event
    if (blueprint.matches && !blueprint.matches(event)) {
      return {
        success: false,
        error: "Event does not match blueprint criteria",
        details: "The provided hex data does not match any event patterns in the specification",
      };
    }

    // Execute translation
    const result = blueprint.translate(event, lang);

    if (!result) {
      return {
        success: false,
        error: "Blueprint returned null (no matching event pattern)",
        details: "The specification does not contain a pattern that matches this event",
      };
    }

    const schemaVersion = "version" in blueprint && typeof blueprint.version === "string"
      ? blueprint.version
      : undefined;

    return {
      success: true,
      description: result.description,
      eventType: result.eventType,
      blueprintName: blueprint.contractName,
      schemaVersion,
    };
  } catch (error) {
    return {
      success: false,
      error: "Translation execution failed",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Utility Functions (Decoupled from Core)
// ============================================================================

function interpolateTemplate(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return params[key] !== undefined ? params[key] : match;
  });
}

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function decodeAddress(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const seed = clean.slice(0, 8).toUpperCase();
  const tail = clean.slice(-4).toUpperCase();
  return `G${seed}${"A".repeat(48 - seed.length)}${tail}`;
}

function formatAmount(hex: string, symbol: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const value = BigInt(`0x${clean.slice(0, 16) || "0"}`);
  const formatted = (Number(value) / 10_000_000).toFixed(2);
  return `${formatted} ${symbol}`;
}

function decodeString(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  try {
    const bytes = Buffer.from(clean, "hex");
    return bytes.toString("utf8").replace(/\0/g, "");
  } catch {
    return truncateHex(hex);
  }
}

function decodeSymbol(hex: string): string {
  return decodeString(hex);
}

function truncateHex(hex: string, chars: number = 8): string {
  if (hex.length <= chars * 2 + 2) return hex;
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`;
}

function decodeEventName(topicHex: string): string {
  const knownTopics: Record<string, string> = {
    "0x0000000000000000000000000000000000000000000000000000000074726e73": "transfer",
    "0x000000000000000000000000000000000000000000000000000000006d696e74": "mint",
    "0x000000000000000000000000000000000000000000000000000000006275726e": "burn",
  };

  return knownTopics[topicHex] || "unknown";
}

// ============================================================================
// CLI Entry Point
// ============================================================================

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length <= 2) {
  program.help();
}
