export const ES_TRANSLATIONS = {
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
};
