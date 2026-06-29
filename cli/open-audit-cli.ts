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
 * Spec format:
 *   The --spec file must conform to the BlueprintSpec type defined in
 *   lib/translator/blueprint-spec.ts. This is the SAME type and validation
 *   logic used by the production registry, guaranteeing that a spec which
 *   passes CLI testing will behave identically once registered for real.
 *
 * Tech Stack: Node.js + Commander.js
 */

import { Command } from "commander";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";

// Shared spec type, validator, and builder — same code path as production registry
import {
  validateBlueprintSpec,
  buildBlueprintFromSpec,
  BlueprintSpecValidationError,
} from "../lib/translator/blueprint-spec";

import type { RawEvent, Language } from "../lib/translator/types";

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

Spec format:
  The --spec file uses the BlueprintSpec schema defined in
  lib/translator/blueprint-spec.ts — the same type and validation the
  production registry uses. A spec that passes here will behave identically
  in production.

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
  .option("-l, --lang <language>", "Output language (en, es, fr, zh)", "en")
  .option(
    "-t, --topics <topics...>",
    "Optional: Separate topic hex strings (space-separated)"
  )
  .option(
    "--ledger <number>",
    "Ledger sequence number for versioned blueprints",
    "1000000"
  )
  .option("--verbose", "Enable verbose output", false)
  .option("--no-telemetry", "Disable telemetry (default: no telemetry collected)", true)
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
    const { hex, specPath, contractId, language, topicsArray, ledger, verbose } =
      validateInputs(options);

    if (verbose) {
      console.log("Open-Audit CLI - Test Mode\n");
      console.log(`  Hex Data:    ${hex}`);
      console.log(`  Spec File:   ${specPath}`);
      console.log(`  Contract ID: ${contractId}`);
      console.log(`  Language:    ${language}`);
      console.log(`  Ledger:      ${ledger}\n`);
    }

    // Load spec using shared validator — same code path as production registry
    const blueprint = loadSpecification(specPath, contractId, verbose);

    // Build mock event
    const event = createMockEvent(hex, contractId, topicsArray, ledger);

    if (verbose) {
      console.log("Raw Event:");
      console.log(JSON.stringify(event, null, 2));
      console.log("");
    }

    // Execute translation using the shared builder output
    const result = executeTranslation(event, blueprint, language as Language);

    if (result.success) {
      if (verbose) {
        console.log("Translation Successful\n");
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
      console.error("Translation Failed\n");
      console.error("Reason:", result.error);
      if (verbose && result.details) {
        console.error("\nDetails:", result.details);
      }
      process.exit(1);
    }
  } catch (error) {
    console.error("Fatal Error:\n");
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
  const hex = sanitizeHex(options.hex);
  if (!hex) {
    throw new Error("Invalid hex data: Must be a valid hex string");
  }

  const specPath = resolve(options.spec);
  if (!existsSync(specPath)) {
    throw new Error(`Specification file not found: ${specPath}`);
  }

  const contractId = options.contract.trim();
  if (!contractId.startsWith("C")) {
    throw new Error("Invalid contract ID: Must start with 'C'");
  }

  const validLanguages = ["en", "es", "fr", "zh"];
  const language = options.lang.toLowerCase();
  if (!validLanguages.includes(language)) {
    throw new Error(`Invalid language: ${language}. Must be one of: ${validLanguages.join(", ")}`);
  }

  const topicsArray = options.topics || [];
  const ledger = parseInt(options.ledger, 10);
  if (isNaN(ledger) || ledger < 0) {
    throw new Error("Invalid ledger number: Must be a positive integer");
  }

  return { hex, specPath, contractId, language, topicsArray, ledger, verbose: options.verbose };
}

function sanitizeHex(hex: string): string {
  const clean = hex.trim();
  if (!clean) return "";
  const withoutPrefix = clean.startsWith("0x") ? clean.slice(2) : clean;
  if (!/^[0-9a-fA-F]+$/.test(withoutPrefix)) return "";
  return `0x${withoutPrefix}`;
}

// ============================================================================
// Specification Loading — uses shared validator from lib/translator/blueprint-spec.ts
// ============================================================================

function loadSpecification(
  filePath: string,
  contractId: string,
  verbose: boolean
) {
  const content = readFileSync(filePath, "utf-8");
  const ext = filePath.toLowerCase();

  let raw: unknown;
  try {
    raw = ext.endsWith(".json") ? JSON.parse(content) : parseYaml(content);
  } catch (err) {
    throw new Error(
      `Failed to parse spec file: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Inject contractId from CLI flag if spec omits it
  if (raw && typeof raw === "object" && !(raw as Record<string, unknown>).contractId) {
    (raw as Record<string, unknown>).contractId = contractId;
  }

  // Shared validation — identical to what registry.ts runs
  let spec;
  try {
    spec = validateBlueprintSpec(raw);
  } catch (err) {
    if (err instanceof BlueprintSpecValidationError) {
      throw new Error(`Invalid blueprint spec: ${err.message}`);
    }
    throw err;
  }

  if (verbose) {
    console.log("Loaded Specification:");
    console.log(`  Contract Name: ${spec.contractName}`);
    console.log(`  Version:       ${spec.version ?? "none"}`);
    console.log(`  Events:        ${spec.events.length}\n`);
  }

  // Shared builder — identical to what registry.ts uses
  return buildBlueprintFromSpec(spec);
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
  let parsedTopics = topics;
  let dataHex = hex;

  if (topics.length === 0 && hex.length > 130) {
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
// Translation Execution
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
  blueprint: ReturnType<typeof buildBlueprintFromSpec>,
  lang: Language
): TranslationResult {
  try {
    if (blueprint.matches && !blueprint.matches(event)) {
      return {
        success: false,
        error: "Event does not match blueprint criteria",
        details: "No event pattern in the spec matched the provided hex data",
      };
    }

    const result = blueprint.translate(event, lang);
    if (!result) {
      return {
        success: false,
        error: "Blueprint returned null (no matching event pattern)",
        details: "The spec does not contain a pattern that matches this event",
      };
    }

    return {
      success: true,
      description: result.description,
      eventType: result.eventType,
      blueprintName: blueprint.contractName,
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
// Entry Point
// ============================================================================

program.parse(process.argv);

if (process.argv.length <= 2) {
  program.help();
}
