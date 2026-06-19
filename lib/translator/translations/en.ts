export const EN_TRANSLATIONS = {
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
};
