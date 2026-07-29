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
    swap: (to: string, amountIn: string, tokenIn: string, amountOut: string, tokenOut: string) =>
      `Le compte [${to}] a échangé ${amountIn} de l'actif [${tokenIn}] contre ${amountOut} de l'actif [${tokenOut}]`,
    addLiquidity: (to: string, amountA: string, tokenA: string, amountB: string, tokenB: string, liquidity: string) =>
      `Le compte [${to}] a ajouté ${amountA} de l'actif [${tokenA}] et ${amountB} de l'actif [${tokenB}] au pool, recevant ${liquidity} jetons de liquidité`,
    removeLiquidity: (to: string, amountA: string, tokenA: string, amountB: string, tokenB: string, liquidity: string) =>
      `Le compte [${to}] a retiré ${amountA} de l'actif [${tokenA}] et ${amountB} de l'actif [${tokenB}] du pool, brûlant ${liquidity} jetons de liquidité`,
    eventTypes: {
      Swap: "Échange",
      AddLiquidity: "Ajout de Liquidité",
      RemoveLiquidity: "Retrait de Liquidité",
    },
  },
  blend: {
    supply: (from: string, amount: string, asset: string) =>
      `Le compte [${from}] a fourni ${amount} de l'actif [${asset}] au pool`,
    borrow: (from: string, amount: string, asset: string) =>
      `Le compte [${from}] a emprunté ${amount} de l'actif [${asset}] au pool`,
    repay: (from: string, amount: string, asset: string) =>
      `Le compte [${from}] a remboursé ${amount} de l'actif [${asset}] au pool`,
    withdraw: (from: string, amount: string, asset: string) =>
      `Le compte [${from}] a retiré ${amount} de l'actif [${asset}] du pool`,
    liquidate: (user: string, filler: string, amount: string) =>
      `Le compte [${filler}] a liquidé ${amount} de garantie du compte [${user}]`,
    eventTypes: {
      Supply: "Approvisionnement",
      Borrow: "Emprunt",
      Repay: "Remboursement",
      Withdraw: "Retrait",
      Liquidate: "Liquidation",
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
