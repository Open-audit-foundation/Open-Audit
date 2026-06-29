import { describe, it, expect } from "vitest";
import { BlueprintSchema } from "../blueprint.schema";
import { createSacTransferBlueprint, createAllSacBlueprints } from "../blueprints/sac-transfer";
import { createSacMintBurnBlueprint } from "../blueprints/sac-mint-burn";

describe("Translation Blueprint Schema Validation", () => {
  describe("Existing Blueprints", () => {
    it("should validate a single SAC Transfer blueprint", () => {
      const blueprint = createSacTransferBlueprint("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM");
      const parseResult = BlueprintSchema.safeParse(blueprint);
      expect(parseResult.success).toBe(true);
    });

    it("should validate all SAC Transfer blueprints returned by createAllSacBlueprints", () => {
      const blueprints = createAllSacBlueprints();
      expect(blueprints.length).toBeGreaterThan(0);
      for (const blueprint of blueprints) {
        const parseResult = BlueprintSchema.safeParse(blueprint);
        expect(parseResult.success).toBe(true);
      }
    });

    it("should validate a single SAC Mint/Burn blueprint", () => {
      const blueprint = createSacMintBurnBlueprint("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM");
      const parseResult = BlueprintSchema.safeParse(blueprint);
      expect(parseResult.success).toBe(true);
    });
  });

  describe("Schema Boundaries", () => {
    it("should allow a valid blueprint object", () => {
      const valid = {
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        contractName: "Test Contract",
        translate: () => null,
      };
      expect(BlueprintSchema.safeParse(valid).success).toBe(true);
    });

    it("should allow optional fields", () => {
      const valid = {
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        contractName: "Test Contract",
        matches: () => true,
        translate: () => null,
        validFromLedger: 100,
        version: "v2",
      };
      expect(BlueprintSchema.safeParse(valid).success).toBe(true);
    });

    it("should reject contractId with incorrect length", () => {
      const invalid = {
        contractId: "CDLZFC3SYJYDZT7K6", // too short
        contractName: "Test Contract",
        translate: () => null,
      };
      const result = BlueprintSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("contractId must be a valid 56-to-58-character");
      }
    });

    it("should reject contractId that does not start with C", () => {
      const invalid = {
        contractId: "GDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", // starts with G
        contractName: "Test Contract",
        translate: () => null,
      };
      const result = BlueprintSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("contractId must be a valid 56-to-58-character");
      }
    });

    it("should reject empty contractName", () => {
      const invalid = {
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        contractName: "",
        translate: () => null,
      };
      const result = BlueprintSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("contractName");
      }
    });

    it("should reject missing translate function", () => {
      const invalid = {
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        contractName: "Test Contract",
      };
      const result = BlueprintSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("translate");
      }
    });

    it("should reject invalid translate types", () => {
      const invalid = {
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        contractName: "Test Contract",
        translate: "not a function",
      };
      const result = BlueprintSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject negative validFromLedger", () => {
      const invalid = {
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        contractName: "Test Contract",
        translate: () => null,
        validFromLedger: -1,
      };
      const result = BlueprintSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject non-integer validFromLedger", () => {
      const invalid = {
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        contractName: "Test Contract",
        translate: () => null,
        validFromLedger: 12.34,
      };
      const result = BlueprintSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
