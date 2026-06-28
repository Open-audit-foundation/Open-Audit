import { describe, expect, it } from "vitest";
import { assertBlueprintSchemaVersion, BLUEPRINT_SCHEMA_VERSION } from "./schema-version";
import { registerBlueprint } from "./registry";
import type { TranslationBlueprint } from "./types";

const blueprint = (overrides: Partial<TranslationBlueprint>): TranslationBlueprint => ({
  contractId: "CSCHEMAVERSION00000000000000000000000000000000000000000",
  contractName: "Schema Version Test",
  schemaVersion: BLUEPRINT_SCHEMA_VERSION,
  translate: () => ({ description: "ok", eventType: "Test" }),
  ...overrides,
});

describe("blueprint schema version validation", () => {
  it("rejects a missing schemaVersion with an actionable message", () => {
    expect(() => assertBlueprintSchemaVersion({ contractName: "Legacy Blueprint" })).toThrow(
      /schemaVersion is required.*Add schemaVersion: "1\.0\.0"/
    );
  });

  it("rejects registry version mismatches with a clear diagnostic", () => {
    expect(() => registerBlueprint(blueprint({ schemaVersion: "2.0.0" }))).toThrow(
      /targets schema v2\.0\.0, runtime expects v1\.0\.0/
    );
  });
});
