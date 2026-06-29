#!/usr/bin/env node
/**
 * Blueprint validation script — runs in CI and locally (no install needed).
 *
 * Usage:
 *   node scripts/validate-blueprint.js [file1.json file2.json ...]
 *
 * If no files are passed it validates everything in lib/translator/blueprints/*.json
 *
 * Exit codes:
 *   0 — all blueprints valid
 *   1 — one or more failures
 *
 * Outputs a Markdown report to stdout and writes blueprint-validation-report.md
 * for the CI comment bot to pick up.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BLUEPRINTS_DIR = path.join(ROOT, "lib", "translator", "blueprints");

const VALID_TYPES = new Set(["address", "amount", "asset", "string", "integer", "boolean"]);
const VALID_SOURCES = new Set(["topic", "data"]);
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// ── Schema validation (hand-rolled to avoid ajv dep at runtime) ──────────────

function validateSchema(bp) {
  const errors = [];

  if (!bp || typeof bp !== "object") return ["Root value must be an object"];

  if (!bp.contractId || typeof bp.contractId !== "string")
    errors.push("contractId is required (string)");
  else if (!CONTRACT_ID_RE.test(bp.contractId))
    errors.push(`contractId "${bp.contractId}" is not a valid Stellar contract address (C + 55 uppercase base32 chars)`);

  if (!bp.name || typeof bp.name !== "string") errors.push("name is required (string)");
  if (!bp.description || typeof bp.description !== "string") errors.push("description is required (string)");

  if (!bp.version || typeof bp.version !== "string")
    errors.push("version is required (string)");
  else if (!SEMVER_RE.test(bp.version))
    errors.push(`version "${bp.version}" must be semver (e.g. 1.0.0)`);

  if (!Array.isArray(bp.events) || bp.events.length === 0)
    errors.push("events must be a non-empty array");
  else {
    for (let i = 0; i < bp.events.length; i++) {
      const ev = bp.events[i];
      const prefix = `events[${i}]`;

      if (!ev.topic || typeof ev.topic !== "string")
        errors.push(`${prefix}.topic is required (string)`);
      if (!ev.template || typeof ev.template !== "string")
        errors.push(`${prefix}.template is required (string)`);
      if (!Array.isArray(ev.fields) || ev.fields.length === 0)
        errors.push(`${prefix}.fields must be a non-empty array`);
      else {
        for (let j = 0; j < ev.fields.length; j++) {
          const f = ev.fields[j];
          const fp = `${prefix}.fields[${j}]`;
          if (!f.name || typeof f.name !== "string") errors.push(`${fp}.name is required`);
          if (!VALID_TYPES.has(f.type)) errors.push(`${fp}.type must be one of: ${[...VALID_TYPES].join(", ")}`);
          if (!VALID_SOURCES.has(f.source)) errors.push(`${fp}.source must be one of: topic, data`);
          if (typeof f.index !== "number" || !Number.isInteger(f.index) || f.index < 0)
            errors.push(`${fp}.index must be a non-negative integer`);
        }
      }
    }
  }

  return errors;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractPlaceholders(template) {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

function syntheticParams(fields) {
  const params = {};
  for (const field of fields) {
    switch (field.type) {
      case "address":   params[field.name] = `G${"A".repeat(54)}1`; break;
      case "amount":    params[field.name] = "100.00"; break;
      case "asset":     params[field.name] = "XLM"; break;
      case "integer":   params[field.name] = "42"; break;
      case "boolean":   params[field.name] = "true"; break;
      default:          params[field.name] = "value";
    }
  }
  return params;
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    params[key] !== undefined ? params[key] : match
  );
}

// ── Per-file validation ──────────────────────────────────────────────────────

function validateBlueprint(filePath) {
  const fileName = path.relative(ROOT, filePath);
  const result = { file: fileName, errors: [], previews: [], ok: false };

  let blueprint;
  try {
    blueprint = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    result.errors.push(`JSON parse error: ${e.message}`);
    return result;
  }

  // 1. Schema
  const schemaErrors = validateSchema(blueprint);
  if (schemaErrors.length > 0) {
    result.errors.push(...schemaErrors);
    return result;
  }

  // 2. Placeholder cross-check
  for (const event of blueprint.events) {
    const fieldNames = new Set(event.fields.map((f) => f.name));
    const placeholders = extractPlaceholders(event.template);

    for (const p of placeholders) {
      if (!fieldNames.has(p))
        result.errors.push(`Event "${event.topic}": template placeholder {${p}} has no matching field`);
    }
    for (const field of event.fields) {
      if (!placeholders.includes(field.name))
        result.errors.push(`Event "${event.topic}": field "${field.name}" is defined but not referenced in the template`);
    }
  }

  if (result.errors.length > 0) return result;

  // 3. Dry-run translation
  for (const event of blueprint.events) {
    const output = interpolate(event.template, syntheticParams(event.fields));
    if (/\{[^}]+\}/.test(output)) {
      result.errors.push(`Event "${event.topic}": dry-run left unresolved placeholders: "${output}"`);
    } else {
      result.previews.push({ topic: event.topic, output });
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  let files = process.argv.slice(2).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    if (!fs.existsSync(BLUEPRINTS_DIR)) {
      console.log("No blueprint files found.");
      process.exit(0);
    }
    files = fs.readdirSync(BLUEPRINTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(BLUEPRINTS_DIR, f));
  }

  if (files.length === 0) {
    console.log("No blueprint JSON files to validate.");
    process.exit(0);
  }

  const results = files.map((f) => validateBlueprint(path.resolve(f)));
  const allPassed = results.every((r) => r.ok);

  const lines = ["## 🔎 Blueprint Validation Report", ""];

  for (const r of results) {
    if (r.ok) {
      lines.push(`### ✅ \`${r.file}\``);
      if (r.previews.length > 0) {
        lines.push("", "**Translation previews:**", "");
        lines.push("| Event | Dry-run output |");
        lines.push("|-------|----------------|");
        for (const p of r.previews) {
          lines.push(`| \`${p.topic}\` | ${p.output} |`);
        }
      }
    } else {
      lines.push(`### ❌ \`${r.file}\``);
      lines.push("", "**Errors:**", "");
      for (const err of r.errors) lines.push(`- ${err}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    allPassed
      ? "✅ All blueprints passed validation."
      : `❌ ${results.filter((r) => !r.ok).length} blueprint(s) failed.`
  );

  const report = lines.join("\n");
  console.log(report);

  fs.writeFileSync(path.join(ROOT, "blueprint-validation-report.md"), report, "utf-8");

  if (!allPassed) process.exit(1);
}

main();
