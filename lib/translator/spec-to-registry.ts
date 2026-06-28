
import { contract, xdr } from "stellar-sdk";
import type { CustomAbi, CustomAbiEvent, CustomAbiField } from "./types";

/**
 * Maps Soroban ScSpecTypeDef types to the type strings used in CustomAbiField.
 * @param type The Soroban ScSpecTypeDef.
 * @returns A string representing the type for CustomAbiField.
 */
function mapSorobanTypeToAbiType(type: xdr.ScSpecTypeDef): string {
  switch (type.switch()) {
    case xdr.ScSpecType.scSpecTypeVal():
      return "val";
    case xdr.ScSpecType.scSpecTypeBool():
      return "bool";
    case xdr.ScSpecType.scSpecTypeVoid():
      return "void";
    case xdr.ScSpecType.scSpecTypeError():
      return "error";
    case xdr.ScSpecType.scSpecTypeU32():
      return "u32";
    case xdr.ScSpecType.scSpecTypeI32():
      return "i32";
    case xdr.ScSpecType.scSpecTypeU64():
      return "u64";
    case xdr.ScSpecType.scSpecTypeI64():
      return "i64";
    case xdr.ScSpecType.scSpecTypeTimepoint():
      return "timepoint";
    case xdr.ScSpecType.scSpecTypeDuration():
      return "duration";
    case xdr.ScSpecType.scSpecTypeU128():
      return "u128";
    case xdr.ScSpecType.scSpecTypeI128():
      return "i128";
    case xdr.ScSpecType.scSpecTypeU256():
      return "u256";
    case xdr.ScSpecType.scSpecTypeI256():
      return "i256";
    case xdr.ScSpecType.scSpecTypeBytes():
      return "bytes";
    case xdr.ScSpecType.scSpecTypeString():
      return "string";
    case xdr.ScSpecType.scSpecTypeSymbol():
      return "symbol";
    case xdr.ScSpecType.scSpecTypeAddress():
      return "address";
    case xdr.ScSpecType.scSpecTypeOption():
      const optionType = type.option()!.valueType();
      return `option<${mapSorobanTypeToAbiType(optionType)}>`;
    case xdr.ScSpecType.scSpecTypeResult():
      const resultType = type.result()!;
      return `result<${mapSorobanTypeToAbiType(resultType.okType())}, ${mapSorobanTypeToAbiType(resultType.errorType())}>`;
    case xdr.ScSpecType.scSpecTypeVec():
      const vecType = type.vec()!.elementType();
      return `vec<${mapSorobanTypeToAbiType(vecType)}>`;
    case xdr.ScSpecType.scSpecTypeMap():
      const mapType = type.map()!;
      return `map<${mapSorobanTypeToAbiType(mapType.keyType())}, ${mapSorobanTypeToAbiType(mapType.valueType())}>`;
    case xdr.ScSpecType.scSpecTypeTuple():
      const tupleTypes = type.tuple()!.valueTypes();
      return `tuple<${tupleTypes.map(mapSorobanTypeToAbiType).join(", ")}>`;
    case xdr.ScSpecType.scSpecTypeBytesN():
      return `bytesN<${type.bytesN()!.n()}>`;
    case xdr.ScSpecType.scSpecTypeStruct():
      return type.struct()!.name().toString();
    case xdr.ScSpecType.scSpecTypeUnion():
      return type.union()!.name().toString();
    case xdr.ScSpecType.scSpecTypeEnum():
      return type.enum_()!.name().toString();
    default:
      return "unknown";
  }
}

/**
 * Generates a CustomAbi from a contract.Spec instance.
 * @param spec The contract.Spec instance to generate the ABI from.
 * @param contractId The contract ID to associate with the ABI.
 * @param contractName An optional human-readable name for the contract.
 * @returns A CustomAbi object ready to use for translation.
 */
export function generateCustomAbiFromSpec(
  spec: contract.Spec,
  contractId: string,
  contractName?: string
): CustomAbi {
  const events: CustomAbiEvent[] = [];

  // Extract all event specs from the spec entries
  for (const entry of spec.entries) {
    if (entry.switch() === xdr.ScSpecEntryKind.scSpecEntryUdEventV0()) {
      const eventSpec = entry.udEventV0()!;
      const eventName = eventSpec.name().toString();
      const fields: CustomAbiField[] = [];

      // Process event fields
      const inputSpecs = eventSpec.inputs();
      for (let i = 0; i < inputSpecs.length; i++) {
        const inputSpec = inputSpecs[i];
        fields.push({
          name: inputSpec.name().toString(),
          type: mapSorobanTypeToAbiType(inputSpec.type()),
        });
      }

      events.push({
        name: eventName,
        fields,
      });
    }
  }

  return {
    contractId,
    contractName: contractName || `Custom Contract (${contractId.slice(0, 6)}...)`,
    events,
  };
}

/**
 * Generates a translation registry draft in JSON format (compatible with registry.schema.json).
 * @param spec The contract.Spec instance.
 * @param contractId The contract ID.
 * @param contractName Optional human-readable name.
 * @returns An array of registry entries ready for JSON serialization.
 */
export function generateRegistryDraft(
  spec: contract.Spec,
  contractId: string,
  contractName?: string
): any[] {
  const registryEntries: any[] = [];

  for (const entry of spec.entries) {
    if (entry.switch() === xdr.ScSpecEntryKind.scSpecEntryUdEventV0()) {
      const eventSpec = entry.udEventV0()!;
      const eventName = eventSpec.name().toString();
      const inputSpecs = eventSpec.inputs();
      
      // Split inputs into topics (first N) and data (last 1 if any)
      // This is a heuristic since Soroban events can have arbitrary topics/data layout
      // We'll assume that the first topic is the event name, then topics 1.. are from inputs,
      // and if there's an odd number, the last is data.
      const topics = [eventName, ...inputSpecs.slice(0, -1).map((s) => s.name().toString())];
      const dataField = inputSpecs.length > 0 && inputSpecs.length % 2 === 1 
        ? inputSpecs[inputSpecs.length - 1] 
        : null;

      const entry: any = {
        contract_id: contractId,
        topics,
        event_structure: {
          topics: inputSpecs.slice(0, -1).map((s) => ({
            name: s.name().toString(),
            type: mapSorobanTypeToAbiType(s.type()),
          })),
        },
        templates: {
          en: `${eventName.charAt(0).toUpperCase() + eventName.slice(1)} event`,
        },
      };

      if (dataField) {
        entry.event_structure.data = {
          name: dataField.name().toString(),
          type: mapSorobanTypeToAbiType(dataField.type()),
        };
      }

      registryEntries.push(entry);
    }
  }

  return registryEntries;
}
