import { readFileSync } from "fs";
import path from "path";
import type { WasmParserInput } from "../types";

export const FIXTURES_DIR = path.join(
  process.cwd(),
  "lib/wasm-sandbox/fixtures/compiled"
);

export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES_DIR, name)));
}

export const SAMPLE_EVENT_INPUT: WasmParserInput = {
  id: "0000001-0000000001",
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M",
  topics: [
    // Symbol "transfer" as hex-ish placeholder — fixture ignores content
    "7472616e73666572",
  ],
  data: "0000000000000000",
  ledger: 5_000_000,
  timestamp: 1_720_000_000,
  txHash: "a".repeat(64),
};
