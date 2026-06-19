export const FR_TRANSLATIONS = {
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
};
