import { describe, it } from "vitest";

// The same real-worker cases can also run directly with Node's built-in runner.
const { cases }: { cases: Array<{ name: string; run: () => Promise<void> }> } =
  require("./table-limit-cases.cjs");

describe("WASM sandbox table allocation limits (#405)", () => {
  for (const { name, run } of cases) it(name, run);
});
