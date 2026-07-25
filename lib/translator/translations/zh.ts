import type { TranslationMap } from "../types";

export const ZH_TRANSLATIONS: TranslationMap = {
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
  sdex: {
    manageBuyOffer: (seller: string, amount: string, buyingAsset: string, sellingAsset: string) =>
      `账户 [${seller}] 发起了一笔买入报价，买入资产 [${buyingAsset}] 共 ${amount}，出售资产 [${sellingAsset}]`,
    manageSellOffer: (seller: string, amount: string, sellingAsset: string, buyingAsset: string) =>
      `账户 [${seller}] 发起了一笔卖出报价，卖出资产 [${sellingAsset}] 共 ${amount}，换取资产 [${buyingAsset}]`,
    offerFilled: (seller: string, amount: string, assetSold: string, buyer: string) =>
      `[${seller}] 的报价已成交：${amount} 的资产 [${assetSold}] 已卖给 [${buyer}]`,
    eventTypes: {
      ManageBuyOffer: "管理买入报价",
      ManageSellOffer: "管理卖出报价",
      OfferFilled: "报价成交",
    },
  },
  generic: {
    unregisteredContractName: "未注册的合约",
    unregisteredContractDescription: (payload: string) => `[未注册的合约] ${payload}`,
    unknownEventNoBlueprint: (contractId: string, data: string) =>
      `[未知事件：合约 ${contractId} 没有注册的蓝图。十六进制数据：${data}]`,
    unknownEventNoBlueprintApplicable: (contractId: string, ledger: number, data: string) =>
      `[未知事件：合约 ${contractId} 在账本 ${ledger} 没有适用的蓝图。十六进制数据：${data}]`,
    invalidStringLength: "[无效的字符串长度]",
    invalidUtf8: "[无效的 UTF-8]",
    invalidSymbolLength: "[无效的符号长度]",
    unknownAddress: "[未知地址]",
  },
};
