import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BlueprintSchema } from "../lib/translator/blueprint.schema";
import { ZodError } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const BLUEPRINTS_DIR = path.join(ROOT, "lib", "translator", "blueprints");

interface ValidationError {
  file: string;
  exportName?: string;
  error: string;
}

const errors: ValidationError[] = [];

/**
 * Validates a blueprint object against the Zod schema.
 */
function validateBlueprintObject(obj: unknown, file: string, exportName?: string): boolean {
  try {
    BlueprintSchema.parse(obj);
    return true;
  } catch (err) {
    if (err instanceof ZodError) {
      for (const issue of err.issues) {
        errors.push({
          file,
          exportName,
          error: `Path "${issue.path.join(".")}": ${issue.message}`,
        });
      }
    } else {
      errors.push({
        file,
        exportName,
        error: String(err),
      });
    }
    return false;
  }
}

/**
 * Determines if a value looks like a blueprint object (has key properties).
 */
function looksLikeBlueprint(val: unknown): boolean {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    return typeof obj.contractId === "string" || typeof obj.contractName === "string";
  }
  return false;
}

/**
 * Validates a JSON blueprint file.
 */
function validateJsonFile(filePath: string): void {
  const relPath = path.relative(ROOT, filePath);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        errors.push({
          file: relPath,
          error: "JSON file contains an empty array",
        });
        return;
      }
      parsed.forEach((item, index) => {
        validateBlueprintObject(item, relPath, `index ${index}`);
      });
    } else if (looksLikeBlueprint(parsed)) {
      validateBlueprintObject(parsed, relPath);
    } else {
      errors.push({
        file: relPath,
        error: "JSON file does not contain a valid blueprint structure (object or array of objects)",
      });
    }
  } catch (err) {
    errors.push({
      file: relPath,
      error: `Failed to read or parse JSON file: ${String(err)}`,
    });
  }
}

/**
 * Validates a TS/JS blueprint file.
 */
async function validateTsJsFile(filePath: string): Promise<void> {
  const relPath = path.relative(ROOT, filePath);
  try {
    // Dynamically import the module
    const mod = await import(filePath);
    const exports = Object.keys(mod);

    if (exports.length === 0) {
      errors.push({
        file: relPath,
        error: "Module has no exports. A blueprint file must export blueprint definitions or factory functions.",
      });
      return;
    }

    for (const key of exports) {
      const val = mod[key];

      if (typeof val === "function") {
        // Factory function validation
        const functionName = val.name || key;
        const isFactory = key.startsWith("create") || key.includes("Blueprint");

        if (isFactory) {
          try {
            let result: unknown;
            if (val.length === 0) {
              result = val();
            } else if (val.length === 1) {
              // Call with mock contract ID
              result = val("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM");
            } else {
              errors.push({
                file: relPath,
                exportName: key,
                error: `Factory function has arity ${val.length} which is not automatically testable (expected 0 or 1 parameter).`,
              });
              continue;
            }

            if (Array.isArray(result)) {
              if (result.length === 0) {
                errors.push({
                  file: relPath,
                  exportName: key,
                  error: "Factory function returned an empty array of blueprints",
                });
              }
              result.forEach((item, index) => {
                validateBlueprintObject(item, relPath, `${functionName}() -> index ${index}`);
              });
            } else if (looksLikeBlueprint(result)) {
              validateBlueprintObject(result, relPath, `${functionName}()`);
            } else {
              errors.push({
                file: relPath,
                exportName: key,
                error: `Factory function returned a value that does not look like a blueprint: ${typeof result}`,
              });
            }
          } catch (err) {
            errors.push({
              file: relPath,
              exportName: key,
              error: `Factory function crashed during validation: ${String(err)}`,
            });
          }
        }
      } else if (Array.isArray(val)) {
        if (val.some(looksLikeBlueprint)) {
          val.forEach((item, index) => {
            validateBlueprintObject(item, relPath, `${key}[${index}]`);
          });
        }
      } else if (looksLikeBlueprint(val)) {
        validateBlueprintObject(val, relPath, key);
      }
    }
  } catch (err) {
    errors.push({
      file: relPath,
      error: `Failed to import module: ${String(err)}`,
    });
  }
}

/**
 * Main execution.
 */
async function main(): Promise<void> {
  console.log("🔍 Scanning and validating blueprints in /lib/translator/blueprints/...\n");

  if (!fs.existsSync(BLUEPRINTS_DIR)) {
    console.error(`❌ ERROR: Blueprints directory not found: ${BLUEPRINTS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(BLUEPRINTS_DIR);
  const blueprintFiles = files.filter(f => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".json"));

  if (blueprintFiles.length === 0) {
    console.log("⚠️ No blueprint files found to validate.");
    process.exit(0);
  }

  for (const file of blueprintFiles) {
    const fullPath = path.join(BLUEPRINTS_DIR, file);
    if (file.endsWith(".json")) {
      validateJsonFile(fullPath);
    } else {
      await validateTsJsFile(fullPath);
    }
  }

  if (errors.length > 0) {
    console.error("=".repeat(80));
    console.error("❌ BLUEPRINT SCHEMA VALIDATION FAILED");
    console.error("=".repeat(80));
    
    // Group errors by file
    const grouped = new Map<string, ValidationError[]>();
    for (const err of errors) {
      const list = grouped.get(err.file) || [];
      list.push(err);
      grouped.set(err.file, list);
    }

    for (const [file, fileErrors] of grouped) {
      console.error(`\n📄 File: ${file}`);
      for (const err of fileErrors) {
        const prefix = err.exportName ? `[Export: ${err.exportName}] ` : "";
        console.error(`  - ${prefix}${err.error}`);
      }
    }
    
    console.error(`\nTotal: ${errors.length} validation error(s) found.\n`);
    process.exit(1);
  } else {
    console.log("=".repeat(80));
    console.log("✅ ALL BLUEPRINTS VALIDATED SUCCESSFULLY");
    console.log("=".repeat(80));
    console.log(`\nSuccessfully validated ${blueprintFiles.length} blueprint file(s).\n`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal error during blueprint validation:", err);
  process.exit(1);
});
