
import { SorobanRpc, xdr, contract, Address } from "stellar-sdk";
import { getNetworkConfig } from "./client";
import type { StellarNetworkConfig } from "./client";

/**
 * Fetches the raw WASM bytecode of a Soroban contract from the network.
 * @param contractId The contract ID to fetch the WASM for.
 * @param config The network configuration (defaults to testnet if not provided).
 * @returns A Promise that resolves to a Buffer containing the contract WASM.
 */
export async function fetchContractWasm(
  contractId: string,
  config?: StellarNetworkConfig
): Promise<Buffer> {
  const networkConfig = config || getNetworkConfig();
  const server = new SorobanRpc.Server(networkConfig.sorobanRpcUrl);

  // Step 1: Get the contract instance ledger entry to find the WASM hash
  const contractAddress = Address.fromString(contractId).toScAddress();
  const contractInstanceKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractAddress,
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );

  const contractInstanceResponse = await server.getLedgerEntries([
    contractInstanceKey.toXDR("base64"),
  ]);

  if (!contractInstanceResponse.entries || contractInstanceResponse.entries.length === 0) {
    throw new Error(`Contract instance not found for ID: ${contractId}`);
  }

  const contractInstanceEntry = contractInstanceResponse.entries[0];
  const ledgerEntry = xdr.LedgerEntry.fromXDR(
    Buffer.from(contractInstanceEntry.xdr, "base64")
  );
  const contractData = ledgerEntry.data().contractData();
  const contractInstance = contractData.val().instance();
  const wasmHash = contractInstance.executable().wasmHash();

  // Step 2: Fetch the WASM ledger entry using the hash
  const wasmKey = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({
      hash: wasmHash,
    })
  );

  const wasmResponse = await server.getLedgerEntries([wasmKey.toXDR("base64")]);

  if (!wasmResponse.entries || wasmResponse.entries.length === 0) {
    throw new Error(`WASM entry not found for hash: ${wasmHash.toString("hex")}`);
  }

  const wasmEntry = wasmResponse.entries[0];
  const wasmLedgerEntry = xdr.LedgerEntry.fromXDR(Buffer.from(wasmEntry.xdr, "base64"));
  const contractCode = wasmLedgerEntry.data().contractCode();
  const wasmBuffer = contractCode.code();

  return Buffer.from(wasmBuffer);
}

/**
 * Fetches the contract spec from the network by first fetching the WASM and then parsing it.
 * @param contractId The contract ID to fetch the spec for.
 * @param config The network configuration (defaults to testnet if not provided).
 * @returns A Promise that resolves to a contract.Spec instance.
 */
export async function fetchContractSpec(
  contractId: string,
  config?: StellarNetworkConfig
): Promise<contract.Spec> {
  const wasmBuffer = await fetchContractWasm(contractId, config);
  return contract.Spec.fromWasm(wasmBuffer);
}
