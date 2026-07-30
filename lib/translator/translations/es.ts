import type { TranslationMap } from "../types";

export const ES_TRANSLATIONS: TranslationMap = {
  sac: {
    transfer: (from: string, amount: string, symbol: string, to: string) =>
      `Clave pública [${from}] transfirió ${amount} ${symbol} a [${to}]`,
    mint: (admin: string, amount: string, symbol: string, to: string) =>
      `Administrador [${admin}] minteó ${amount} ${symbol} a [${to}]`,
    burn: (from: string, amount: string, symbol: string) =>
      `Clave pública [${from}] quemó ${amount} ${symbol}`,
    eventTypes: {
      Transfer: "Transferencia",
      Mint: "Minteo",
      Burn: "Quema",
    },
  },
  sdex: {
    manageBuyOffer: (seller: string, amount: string, buyingAsset: string, sellingAsset: string) =>
      `La cuenta [${seller}] colocó una oferta de compra por ${amount} del activo [${buyingAsset}], ofreciendo el activo [${sellingAsset}]`,
    manageSellOffer: (seller: string, amount: string, sellingAsset: string, buyingAsset: string) =>
      `La cuenta [${seller}] colocó una oferta de venta por ${amount} del activo [${sellingAsset}], solicitando el activo [${buyingAsset}]`,
    offerFilled: (seller: string, amount: string, assetSold: string, buyer: string) =>
      `La oferta de [${seller}] fue completada: ${amount} del activo [${assetSold}] fue vendido a [${buyer}]`,
    eventTypes: {
      ManageBuyOffer: "Gestionar Oferta de Compra",
      ManageSellOffer: "Gestionar Oferta de Venta",
      OfferFilled: "Oferta Completada",
    },
  },
  soroswap: {
    swap: (to: string, amountIn: string, tokenIn: string, amountOut: string, tokenOut: string) =>
      `La cuenta [${to}] intercambió ${amountIn} del activo [${tokenIn}] por ${amountOut} del activo [${tokenOut}]`,
    addLiquidity: (to: string, amountA: string, tokenA: string, amountB: string, tokenB: string, liquidity: string) =>
      `La cuenta [${to}] agregó ${amountA} del activo [${tokenA}] y ${amountB} del activo [${tokenB}] al pool, recibiendo ${liquidity} tokens de liquidez`,
    removeLiquidity: (to: string, amountA: string, tokenA: string, amountB: string, tokenB: string, liquidity: string) =>
      `La cuenta [${to}] retiró ${amountA} del activo [${tokenA}] y ${amountB} del activo [${tokenB}] del pool, quemando ${liquidity} tokens de liquidez`,
    eventTypes: {
      Swap: "Intercambio",
      AddLiquidity: "Agregar Liquidez",
      RemoveLiquidity: "Retirar Liquidez",
    },
  },
  blend: {
    supply: (from: string, amount: string, asset: string) =>
      `La cuenta [${from}] suministró ${amount} del activo [${asset}] al pool`,
    borrow: (from: string, amount: string, asset: string) =>
      `La cuenta [${from}] pidió prestado ${amount} del activo [${asset}] del pool`,
    repay: (from: string, amount: string, asset: string) =>
      `La cuenta [${from}] pagó ${amount} del activo [${asset}] al pool`,
    withdraw: (from: string, amount: string, asset: string) =>
      `La cuenta [${from}] retiró ${amount} del activo [${asset}] del pool`,
    liquidate: (user: string, filler: string, amount: string) =>
      `La cuenta [${filler}] liquidó ${amount} de garantía de la cuenta [${user}]`,
    eventTypes: {
      Supply: "Suministro",
      Borrow: "Préstamo",
      Repay: "Pago",
      Withdraw: "Retiro",
      Liquidate: "Liquidación",
    },
  },
  generic: {
    unregisteredContractName: "Contrato no registrado",
    unregisteredContractDescription: (payload: string) => `[Contrato no registrado] ${payload}`,
    unknownEventNoBlueprint: (contractId: string, data: string) =>
      `[Evento desconocido: no hay ningún blueprint registrado para el contrato ${contractId}. Datos hexadecimales: ${data}]`,
    unknownEventNoBlueprintApplicable: (contractId: string, ledger: number, data: string) =>
      `[Evento desconocido: ningún blueprint aplicable para el contrato ${contractId} en el ledger ${ledger}. Datos hexadecimales: ${data}]`,
    invalidStringLength: "[longitud de cadena inválida]",
    invalidUtf8: "[UTF-8 inválido]",
    invalidSymbolLength: "[longitud de símbolo inválida]",
    unknownAddress: "[dirección desconocida]",
  },
};
