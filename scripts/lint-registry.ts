#!/usr/bin/env node
/**
 * Advanced Translation Registry Linter
 * 
 * This script performs 3-tier validation:
 * 1. JSON Schema validation (structure and types)
 * 2. Template variable cross-examination (variables match event_structure fields)
 * 3. Logical consistency checks (topics alignment, duplicate detection)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

interface RegistryEntry {
  contract_id: string;
  topics: string[];
  event_structure: {
    topics: Array<{ name: string; type: string }>;
    data?: { name: string; type: string };
  };
  templates: Record<string, string>;
  test_vectors?: Array<{
    hex_payload?: string;
    params: Record<string, string | number | boolean>;
  }>;
}

interface ValidationError {
  file: string;
  index: number;
  contract_id?: string;
  topics?: string[];
  error: string;
  severity: "error" | "warning";
}

const errors: ValidationError[] = [];
let hasErrors = false;

/**
 * Extract all template variables from a string like "{from.short}" or "{amount}"
 * Returns base variable names without modifiers (e.g., "from", "amount")
 */
function extractTemplateVariables(template: string): string[] {
  const regex = /\{([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\}/gi;
  const matches = Array.from(template.matchAll(regex));
  const variables: string[] = [];
  
  for (const match of matches) {
    // Extract base variable name (before any dot notation)
    const fullVar = match[1];
    const baseVar = fullVar.split('.')[0];
    if (!variables.includes(baseVar)) {
      variables.push(baseVar);
    }
  }
  
  return variables;
}

/**
 * Get all available field names from event_structure
 */
function getAvailableFields(entry: RegistryEntry): string[] {
  const fields: string[] = [];
  
  // Add topic fields
  if (entry.event_structure?.topics) {
    for (const topic of entry.event_structure.topics) {
      fields.push(topic.name);
    }
  }
  
  // Add data field
  if (entry.event_structure?.data) {
    fields.push(entry.event_structure.data.name);
  }
  
  return fields;
}

/**
 * Validate that template variables match available fields
 */
function validateTemplateVariables(
  entry: RegistryEntry,
  index: number,
  filePath: string
): boolean {
  const availableFields = getAvailableFields(entry);
  let isValid = true;
  
  for (const [lang, template] of Object.entries(entry.templates)) {
    const templateVars = extractTemplateVariables(template);
    
    for (const varName of templateVars) {
      if (!availableFields.includes(varName)) {
        errors.push({
          file: filePath,
          index,
          contract_id: entry.contract_id,
          topics: entry.topics,
          error: `[${lang}] Template references '{${varName}}' but event_structure only provides [${availableFields.join(', ')}]`,
          severity: "error"
        });
        isValid = false;
        hasErrors = true;
      }
    }
  }
  
  return isValid;
}

/**
 * Validate that topics array length matches event_structure.topics length + 1
 * (first topic is event name, rest should match field definitions)
 */
function validateTopicsAlignment(
  entry: RegistryEntry,
  index: number,
  filePath: string
): boolean {
  const expectedTopicCount = (entry.event_structure?.topics?.length || 0) + 1;
  const actualTopicCount = entry.topics?.length || 0;
  
  if (actualTopicCount !== expectedTopicCount) {
    errors.push({
      file: filePath,
      index,
      contract_id: entry.contract_id,
      topics: entry.topics,
      error: `Topics array length mismatch: expected ${expectedTopicCount} (1 event name + ${expectedTopicCount - 1} fields), got ${actualTopicCount}`,
      severity: "error"
    });
    hasErrors = true;
    return false;
  }
  
  return true;
}

/**
 * Validate test_vectors if present
 */
function validateTestVectors(
  entry: RegistryEntry,
  index: number,
  filePath: string
): boolean {
  if (!entry.test_vectors || entry.test_vectors.length === 0) {
    return true;
  }
  
  const availableFields = getAvailableFields(entry);
  let isValid = true;
  
  for (let i = 0; i < entry.test_vectors.length; i++) {
    const vector = entry.test_vectors[i];
    const providedParams = Object.keys(vector.params);
    
    // Check if all template variables (from all languages) have corresponding test params
    const allTemplateVars = new Set<string>();
    for (const template of Object.values(entry.templates)) {
      const vars = extractTemplateVariables(template);
      vars.forEach(v => allTemplateVars.add(v));
    }
    for (const varName of Array.from(allTemplateVars)) {
      if (!providedParams.includes(varName)) {
        errors.push({
          file: filePath,
          index,
          contract_id: entry.contract_id,
          topics: entry.topics,
          error: `test_vectors[${i}] missing param '{${varName}}' required by template`,
          severity: "warning"
        });
      }
    }
    
    // Check if test params match available fields
    for (const param of providedParams) {
      if (!availableFields.includes(param)) {
        errors.push({
          file: filePath,
          index,
          contract_id: entry.contract_id,
          topics: entry.topics,
          error: `test_vectors[${i}] param '{${param}}' not defined in event_structure`,
          severity: "error"
        });
        isValid = false;
        hasErrors = true;
      }
    }
  }
  
  return isValid;
}

/**
 * Check for duplicate entries (same contract_id + topics combination)
 */
function detectDuplicates(registry: RegistryEntry[], filePath: string): void {
  const seen = new Map<string, number>();
  
  for (let i = 0; i < registry.length; i++) {
    const entry = registry[i];
    const key = `${entry.contract_id}:${entry.topics.join(',')}`;
    
    if (seen.has(key)) {
      const firstIndex = seen.get(key)!;
      errors.push({
        file: filePath,
        index: i,
        contract_id: entry.contract_id,
        topics: entry.topics,
        error: `Duplicate entry detected (same contract_id and topics as index ${firstIndex})`,
        severity: "error"
      });
      hasErrors = true;
    } else {
      seen.set(key, i);
    }
  }
}

/**
 * Tier 1: JSON Schema Validation
 */
function validateSchema(
  registry: RegistryEntry[],
  schema: any,
  filePath: string
): boolean {
  const ajv = new Ajv({ allErrors: true } as any);
  const validate = ajv.compile(schema);
  
  const valid = validate(registry);
  
  if (!valid && validate.errors) {
    for (const err of validate.errors as any[]) {
      // Try to extract index from instancePath like "/0/contract_id"
      const indexMatch = err.instancePath?.match(/^\/(\d+)/);
      const index = indexMatch ? parseInt(indexMatch[1]) : -1;
      
      errors.push({
        file: filePath,
        index,
        contract_id: index >= 0 ? registry[index]?.contract_id : undefined,
        topics: index >= 0 ? registry[index]?.topics : undefined,
        error: `Schema validation failed at ${err.instancePath || 'root'}: ${err.message}`,
        severity: "error"
      });
    }
    hasErrors = true;
    return false;
  }
  
  return true;
}

/**
 * Tier 2 & 3: Custom Validation Logic
 */
function validateRegistryLogic(registry: RegistryEntry[], filePath: string): boolean {
  let allValid = true;
  
  // Check for duplicates across all entries
  detectDuplicates(registry, filePath);
  
  // Validate each entry
  for (let i = 0; i < registry.length; i++) {
    const entry = registry[i];
    
    // Validate template variables match event_structure
    if (!validateTemplateVariables(entry, i, filePath)) {
      allValid = false;
    }
    
    // Validate topics alignment
    if (!validateTopicsAlignment(entry, i, filePath)) {
      allValid = false;
    }
    
    // Validate test vectors
    if (!validateTestVectors(entry, i, filePath)) {
      allValid = false;
    }
  }
  
  return allValid;
}

/**
 * Print validation errors in a developer-friendly format
 */
function printErrors(): void {
  if (errors.length === 0) {
    return;
  }
  
  console.error("\n" + "=".repeat(80));
  console.error("TRANSLATION REGISTRY VALIDATION FAILED");
  console.error("=".repeat(80) + "\n");
  
  // Group errors by file and index
  const errorsByFile = new Map<string, Map<number, ValidationError[]>>();
  
  for (const error of errors) {
    if (!errorsByFile.has(error.file)) {
      errorsByFile.set(error.file, new Map());
    }
    const fileErrors = errorsByFile.get(error.file)!;
    if (!fileErrors.has(error.index)) {
      fileErrors.set(error.index, []);
    }
    fileErrors.get(error.index)!.push(error);
  }
  
  // Print grouped errors
  for (const [file, fileErrors] of Array.from(errorsByFile)) {
    console.error(`\n📄 File: ${path.relative(ROOT, file)}`);
    console.error("-".repeat(80));
    
    for (const [index, indexErrors] of Array.from(fileErrors)) {
      if (index >= 0) {
        console.error(`\n  Entry [${index}]:`);
        const firstError = indexErrors[0];
        if (firstError.contract_id) {
          console.error(`    Contract: ${firstError.contract_id}`);
        }
        if (firstError.topics) {
          console.error(`    Topics: [${firstError.topics.join(', ')}]`);
        }
      }
      
      for (const error of indexErrors) {
        const icon = error.severity === "error" ? "❌" : "⚠️";
        console.error(`    ${icon} ${error.error}`);
      }
    }
  }
  
  console.error("\n" + "=".repeat(80));
  const errorCount = errors.filter(e => e.severity === "error").length;
  const warningCount = errors.filter(e => e.severity === "warning").length;
  console.error(`Total: ${errorCount} error(s), ${warningCount} warning(s)`);
  console.error("=".repeat(80) + "\n");
}

/**
 * Main validation function
 */
function main(): void {
  console.log("🔍 Starting Translation Registry Validation...\n");
  
  const schemaPath = path.join(ROOT, "lib", "translator", "registry.schema.json");
  const registryPath = path.join(ROOT, "lib", "translator", "registry.json");
  
  // Check file existence
  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ ERROR: Schema file not found: ${schemaPath}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(registryPath)) {
    console.error(`❌ ERROR: Registry file not found: ${registryPath}`);
    process.exit(1);
  }
  
  // Load files
  let schema: any;
  let registry: RegistryEntry[];
  
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    console.log("✓ Schema loaded successfully");
  } catch (err) {
    console.error(`❌ ERROR: Failed to parse schema file: ${err}`);
    process.exit(1);
  }
  
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    console.log(`✓ Registry loaded successfully (${registry.length} entries)`);
  } catch (err) {
    console.error(`❌ ERROR: Failed to parse registry file: ${err}`);
    process.exit(1);
  }
  
  if (!Array.isArray(registry)) {
    console.error("❌ ERROR: Registry must be an array");
    process.exit(1);
  }
  
  console.log("\n📋 Running Tier 1: JSON Schema Validation...");
  const schemaValid = validateSchema(registry, schema, registryPath);
  console.log(schemaValid ? "✓ Schema validation passed" : "✗ Schema validation failed");
  
  console.log("\n📋 Running Tier 2: Template Variable Cross-Examination...");
  console.log("📋 Running Tier 3: Logical Consistency Checks...");
  const logicValid = validateRegistryLogic(registry, registryPath);
  console.log(logicValid ? "✓ Logic validation passed" : "✗ Logic validation failed");
  
  // Print results
  if (hasErrors) {
    printErrors();
    process.exit(1);
  } else {
    console.log("\n" + "=".repeat(80));
    console.log("✅ ALL VALIDATION CHECKS PASSED");
    console.log("=".repeat(80));
    console.log(`\n${registry.length} registry entries validated successfully.\n`);
  }
}

main();
