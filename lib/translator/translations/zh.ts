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
  soroswap: {
    swap: (to: string, amountIn: string, tokenIn: string, amountOut: string, tokenOut: string) =>
      `账户 [${to}] 用 ${amountIn} 的资产 [${tokenIn}] 兑换了 ${amountOut} 的资产 [${tokenOut}]`,
    addLiquidity: (to: string, amountA: string, tokenA: string, amountB: string, tokenB: string, liquidity: string) =>
      `账户 [${to}] 向资金池添加了 ${amountA} 的资产 [${tokenA}] 和 ${amountB} 的资产 [${tokenB}]，获得了 ${liquidity} 个流动性代币`,
    removeLiquidity: (to: string, amountA: string, tokenA: string, amountB: string, tokenB: string, liquidity: string) =>
      `账户 [${to}] 从资金池移除了 ${amountA} 的资产 [${tokenA}] 和 ${amountB} 的资产 [${tokenB}]，销毁了 ${liquidity} 个流动性代币`,
    eventTypes: {
      Swap: "兑换",
      AddLiquidity: "添加流动性",
      RemoveLiquidity: "移除流动性",
    },
  },
  blend: {
    supply: (from: string, amount: string, asset: string) =>
      `账户 [${from}] 向资金池存入了 ${amount} 的资产 [${asset}]`,
    borrow: (from: string, amount: string, asset: string) =>
      `账户 [${from}] 从资金池借出了 ${amount} 的资产 [${asset}]`,
    repay: (from: string, amount: string, asset: string) =>
      `账户 [${from}] 向资金池偿还了 ${amount} 的资产 [${asset}]`,
    withdraw: (from: string, amount: string, asset: string) =>
      `账户 [${from}] 从资金池提取了 ${amount} 的资产 [${asset}]`,
    liquidate: (user: string, filler: string, amount: string) =>
      `账户 [${filler}] 清算了账户 [${user}] 的 ${amount} 抵押品`,
    eventTypes: {
      Supply: "存入",
      Borrow: "借款",
      Repay: "还款",
      Withdraw: "提取",
      Liquidate: "清算",
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
