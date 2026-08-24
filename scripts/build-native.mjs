#!/usr/bin/env node
/**
 * Builds the native XDR decoder (native/soroban-xdr-decode) with cargo and
 * places the resulting addon next to the crate as
 * soroban-xdr-decode.<platform>.node, where <platform> follows the napi-rs
 * naming convention (linux-x64-gnu, darwin-arm64, win32-x64-msvc, ...).
 *
 * Usage:
 *   node scripts/build-native.mjs            # release build
 *   node scripts/build-native.mjs --debug    # debug build
 *
 * Requires a Rust toolchain (https://rustup.rs). The addon is optional: when
 * it is absent the TypeScript parser in lib/translator/secure-xdr-parser.ts
 * is used automatically.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const crateDir = join(repoRoot, "native", "soroban-xdr-decode");
const debug = process.argv.includes("--debug");
const profile = debug ? "debug" : "release";

function platformSuffix() {
  const { platform, arch } = process;
  if (platform === "linux") {
    const abi = isMusl() ? "musl" : "gnu";
    if (arch === "x64") return `linux-x64-${abi}`;
    if (arch === "arm64") return `linux-arm64-${abi}`;
  }
  if (platform === "darwin") {
    if (arch === "x64") return "darwin-x64";
    if (arch === "arm64") return "darwin-arm64";
  }
  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";
  return null;
}

function isMusl() {
  try {
    return !process.report?.getReport?.()?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

const suffix = platformSuffix();
if (!suffix) {
  console.error(
    `Unsupported platform for the native XDR decoder: ${process.platform}-${process.arch}.\n` +
      "Supported: Linux x64/arm64 (glibc & musl), macOS x64/arm64, Windows x64.\n" +
      "The pure-TypeScript parser will be used instead — nothing else to do."
  );
  process.exit(1);
}

const args = ["build", "--manifest-path", join(crateDir, "Cargo.toml")];
if (!debug) args.push("--release");

console.log(`> cargo ${args.join(" ")}`);
execFileSync("cargo", args, { stdio: "inherit", cwd: crateDir });

const libName = {
  linux: "libsoroban_xdr_decode.so",
  darwin: "libsoroban_xdr_decode.dylib",
  win32: "soroban_xdr_decode.dll",
}[process.platform];

const built = join(crateDir, "target", profile, libName);
if (!existsSync(built)) {
  console.error(`Build artifact not found: ${built}`);
  process.exit(1);
}

mkdirSync(crateDir, { recursive: true });
const dest = join(crateDir, `soroban-xdr-decode.${suffix}.node`);
copyFileSync(built, dest);
console.log(`Native XDR decoder built (${profile}): ${dest}`);
