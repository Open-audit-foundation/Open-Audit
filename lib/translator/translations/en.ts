import type { TranslationMap } from "../types";

export const EN_TRANSLATIONS: TranslationMap = {
  sac: {
    transfer: (from: string, amount: string, symbol: string, to: string) =>
      `Public Key [${from}] transferred ${amount} ${symbol} to [${to}]`,
    mint: (admin: string, amount: string, symbol: string, to: string) =>
      `Admin [${admin}] minted ${amount} ${symbol} to [${to}]`,
    burn: (from: string, amount: string, symbol: string) =>
      `Public Key [${from}] burned ${amount} ${symbol}`,
    eventTypes: {
      Transfer: "Transfer",
      Mint: "Mint",
      Burn: "Burn",
    },
  },
  sdex: {
    manageBuyOffer: (seller: string, amount: string, buyingAsset: string, sellingAsset: string) =>
      `Account [${seller}] placed a buy offer for ${amount} of asset [${buyingAsset}], offering asset [${sellingAsset}]`,
    manageSellOffer: (seller: string, amount: string, sellingAsset: string, buyingAsset: string) =>
      `Account [${seller}] placed a sell offer for ${amount} of asset [${sellingAsset}], requesting asset [${buyingAsset}]`,
    offerFilled: (seller: string, amount: string, assetSold: string, buyer: string) =>
      `Offer from [${seller}] was filled: ${amount} of asset [${assetSold}] was sold to [${buyer}]`,
    eventTypes: {
      ManageBuyOffer: "Manage Buy Offer",
      ManageSellOffer: "Manage Sell Offer",
      OfferFilled: "Offer Filled",
    },
  },
  soroswap: {
    swap: (path: string, amounts: string, to: string) =>
      `Swap executed along path [${path}] with amounts [${amounts}], tokens sent to [${to}]`,
    addLiquidity: (tokenA: string, amountA: string, tokenB: string, amountB: string, liquidity: string, to: string) =>
      `Added liquidity: ${amountA} of [${tokenA}] and ${amountB} of [${tokenB}] minted ${liquidity} LP tokens to [${to}]`,
    removeLiquidity: (tokenA: string, amountA: string, tokenB: string, amountB: string, liquidity: string, to: string) =>
      `Removed liquidity: burned ${liquidity} LP tokens, received ${amountA} of [${tokenA}] and ${amountB} of [${tokenB}] at [${to}]`,
    eventTypes: {
      Swap: "Swap",
      AddLiquidity: "Add Liquidity",
      RemoveLiquidity: "Remove Liquidity",
    },
  },
  generic: {
    unregisteredContractName: "Unregistered Contract",
    unregisteredContractDescription: (payload: string) => `[Unregistered Contract] ${payload}`,
    unknownEventNoBlueprint: (contractId: string, data: string) =>
      `[Unknown Event: No blueprint registered for contract ${contractId}. Hex Data: ${data}]`,
    unknownEventNoBlueprintApplicable: (contractId: string, ledger: number, data: string) =>
      `[Unknown Event: No blueprint applicable for contract ${contractId} at ledger ${ledger}. Hex Data: ${data}]`,
    invalidStringLength: "[invalid string length]",
    invalidUtf8: "[invalid UTF-8]",
    invalidSymbolLength: "[invalid symbol length]",
    unknownAddress: "[unknown address]",
  },
};
