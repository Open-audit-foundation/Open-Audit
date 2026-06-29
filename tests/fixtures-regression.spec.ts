import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, relative } from "path";
import crypto from "crypto";
import { translateEvent } from "../lib/translator/registry";

type Fixture = {
  name: string;
  contractId: string;
  raw: any;
  expected: { description: string; status: string };
  blueprintFile: string;
  fingerprint: string;
};

function sha256Hex(contents: string | Buffer) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function loadAllFixtures(): Fixture[] {
  const fixturesRoot = join(process.cwd(), "lib", "translator", "fixtures");
  const fixtures: Fixture[] = [];

  const entries = readdirSync(fixturesRoot, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = join(fixturesRoot, e.name);
    const files = readdirSync(p).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const content = readFileSync(join(p, f), "utf8");
      const parsed = JSON.parse(content) as Fixture[];
      fixtures.push(...parsed);
    }
  }

  return fixtures;
}

const fixtures = loadAllFixtures();

describe("Fixture-based blueprint regression tests", () => {
  for (const fx of fixtures) {
    it(`${fx.name} — ${fx.contractId}`, () => {
      const translated = translateEvent(fx.raw);

      // Exact string match for description
      if ((translated.description ?? null) !== fx.expected.description) {
        // Compute current fingerprint of the blueprint source referenced by the fixture
        const blueprintPath = join(process.cwd(), fx.blueprintFile);
        let currentFp = "";
        try {
          const src = readFileSync(blueprintPath);
          currentFp = sha256Hex(src);
        } catch (e) {
          throw new Error(`ERROR: Could not read blueprint file at ${fx.blueprintFile}: ${(e as Error).message}`);
        }

        if (currentFp !== fx.fingerprint) {
          throw new Error(
            `NEEDS_REVIEW: Fixture '${fx.name}' output changed and blueprint fingerprint differs.\nRecorded fingerprint: ${fx.fingerprint}\nCurrent fingerprint:  ${currentFp}\nExpected: ${fx.expected.description}\nActual:   ${translated.description}`
          );
        }

        throw new Error(
          `REGRESSION: Fixture '${fx.name}' produced different translation.\nExpected: ${fx.expected.description}\nActual:   ${translated.description}`
        );
      }

      expect(translated.status).toBe(fx.expected.status);
      expect(translated.description).toBe(fx.expected.description);
    });
  }
});
