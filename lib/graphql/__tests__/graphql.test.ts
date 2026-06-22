import { vi, describe, it, expect, beforeEach } from "vitest";
import { graphql } from "graphql";
import { buildSchema, SERVER_CUSTOM_ABIS, invalidateSchemaCache } from "../schema";
import { analyzeComplexity } from "../complexity";
import { db } from "../../db/client";

// Mock the database client to prevent actual database connections
vi.mock("../../db/client", () => {
  return {
    db: {
      event: {
        findMany: vi.fn(),
      },
    },
  };
});

describe("GraphQL Server & Dynamic Schema", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    SERVER_CUSTOM_ABIS.clear();
    invalidateSchemaCache();
  });

  describe("Query Complexity Analyzer", () => {
    it("should allow a simple, safe query", () => {
      const query = `
        query SafeQuery {
          getRegisteredContracts {
            contractId
            contractName
            isCustom
            events
          }
        }
      `;
      const result = analyzeComplexity(query, {}, 100);
      expect(result.error).toBeUndefined();
      expect(result.complexity).toBeGreaterThan(0);
      expect(result.complexity).toBeLessThan(50);
    });

    it("should reject a query that exceeds the complexity limit", () => {
      // Large limit (e.g. 200) multiplies the inner field cost
      const query = `
        query ExpensiveQuery {
          getTransfers(contractId: "C123", limit: 200) {
            id
            from {
              publicKey
              short
            }
            to {
              publicKey
              short
            }
            amount {
              raw
              formatted
              symbol
            }
          }
        }
      `;
      const result = analyzeComplexity(query, {}, 100);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("exceeds the maximum allowed complexity");
    });

    it("should correctly resolve variables for complexity estimation", () => {
      const query = `
        query VarQuery($limitVal: Int!) {
          getTransfers(contractId: "C123", limit: $limitVal) {
            id
            description
          }
        }
      `;
      
      // High limit variable -> should fail
      const resultHigh = analyzeComplexity(query, { limitVal: 150 }, 100);
      expect(resultHigh.error).toBeDefined();

      // Safe limit variable -> should pass
      const resultSafe = analyzeComplexity(query, { limitVal: 5 }, 100);
      expect(resultSafe.error).toBeUndefined();
    });

    it("should use a default list multiplier when limit argument is omitted", () => {
      const query = `
        query SafeListQuery {
          getTransfers(contractId: "C123") {
            id
            description
          }
        }
      `;
      // By default list is multiplier of 10. Inner cost is 2 (id, description). 2 * 10 = 20 + 1 = 21 cost.
      const result = analyzeComplexity(query, {}, 100);
      expect(result.error).toBeUndefined();
      expect(result.complexity).toBe(21);
    });
  });

  describe("Dynamic Schema Generation & Registration", () => {
    it("should dynamically expose built-in SAC query fields", () => {
      const schema = buildSchema();
      const queryType = schema.getQueryType();
      expect(queryType).toBeDefined();

      const fields = queryType!.getFields();
      expect(fields.getRegisteredContracts).toBeDefined();
      expect(fields.getTransfers).toBeDefined();
      expect(fields.getMints).toBeDefined();
      expect(fields.getBurns).toBeDefined();
    });

    it("should mutate the schema when a new contract is registered via mutation", async () => {
      const schemaBefore = buildSchema();
      const fieldsBefore = schemaBefore.getQueryType()!.getFields();
      
      // The prefix field getDeposits_CAAA1111 should not exist yet
      expect(fieldsBefore["getDeposits_CAAA1111"]).toBeUndefined();

      // Custom ABI with a "deposit" event
      const customAbi = {
        contractId: "CAAA111122223333444455556666777788889999000011112222333344445555",
        contractName: "Test Deposit Vault",
        events: [
          {
            name: "deposit",
            fields: [
              { name: "depositor", type: "address" },
              { name: "amount", type: "amount" },
              { name: "refCode", type: "string" }
            ]
          }
        ]
      };

      const mutation = `
        mutation Register($id: String!, $abi: String!) {
          registerContract(contractId: $id, abiJson: $abi) {
            contractId
            contractName
            isCustom
            events
          }
        }
      `;

      const result = await graphql({
        schema: schemaBefore,
        source: mutation,
        variableValues: {
          id: customAbi.contractId,
          abi: JSON.stringify(customAbi),
        },
      });

      expect(result.errors).toBeUndefined();
      expect(result.data?.registerContract).toMatchObject({
        contractId: customAbi.contractId,
        contractName: "Test Deposit Vault",
        isCustom: true,
        events: ["deposit"],
      });

      // Retrieve mutated schema
      const schemaAfter = buildSchema();
      const fieldsAfter = schemaAfter.getQueryType()!.getFields();

      // Verifies dynamic query field generation for the specific custom contract
      expect(fieldsAfter["getDeposits_CAAA1111"]).toBeDefined();
    });

    it("should resolve dynamic fields positionally according to Custom ABI", async () => {
      const customAbi = {
        contractId: "CAAA111122223333444455556666777788889999000011112222333344445555",
        contractName: "Test Deposit Vault",
        events: [
          {
            name: "deposit",
            fields: [
              { name: "depositor", type: "address" },
              { name: "amount", type: "amount" },
              { name: "refCode", type: "string" }
            ]
          }
        ]
      };

      // Register the contract directly in the custom ABI registry
      SERVER_CUSTOM_ABIS.set(customAbi.contractId, customAbi as any);
      invalidateSchemaCache();

      // Mock database events for the contract
      const mockEvent = {
        id: "mock-1",
        contractId: customAbi.contractId,
        ledger: 1000,
        timestamp: 1718919600,
        txHash: "hash-123",
        // topics[0] must match the ascii encoded event name "deposit" -> 6465706f736974
        topics: [
          "0x00000000000000000000000000000000000000000000000000006465706f736974", // "deposit"
          "0x000000000000000000000000GABC1234AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA00", // depositor address hex
        ],
        data: "0x0000000005f5e100", // amount (100,000,000 stroops = 10.00)
        status: "cryptic", // Will be translated dynamically by resolver
        rpcVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(db.event.findMany).mockResolvedValueOnce([mockEvent] as any);

      const query = `
        query GetDeposits {
          getDeposits_CAAA1111 {
            id
            depositor {
              publicKey
              short
            }
            amount {
              formatted
              raw
            }
          }
        }
      `;

      const schema = buildSchema();
      const queryResult = await graphql({
        schema,
        source: query,
      });

      expect(queryResult.errors).toBeUndefined();
      const deposits = queryResult.data?.getDeposits_CAAA1111 as any[];
      expect(deposits).toHaveLength(1);
      expect(deposits[0]).toMatchObject({
        id: "mock-1",
        depositor: {
          publicKey: expect.stringMatching(/^G[0-9A-Z]+$/),
          short: expect.any(String),
        },
        amount: {
          formatted: "10.00",
          raw: "100000000",
        },
      });
    });
  });
});
