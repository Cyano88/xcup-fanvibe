export const xLayerMainnet = {
  id: 196,
  name: 'X Layer Mainnet',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.xlayer.tech'],
      webSocket: ['wss://rpc.xlayer.tech'],
    },
    public: {
      http: ['https://rpc.xlayer.tech'],
      webSocket: ['wss://rpc.xlayer.tech'],
    },
  },
  blockExplorers: {
    default: {
      name: 'OKX Explorer',
      url: 'https://www.okx.com/web3/explorer/xlayer',
    },
  },
} as const;

export const EXPLORER_BASE = 'https://www.okx.com/web3/explorer/xlayer';
export const explorerTx = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const explorerAddr = (addr: string) => `${EXPLORER_BASE}/address/${addr}`;

// PancakeSwap V3 on X Layer Mainnet
export const PANCAKE_V3_FACTORY = '0xDf38F24fE153761634Be942F9d859f3DBA857E95' as const;

// USDT bridged on X Layer Mainnet (used for metabolism fee accumulation)
export const USDT_ADDRESS = '0x1e4a5963abfd975d8c9021ce480b42188849d41d' as const;

// Native OKB sentinel (for DEX aggregator)
export const NATIVE_OKB = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;
