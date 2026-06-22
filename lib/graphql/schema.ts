import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
} from "graphql";
import { db } from "../db/client";
import {
  getRegisteredContracts,
  registerBlueprint,
  translateEvent,
} from "../translator/registry";
import {
  decodeAddress,
  decodeAmount,
  truncateHex,
} from "../translator/core";
import {
  CustomAbi,
  customAbiToBlueprint,
  parseCustomAbi,
} from "../translator/custom-abi";

// In-memory server-side registry of custom ABIs
export const SERVER_CUSTOM_ABIS = new Map<string, CustomAbi>();

// Cache for the generated schema
let cachedSchema: GraphQLSchema | null = null;
let schemaVersion = 0;

export function invalidateSchemaCache() {
  cachedSchema = null;
  schemaVersion++;
}

export function getSchemaVersion() {
  return schemaVersion;
}

const AddressType = new GraphQLObjectType({
  name: "Address",
  fields: {
    publicKey: { type: new GraphQLNonNull(GraphQLString) },
    short: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const AmountType = new GraphQLObjectType({
  name: "Amount",
  fields: {
    raw: { type: new GraphQLNonNull(GraphQLString) },
    formatted: { type: new GraphQLNonNull(GraphQLString) },
    symbol: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const EventType = new GraphQLObjectType({
  name: "Event",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    contractId: { type: new GraphQLNonNull(GraphQLString) },
    ledger: { type: new GraphQLNonNull(GraphQLInt) },
    timestamp: { type: new GraphQLNonNull(GraphQLInt) },
    txHash: { type: new GraphQLNonNull(GraphQLString) },
    topics: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
    data: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    status: { type: new GraphQLNonNull(GraphQLString) },
    blueprintName: { type: GraphQLString },
    eventType: { type: GraphQLString },
    ipfsCids: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
    rpcVerified: { type: new GraphQLNonNull(GraphQLBoolean) },
    createdAt: { type: new GraphQLNonNull(GraphQLString) },
    updatedAt: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const TransferEventType = new GraphQLObjectType({
  name: "TransferEvent",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    contractId: { type: new GraphQLNonNull(GraphQLString) },
    ledger: { type: new GraphQLNonNull(GraphQLInt) },
    timestamp: { type: new GraphQLNonNull(GraphQLInt) },
    txHash: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    from: { type: new GraphQLNonNull(AddressType) },
    to: { type: new GraphQLNonNull(AddressType) },
    amount: { type: new GraphQLNonNull(AmountType) },
  },
});

const MintEventType = new GraphQLObjectType({
  name: "MintEvent",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    contractId: { type: new GraphQLNonNull(GraphQLString) },
    ledger: { type: new GraphQLNonNull(GraphQLInt) },
    timestamp: { type: new GraphQLNonNull(GraphQLInt) },
    txHash: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    admin: { type: new GraphQLNonNull(AddressType) },
    to: { type: new GraphQLNonNull(AddressType) },
    amount: { type: new GraphQLNonNull(AmountType) },
  },
});

const BurnEventType = new GraphQLObjectType({
  name: "BurnEvent",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    contractId: { type: new GraphQLNonNull(GraphQLString) },
    ledger: { type: new GraphQLNonNull(GraphQLInt) },
    timestamp: { type: new GraphQLNonNull(GraphQLInt) },
    txHash: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: GraphQLString },
    from: { type: new GraphQLNonNull(AddressType) },
    amount: { type: new GraphQLNonNull(AmountType) },
  },
});

const RegisteredContractType = new GraphQLObjectType({
  name: "RegisteredContract",
  fields: {
    contractId: { type: new GraphQLNonNull(GraphQLString) },
    contractName: { type: new GraphQLNonNull(GraphQLString) },
    isCustom: { type: new GraphQLNonNull(GraphQLBoolean) },
    events: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
  },
});

const ADDRESS_TYPES = new Set(["address", "account", "contract"]);
const AMOUNT_TYPES = new Set(["amount", "i128", "u128", "i64", "u64", "i32", "u32"]);

function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function buildCustomEventTypes(customAbis: Map<string, CustomAbi>): Record<string, GraphQLObjectType> {
  const types: Record<string, GraphQLObjectType> = {};
  for (const [contractId, abi] of customAbis.entries()) {
    const shortId = contractId.slice(0, 8);
    for (const eventDef of abi.events) {
      const typeName = `CustomEvent_${shortId}_${capitalize(eventDef.name)}`;
      
      const fields: Record<string, any> = {
        id: { type: new GraphQLNonNull(GraphQLString) },
        contractId: { type: new GraphQLNonNull(GraphQLString) },
        ledger: { type: new GraphQLNonNull(GraphQLInt) },
        timestamp: { type: new GraphQLNonNull(GraphQLInt) },
        txHash: { type: new GraphQLNonNull(GraphQLString) },
        description: { type: GraphQLString },
      };

      for (const field of eventDef.fields) {
        const type = field.type.toLowerCase();
        if (ADDRESS_TYPES.has(type)) {
          fields[field.name] = { type: new GraphQLNonNull(AddressType) };
        } else if (AMOUNT_TYPES.has(type)) {
          fields[field.name] = { type: new GraphQLNonNull(AmountType) };
        } else {
          fields[field.name] = { type: new GraphQLNonNull(GraphQLString) };
        }
      }

      types[typeName] = new GraphQLObjectType({
        name: typeName,
        fields,
      });
    }
  }
  return types;
}

export function buildSchema(): GraphQLSchema {
  if (cachedSchema) return cachedSchema;

  const customEventTypes = buildCustomEventTypes(SERVER_CUSTOM_ABIS);
  const queryFields: Record<string, any> = {
    // 1. Generic queries
    events: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(EventType))),
      args: {
        contractId: { type: GraphQLString },
        limit: { type: GraphQLInt },
        offset: { type: GraphQLInt },
      },
      resolve: async (_, args) => {
        const { contractId, limit = 10, offset = 0 } = args;
        const whereClause = contractId ? { contractId } : {};
        return await db.event.findMany({
          where: whereClause,
          take: limit,
          skip: offset,
          orderBy: { ledger: "desc" },
        });
      },
    },

    getRegisteredContracts: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(RegisteredContractType))),
      resolve: () => {
        const contractIds = getRegisteredContracts();
        return contractIds.map((id) => {
          const customAbi = SERVER_CUSTOM_ABIS.get(id);
          if (customAbi) {
            return {
              contractId: id,
              contractName: customAbi.contractName,
              isCustom: true,
              events: customAbi.events.map((e) => e.name),
            };
          } else {
            // Built-in standard SAC contracts
            const knownSymbols: Record<string, string> = {
              CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC: "USDC",
              CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA: "XLM",
              CAZAQB3D7KSLSNOSQKYD2V4JP5V2Y3B4RDJZRLBFCCIXDCTE3WHSY3UE: "EURC",
              CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM: "USDC",
              CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: "XLM",
            };
            const symbol = knownSymbols[id] ?? "TOKEN";
            return {
              contractId: id,
              contractName: `Stellar Asset Contract (${symbol})`,
              isCustom: false,
              events: ["transfer", "mint", "burn"],
            };
          }
        });
      },
    },

    getTransfers: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(TransferEventType))),
      args: {
        contractId: { type: new GraphQLNonNull(GraphQLString) },
        limit: { type: GraphQLInt },
        offset: { type: GraphQLInt },
      },
      resolve: async (_, args) => {
        const { contractId, limit = 10, offset = 0 } = args;
        const events = await db.event.findMany({
          where: { contractId },
          take: limit,
          skip: offset,
          orderBy: { ledger: "desc" },
        });
        const results: any[] = [];
        for (const event of events) {
          const rawEvent = {
            id: event.id,
            contractId: event.contractId,
            ledger: event.ledger,
            timestamp: event.timestamp,
            txHash: event.txHash,
            topics: event.topics as string[],
            data: event.data,
          };
          const translated = translateEvent(rawEvent);
          if (translated.eventType === "Transfer" && rawEvent.topics.length >= 3) {
            results.push({
              id: rawEvent.id,
              contractId: rawEvent.contractId,
              ledger: rawEvent.ledger,
              timestamp: rawEvent.timestamp,
              txHash: rawEvent.txHash,
              description: translated.description,
              from: decodeAddress(rawEvent.topics[1]),
              to: decodeAddress(rawEvent.topics[2]),
              amount: decodeAmount(rawEvent.data, translated.blueprintName?.includes("USDC") ? "USDC" : "XLM"),
            });
          }
        }
        return results;
      },
    },

    getMints: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(MintEventType))),
      args: {
        contractId: { type: new GraphQLNonNull(GraphQLString) },
        limit: { type: GraphQLInt },
        offset: { type: GraphQLInt },
      },
      resolve: async (_, args) => {
        const { contractId, limit = 10, offset = 0 } = args;
        const events = await db.event.findMany({
          where: { contractId },
          take: limit,
          skip: offset,
          orderBy: { ledger: "desc" },
        });
        const results: any[] = [];
        for (const event of events) {
          const rawEvent = {
            id: event.id,
            contractId: event.contractId,
            ledger: event.ledger,
            timestamp: event.timestamp,
            txHash: event.txHash,
            topics: event.topics as string[],
            data: event.data,
          };
          const translated = translateEvent(rawEvent);
          if (translated.eventType === "Mint" && rawEvent.topics.length >= 3) {
            results.push({
              id: rawEvent.id,
              contractId: rawEvent.contractId,
              ledger: rawEvent.ledger,
              timestamp: rawEvent.timestamp,
              txHash: rawEvent.txHash,
              description: translated.description,
              admin: decodeAddress(rawEvent.topics[1]),
              to: decodeAddress(rawEvent.topics[2]),
              amount: decodeAmount(rawEvent.data, translated.blueprintName?.includes("USDC") ? "USDC" : "XLM"),
            });
          }
        }
        return results;
      },
    },

    getBurns: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(BurnEventType))),
      args: {
        contractId: { type: new GraphQLNonNull(GraphQLString) },
        limit: { type: GraphQLInt },
        offset: { type: GraphQLInt },
      },
      resolve: async (_, args) => {
        const { contractId, limit = 10, offset = 0 } = args;
        const events = await db.event.findMany({
          where: { contractId },
          take: limit,
          skip: offset,
          orderBy: { ledger: "desc" },
        });
        const results: any[] = [];
        for (const event of events) {
          const rawEvent = {
            id: event.id,
            contractId: event.contractId,
            ledger: event.ledger,
            timestamp: event.timestamp,
            txHash: event.txHash,
            topics: event.topics as string[],
            data: event.data,
          };
          const translated = translateEvent(rawEvent);
          if (translated.eventType === "Burn" && rawEvent.topics.length >= 2) {
            results.push({
              id: rawEvent.id,
              contractId: rawEvent.contractId,
              ledger: rawEvent.ledger,
              timestamp: rawEvent.timestamp,
              txHash: rawEvent.txHash,
              description: translated.description,
              from: decodeAddress(rawEvent.topics[1]),
              amount: decodeAmount(rawEvent.data, translated.blueprintName?.includes("USDC") ? "USDC" : "XLM"),
            });
          }
        }
        return results;
      },
    },
  };

  // 2. Add contract-specific fields dynamically
  const registeredIds = getRegisteredContracts();
  for (const contractId of registeredIds) {
    const shortId = contractId.slice(0, 8);
    const customAbi = SERVER_CUSTOM_ABIS.get(contractId);

    if (customAbi) {
      // Dynamic fields for custom ABI
      for (const eventDef of customAbi.events) {
        const typeName = `CustomEvent_${shortId}_${capitalize(eventDef.name)}`;
        const type = customEventTypes[typeName];
        if (!type) continue;

        const fieldName = `get${capitalize(eventDef.name)}s_${shortId}`;
        queryFields[fieldName] = {
          type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(type))),
          args: {
            limit: { type: GraphQLInt },
            offset: { type: GraphQLInt },
          },
          resolve: async (_, args) => {
            const { limit = 10, offset = 0 } = args;
            const events = await db.event.findMany({
              where: { contractId },
              take: limit,
              skip: offset,
              orderBy: { ledger: "desc" },
            });
            const results: any[] = [];
            for (const event of events) {
              const rawEvent = {
                id: event.id,
                contractId: event.contractId,
                ledger: event.ledger,
                timestamp: event.timestamp,
                txHash: event.txHash,
                topics: event.topics as string[],
                data: event.data,
              };
              const translated = translateEvent(rawEvent);
              if (translated.eventType === capitalize(eventDef.name)) {
                const positions = [...rawEvent.topics.slice(1), rawEvent.data];
                const resolvedFields: Record<string, any> = {
                  id: rawEvent.id,
                  contractId: rawEvent.contractId,
                  ledger: rawEvent.ledger,
                  timestamp: rawEvent.timestamp,
                  txHash: rawEvent.txHash,
                  description: translated.description,
                };
                
                eventDef.fields.forEach((field, index) => {
                  const hex = positions[index] ?? "0x00";
                  const typeStr = field.type.toLowerCase();
                  if (ADDRESS_TYPES.has(typeStr)) {
                    resolvedFields[field.name] = decodeAddress(hex);
                  } else if (AMOUNT_TYPES.has(typeStr)) {
                    resolvedFields[field.name] = decodeAmount(hex);
                  } else {
                    resolvedFields[field.name] = truncateHex(hex, 6);
                  }
                });

                results.push(resolvedFields);
              }
            }
            return results;
          },
        };
      }
    } else {
      // Contract-specific fields for standard built-in contracts
      const getTransfersFieldName = `getTransfers_${shortId}`;
      queryFields[getTransfersFieldName] = {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(TransferEventType))),
        args: {
          limit: { type: GraphQLInt },
          offset: { type: GraphQLInt },
        },
        resolve: async (_, args) => {
          const { limit = 10, offset = 0 } = args;
          const events = await db.event.findMany({
            where: { contractId },
            take: limit,
            skip: offset,
            orderBy: { ledger: "desc" },
          });
          const results: any[] = [];
          for (const event of events) {
            const rawEvent = {
              id: event.id,
              contractId: event.contractId,
              ledger: event.ledger,
              timestamp: event.timestamp,
              txHash: event.txHash,
              topics: event.topics as string[],
              data: event.data,
            };
            const translated = translateEvent(rawEvent);
            if (translated.eventType === "Transfer" && rawEvent.topics.length >= 3) {
              results.push({
                id: rawEvent.id,
                contractId: rawEvent.contractId,
                ledger: rawEvent.ledger,
                timestamp: rawEvent.timestamp,
                txHash: rawEvent.txHash,
                description: translated.description,
                from: decodeAddress(rawEvent.topics[1]),
                to: decodeAddress(rawEvent.topics[2]),
                amount: decodeAmount(rawEvent.data, translated.blueprintName?.includes("USDC") ? "USDC" : "XLM"),
              });
            }
          }
          return results;
        },
      };

      const getMintsFieldName = `getMints_${shortId}`;
      queryFields[getMintsFieldName] = {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(MintEventType))),
        args: {
          limit: { type: GraphQLInt },
          offset: { type: GraphQLInt },
        },
        resolve: async (_, args) => {
          const { limit = 10, offset = 0 } = args;
          const events = await db.event.findMany({
            where: { contractId },
            take: limit,
            skip: offset,
            orderBy: { ledger: "desc" },
          });
          const results: any[] = [];
          for (const event of events) {
            const rawEvent = {
              id: event.id,
              contractId: event.contractId,
              ledger: event.ledger,
              timestamp: event.timestamp,
              txHash: event.txHash,
              topics: event.topics as string[],
              data: event.data,
            };
            const translated = translateEvent(rawEvent);
            if (translated.eventType === "Mint" && rawEvent.topics.length >= 3) {
              results.push({
                id: rawEvent.id,
                contractId: rawEvent.contractId,
                ledger: rawEvent.ledger,
                timestamp: rawEvent.timestamp,
                txHash: rawEvent.txHash,
                description: translated.description,
                admin: decodeAddress(rawEvent.topics[1]),
                to: decodeAddress(rawEvent.topics[2]),
                amount: decodeAmount(rawEvent.data, translated.blueprintName?.includes("USDC") ? "USDC" : "XLM"),
              });
            }
          }
          return results;
        },
      };

      const getBurnsFieldName = `getBurns_${shortId}`;
      queryFields[getBurnsFieldName] = {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(BurnEventType))),
        args: {
          limit: { type: GraphQLInt },
          offset: { type: GraphQLInt },
        },
        resolve: async (_, args) => {
          const { limit = 10, offset = 0 } = args;
          const events = await db.event.findMany({
            where: { contractId },
            take: limit,
            skip: offset,
            orderBy: { ledger: "desc" },
          });
          const results: any[] = [];
          for (const event of events) {
            const rawEvent = {
              id: event.id,
              contractId: event.contractId,
              ledger: event.ledger,
              timestamp: event.timestamp,
              txHash: event.txHash,
              topics: event.topics as string[],
              data: event.data,
            };
            const translated = translateEvent(rawEvent);
            if (translated.eventType === "Burn" && rawEvent.topics.length >= 2) {
              results.push({
                id: rawEvent.id,
                contractId: rawEvent.contractId,
                ledger: rawEvent.ledger,
                timestamp: rawEvent.timestamp,
                txHash: rawEvent.txHash,
                description: translated.description,
                from: decodeAddress(rawEvent.topics[1]),
                amount: decodeAmount(rawEvent.data, translated.blueprintName?.includes("USDC") ? "USDC" : "XLM"),
              });
            }
          }
          return results;
        },
      };
    }
  }

  const QueryType = new GraphQLObjectType({
    name: "Query",
    fields: queryFields,
  });

  const MutationType = new GraphQLObjectType({
    name: "Mutation",
    fields: {
      registerContract: {
        type: new GraphQLNonNull(RegisteredContractType),
        args: {
          contractId: { type: new GraphQLNonNull(GraphQLString) },
          contractName: { type: GraphQLString },
          abiJson: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: async (_, args) => {
          const { contractId, contractName, abiJson } = args;
          const parsedJson = JSON.parse(abiJson);
          const customAbi = parseCustomAbi(parsedJson, contractId);
          if (contractName) {
            customAbi.contractName = contractName;
          }
          
          SERVER_CUSTOM_ABIS.set(contractId, customAbi);
          const blueprint = customAbiToBlueprint(customAbi);
          registerBlueprint(blueprint);
          invalidateSchemaCache();

          return {
            contractId,
            contractName: customAbi.contractName,
            isCustom: true,
            events: customAbi.events.map((e) => e.name),
          };
        },
      },
    },
  });

  cachedSchema = new GraphQLSchema({
    query: QueryType,
    mutation: MutationType,
  });

  return cachedSchema;
}
