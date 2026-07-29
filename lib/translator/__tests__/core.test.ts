import { describe, it, expect, vi } from "vitest";
import { decodeAddress, shortenAddress } from "../core";
import { xdr, StrKey, Keypair } from "stellar-sdk";

describe("decodeAddress", () => {
  // Fixtures: real XDR hex strings
  const TEST_ACCOUNT = Keypair.random().publicKey();
  const TEST_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 0x42));

  // Create ScVal for account address
  const accountScVal = xdr.ScVal.scvAddress(
    xdr.ScAddress.scAddressTypeAccount(
      xdr.PublicKey.publicKeyTypeEd25519(
        StrKey.decodeEd25519PublicKey(TEST_ACCOUNT)
      )
    )
  );
  const ACCOUNT_HEX = `0x${accountScVal.toXDR("hex")}`;

  // Create ScVal for contract address
  const contractScVal = xdr.ScVal.scvAddress(
    xdr.ScAddress.scAddressTypeContract(
      StrKey.decodeContract(TEST_CONTRACT)
    )
  );
  const CONTRACT_HEX = `0x${contractScVal.toXDR("hex")}`;

  it("decodes Ed25519 account addresses correctly", () => {
    const result = decodeAddress(ACCOUNT_HEX);
    expect(result.publicKey).toBe(TEST_ACCOUNT);
    expect(result.short).toBe(shortenAddress(TEST_ACCOUNT));
  });

  it("decodes Soroban contract addresses correctly", () => {
    const result = decodeAddress(CONTRACT_HEX);
    expect(result.publicKey).toBe(TEST_CONTRACT);
    expect(result.short).toBe(shortenAddress(TEST_CONTRACT));
  });

  it("handles malformed inputs gracefully", () => {
    const invalidHex = "0xdeadbeef";
    const result = decodeAddress(invalidHex);
    expect(result.publicKey).toMatch(/^G[A-Z0-9]+$/);
  });

  it("preserves memo cache behavior", () => {
    const firstCall = decodeAddress(ACCOUNT_HEX);
    const secondCall = decodeAddress(ACCOUNT_HEX);
    // Check they are the exact same object (memoization working)
    expect(firstCall).toBe(secondCall);
  });
});
