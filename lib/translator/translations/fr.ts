import type { TranslationMap } from "../types";

export const FR_TRANSLATIONS: TranslationMap = {
  sac: {
    transfer: (from: string, amount: string, symbol: string, to: string) =>
      `Clé publique [${from}] a transféré ${amount} ${symbol} à [${to}]`,
    mint: (admin: string, amount: string, symbol: string, to: string) =>
      `Administrateur [${admin}] a miné ${amount} ${symbol} à [${to}]`,
    burn: (from: string, amount: string, symbol: string) =>
      `Clé publique [${from}] a brûlé ${amount} ${symbol}`,
    eventTypes: {
      Transfer: "Transfert",
      Mint: "Minage",
      Burn: "Brûlure",
    },
  },
  sdex: {
    manageBuyOffer: (seller: string, amount: string, buyingAsset: string, sellingAsset: string) =>
      `Le compte [${seller}] a placé une offre d'achat pour ${amount} de l'actif [${buyingAsset}], en offrant l'actif [${sellingAsset}]`,
    manageSellOffer: (seller: string, amount: string, sellingAsset: string, buyingAsset: string) =>
      `Le compte [${seller}] a placé une offre de vente pour ${amount} de l'actif [${sellingAsset}], en demandant l'actif [${buyingAsset}]`,
    offerFilled: (seller: string, amount: string, assetSold: string, buyer: string) =>
      `L'offre de [${seller}] a été exécutée : ${amount} de l'actif [${assetSold}] a été vendu à [${buyer}]`,
    eventTypes: {
      ManageBuyOffer: "Gestion Offre Achat",
      ManageSellOffer: "Gestion Offre de Vente",
      OfferFilled: "Offre Exécutée",
    },
  },
  soroswap: {
    swap: (path: string, amounts: string, to: string) =>
      `Swap exécuté sur le chemin [${path}] avec les montants [${amounts}], tokens envoyés à [${to}]`,
    addLiquidity: (tokenA: string, amountA: string, tokenB: string, amountB: string, liquidity: string, to: string) =>
      `Ajout de liquidité : ${amountA} de [${tokenA}] et ${amountB} de [${tokenB}] ont miné ${liquidity} tokens LP à [${to}]`,
    removeLiquidity: (tokenA: string, amountA: string, tokenB: string, amountB: string, liquidity: string, to: string) =>
      `Retrait de liquidité : ${liquidity} tokens LP brûlés, reçu ${amountA} de [${tokenA}] et ${amountB} de [${tokenB}] à [${to}]`,
    eventTypes: {
      Swap: "Swap",
      AddLiquidity: "Ajout de Liquidité",
      RemoveLiquidity: "Retrait de Liquidité",
    },
  },
  generic: {
    unregisteredContractName: "Contrat non enregistré",
    unregisteredContractDescription: (payload: string) => `[Contrat non enregistré] ${payload}`,
    unknownEventNoBlueprint: (contractId: string, data: string) =>
      `[Événement inconnu : aucun modèle enregistré pour le contrat ${contractId}. Données hexadécimales : ${data}]`,
    unknownEventNoBlueprintApplicable: (contractId: string, ledger: number, data: string) =>
      `[Événement inconnu : aucun modèle applicable pour le contrat ${contractId} au ledger ${ledger}. Données hexadécimales : ${data}]`,
    invalidStringLength: "[longueur de chaîne invalide]",
    invalidUtf8: "[UTF-8 invalide]",
    invalidSymbolLength: "[longueur de symbole invalide]",
    unknownAddress: "[adresse inconnue]",
  },
};
