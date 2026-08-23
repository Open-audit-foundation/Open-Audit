/**
 * Documentation/reality drift check.
 *
 * Catches the exact class of bug this script was written in response to:
 * a README, ARCHITECTURE.md, or package.json that references a script
 * target, file, or doc link that doesn't actually exist in the repo.
 *
 * Two checks:
 *   1. Every package.json script's file-path-looking arguments must
 *      resolve to a real file or directory.
 *   2. Every relative markdown link (and bare `*.md` inline code span)
 *      in README.md / ARCHITECTURE.md must resolve to a real file.
 *
 * Intentionally simple: this is meant to catch obviously dead
 * references, not to be a full documentation linter.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

let errorCount = 0;

function fail(message: string): void {
  console.error(`  - ${message}`);
  errorCount++;
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(ROOT, relativePath));
}

// ============================================================================
// Check 1: package.json scripts reference real files
// ============================================================================

/** Command names that are resolved as installed binaries, not file paths. */
const KNOWN_COMMANDS = new Set([
  "node", "npm", "npx", "next", "vitest", "tsx", "ts-node", "tsc", "prettier",
  "eslint", "jest", "bash", "sh", "cd", "docker-compose", "docker", "pm2",
  "git", "prisma", "cross-env", "concurrently", "rimraf",
]);

/** A token looks like a file/dir path worth checking if it has a path
 * separator or a recognizable file extension, and isn't a flag, URL,
 * env-var interpolation, or glob. */
function looksLikePath(token: string): boolean {
  if (token.startsWith("-")) return false;
  if (token.startsWith("$") || token.includes("${")) return false;
  if (token.startsWith("http://") || token.startsWith("https://")) return false;
  if (token.includes("*")) return false;
  // Build output directories are gitignored artifacts, not source — a
  // script referencing dist/foo.js before anyone has run `build` is
  // expected, not drift.
  if (token.startsWith("dist/") || token.startsWith("dist\\")) return false;
  if (KNOWN_COMMANDS.has(token)) return false;
  const hasSeparator = token.includes("/") || token.includes("\\");
  const hasKnownExtension = /\.(ts|tsx|js|jsx|mjs|cjs|json|sh|yml|yaml)$/.test(token);
  return hasSeparator || hasKnownExtension;
}

function checkPackageJsonScripts(): void {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  const scripts: Record<string, string> = pkg.scripts ?? {};

  for (const [name, command] of Object.entries(scripts)) {
    // Split on shell chaining operators so each sub-command's args are checked.
    const subCommands = command.split(/&&|\|\||;|\|/);

    for (const subCommand of subCommands) {
      const tokens = subCommand.trim().split(/\s+/);

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const previousToken = tokens[i - 1];

        // `-r <module>` / `--require <module>` takes a Node module
        // specifier (resolved via node_modules), not a repo file path.
        if (previousToken === "-r" || previousToken === "--require") continue;

        if (!looksLikePath(token)) continue;

        const cleanToken = token.replace(/^["']|["']$/g, "");

        if (!exists(cleanToken)) {
          fail(`package.json script "${name}" references "${cleanToken}", which doesn't exist`);
        }
      }
    }
  }
}

// ============================================================================
// Check 2: markdown links in README.md / ARCHITECTURE.md resolve
// ============================================================================

const DOC_FILES = ["README.md", "ARCHITECTURE.md"];

/** Link targets that aren't repo-relative file paths. */
function isExternalOrAnchor(target: string): boolean {
  return (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    target.startsWith("#")
  );
}

function checkMarkdownLinks(docFile: string): void {
  const fullPath = path.join(ROOT, docFile);
  if (!fs.existsSync(fullPath)) return;

  const content = fs.readFileSync(fullPath, "utf-8");
  const docDir = path.dirname(fullPath);

  // [text](target) — standard markdown links.
  const linkPattern = /\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(content)) !== null) {
    const target = match[1].split("#")[0].trim();
    if (!target || isExternalOrAnchor(match[1])) continue;

    const resolved = path.resolve(docDir, target);
    if (!fs.existsSync(resolved)) {
      fail(`${docFile} links to "${target}", which doesn't exist`);
    }
  }

  // `SOME_FILE.md` — bare inline-code references to other markdown files,
  // the pattern nearly every dead reference in this repo's audit took.
  const inlineMdPattern = /`([A-Za-z0-9_.\/-]+\.md)`/g;
  while ((match = inlineMdPattern.exec(content)) !== null) {
    const target = match[1];
    const resolved = path.resolve(docDir, target);
    if (!fs.existsSync(resolved)) {
      fail(`${docFile} references \`${target}\` in inline code, which doesn't exist`);
    }
  }
}

// ============================================================================
// Run
// ============================================================================

function main(): void {
  console.log("Checking package.json scripts reference real files...");
  checkPackageJsonScripts();

  for (const docFile of DOC_FILES) {
    console.log(`Checking ${docFile} links resolve...`);
    checkMarkdownLinks(docFile);
  }

  if (errorCount > 0) {
    console.error(`\n❌ validate:docs found ${errorCount} dead reference(s).`);
    process.exit(1);
  }

  console.log("\n✅ No documentation/reality drift found.");
}

main();
