export const ZH_TRANSLATIONS = {
  sac: {
    transfer: (from: string, amount: string, symbol: string, to: string) =>
      `公钥 [${from}] 向 [${to}] 转账了 ${amount} ${symbol}`,
    mint: (admin: string, amount: string, symbol: string, to: string) =>
      `管理员 [${admin}] 为 [${to}] 铸造了 ${amount} ${symbol}`,
    burn: (from: string, amount: string, symbol: string) =>
      `公钥 [${from}] 销毁了 ${amount} ${symbol}`,
    eventTypes: {
      Transfer: "转账",
      Mint: "铸造",
      Burn: "销毁",
    },
  },
};
