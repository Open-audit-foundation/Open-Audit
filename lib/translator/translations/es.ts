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
