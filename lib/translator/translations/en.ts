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
    swap: (to: string, amountIn: string, tokenIn: string, amountOut: string, tokenOut: string) =>
      `Account [${to}] swapped ${amountIn} of asset [${tokenIn}] for ${amountOut} of asset [${tokenOut}]`,
    addLiquidity: (to: string, amountA: string, tokenA: string, amountB: string, tokenB: string, liquidity: string) =>
      `Account [${to}] added ${amountA} of asset [${tokenA}] and ${amountB} of asset [${tokenB}] to the pool, receiving ${liquidity} liquidity tokens`,
    removeLiquidity: (to: string, amountA: string, tokenA: string, amountB: string, tokenB: string, liquidity: string) =>
      `Account [${to}] removed ${amountA} of asset [${tokenA}] and ${amountB} of asset [${tokenB}] from the pool, burning ${liquidity} liquidity tokens`,
    eventTypes: {
      Swap: "Swap",
      AddLiquidity: "Add Liquidity",
      RemoveLiquidity: "Remove Liquidity",
    },
  },
  blend: {
    supply: (from: string, amount: string, asset: string) =>
      `Account [${from}] supplied ${amount} of asset [${asset}] to the pool`,
    borrow: (from: string, amount: string, asset: string) =>
      `Account [${from}] borrowed ${amount} of asset [${asset}] from the pool`,
    repay: (from: string, amount: string, asset: string) =>
      `Account [${from}] repaid ${amount} of asset [${asset}] to the pool`,
    withdraw: (from: string, amount: string, asset: string) =>
      `Account [${from}] withdrew ${amount} of asset [${asset}] from the pool`,
    liquidate: (user: string, filler: string, amount: string) =>
      `Account [${filler}] liquidated ${amount} of collateral from account [${user}]`,
    eventTypes: {
      Supply: "Supply",
      Borrow: "Borrow",
      Repay: "Repay",
      Withdraw: "Withdraw",
      Liquidate: "Liquidate",
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
