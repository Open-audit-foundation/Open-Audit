#!/usr/bin/env node
/**
 * validate-blueprints-cli.ts
 *
 * CI script that runs every committed blueprint spec through the shared
 * validateBlueprintSpec() + buildBlueprintFromSpec() pipeline.
 *
 * This guarantees that a spec passing open-audit-cli --spec uses the exact
 * same validation logic as production registration -- closing the drift risk
 * described in issue #246.
 *
 * Usage:
 *   npx ts-node scripts/validate-blueprints-cli.ts
 *   npx ts-node scripts/validate-blueprints-cli.ts --dir lib/translator/blueprints
 *
 * Exit codes:
 *   0 — all blueprints valid
 *   1 — one or more blueprints failed validation
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, join, extname } from "path";
import { parse as parseYaml } from "yaml";
import {
  validateBlueprintSpec,
  buildBlueprintFromSpec,
  BlueprintSpecValidationError,
} from "../lib/translator/blueprint-spec";

const BLUEPRINT_DIRS = [
  resolve(__dirname, "../lib/translator/blueprints"),
];

const args = process.argv.slice(2);
const dirArgIndex = args.indexOf("--dir");
if (dirArgIndex !== -1 && args[dirArgIndex + 1]) {
  BLUEPRINT_DIRS.length = 0;
  BLUEPRINT_DIRS.push(resolve(args[dirArgIndex + 1]));
}

interface ValidationResult {
  file: string;
  ok: boolean;
  error?: string;
}

function validateFile(filePath: string): ValidationResult {
  const ext = extname(filePath).toLowerCase();

  // Skip TypeScript source blueprints — they are validated by tsc
  if (ext === ".ts" || ext === ".js") {
    return { file: filePath, ok: true };
  }

  if (ext !== ".json" && ext !== ".yaml" && ext !== ".yml") {
    return { file: filePath, ok: true }; // Not a spec file, skip
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const raw = ext === ".json" ? JSON.parse(content) : parseYaml(content);
    const spec = validateBlueprintSpec(raw);
    buildBlueprintFromSpec(spec); // Ensure builder also succeeds
    return { file: filePath, ok: true };
  } catch (err) {
    return {
      file: filePath,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function run(): void {
  const results: ValidationResult[] = [];

  for (const dir of BLUEPRINT_DIRS) {
    if (!existsSync(dir)) {
      console.warn(`[WARN] Blueprint directory not found, skipping: ${dir}`);
      continue;
    }

    const files = readdirSync(dir).map((f) => join(dir, f));
    for (const file of files) {
      const result = validateFile(file);
      if (result.error) {
        // Only report files that actually failed spec validation
        results.push(result);
        console.error(`[FAIL] ${result.file}`);
        console.error(`       ${result.error}`);
      } else if (!result.file.endsWith(".ts") && !result.file.endsWith(".js")) {
        console.log(`[ OK ] ${result.file}`);
      }
    }
  }

  const failed = results.filter((r) => !r.ok);

  console.log(`\n${results.length === 0 ? "No spec files found." : `Validated spec files.`}`);

  if (failed.length > 0) {
    console.error(`\n${failed.length} blueprint(s) failed validation. See errors above.`);
    process.exit(1);
  } else {
    console.log("All blueprint specs valid.");
    process.exit(0);
  }
}

run();
