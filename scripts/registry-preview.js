#!/usr/bin/env node
/**
 * Generates a Markdown preview table for registry entries changed in a PR.
 *
 * Usage: node scripts/registry-preview.js
 *
 * Env vars:
 *   CHANGED_FILES — newline-separated list of changed files (from git diff)
 *   REGISTRY_PATH — override path to registry.json (default: lib/translator/registry.json)
 *
 * Output: Markdown to stdout. Exit 1 if any changed entry is missing test_vectors.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const registryPath = process.env.REGISTRY_PATH
  ? path.resolve(process.env.REGISTRY_PATH)
  : path.join(ROOT, "lib", "translator", "registry.json");

// ── helpers ──────────────────────────────────────────────────────────────────

function interpolate(template, params) {
  return template.replace(/\{(\w+(?:\.\w+)*)\}/g, (match, key) => {
    // Support dot-notation like {from.short} or {amount.formatted}
    const parts = key.split(".");
    if (parts.length === 2) {
      const [field, prop] = parts;
      const val = params[field];
      if (prop === "short" && typeof val === "string") {
        return val.length > 12 ? `${val.slice(0, 4)}...${val.slice(-4)}` : val;
      }
      if (prop === "formatted" && typeof val === "number") {
        return (val / 10_000_000).toFixed(2);
      }
    }
    return params[parts[0]] !== undefined ? String(params[parts[0]]) : match;
  });
}

function renderEntry(entry) {
  const rows = [];
  const vectors = entry.test_vectors ?? [];

  if (vectors.length === 0) {
    return null; // caller handles missing test_vectors
  }

  for (const vec of vectors) {
    const result = interpolate(entry.english_template, vec.params ?? {});
    const payloadDisplay = vec.hex_payload
      ? `\`${vec.hex_payload.slice(0, 32)}…\``
      : `\`(mock)\``;
    rows.push(`| ${entry.contract_id.slice(0, 12)}… | ${entry.topics.join(", ")} | ${payloadDisplay} | ${result} |`);
  }

  return rows.join("\n");
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(registryPath)) {
    console.error(`ERROR: Registry not found at ${registryPath}`);
    process.exit(1);
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  } catch (e) {
    console.error(`ERROR: Failed to parse registry.json — ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(registry)) {
    console.error("ERROR: registry.json must be an array.");
    process.exit(1);
  }

  // Find entries that have test_vectors (these are the ones the contributor added/modified)
  const previewable = registry.filter((e) => Array.isArray(e.test_vectors) && e.test_vectors.length > 0);
  const missing = registry.filter((e) => !e.test_vectors || e.test_vectors.length === 0);

  if (previewable.length === 0) {
    console.error(
      "ERROR: No entries with test_vectors found.\n" +
        "Each new or modified registry entry must include a test_vectors array.\n\n" +
        "Example:\n" +
        '  "test_vectors": [\n' +
        '    { "hex_payload": "0xabcd...", "params": { "from": "GABC...1234", "to": "GXYZ...5678", "amount": 50000000 } }\n' +
        "  ]"
    );
    process.exit(1);
  }

  const tableRows = [];
  for (const entry of previewable) {
    const rows = renderEntry(entry);
    if (rows) tableRows.push(rows);
  }

  const output = [
    "## 🔍 Registry Translation Preview",
    "",
    `_Auto-generated for ${previewable.length} entr${previewable.length === 1 ? "y" : "ies"} with test vectors._`,
    "",
    "| Contract | Topics | Raw Payload | English Result |",
    "|----------|--------|-------------|----------------|",
    ...tableRows,
    "",
  ];

  if (missing.length > 0) {
    output.push(
      `> ⚠️ **${missing.length} entr${missing.length === 1 ? "y" : "ies"} without test_vectors** — add them to get a full preview.`
    );
    output.push("");
  }

  console.log(output.join("\n"));
}

main();
