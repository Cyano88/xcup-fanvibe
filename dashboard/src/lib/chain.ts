export const xLayerMainnet = {
  id: 196,
  name: 'X Layer Mainnet',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.xlayer.tech'], webSocket: ['wss://rpc.xlayer.tech'] },
    public:  { http: ['https://rpc.xlayer.tech'], webSocket: ['wss://rpc.xlayer.tech'] },
  },
  blockExplorers: {
    default: { name: 'OKX Explorer', url: 'https://www.okx.com/web3/explorer/xlayer' },
  },
} as const;

export const CHAIN_ID_HEX = '0xc4'; // 196

export const explorerTx = (hash: string) =>
  `https://www.okx.com/web3/explorer/xlayer/tx/${hash}`;

export const explorerAddr = (addr: string) =>
  `https://www.okx.com/web3/explorer/xlayer/address/${addr}`;
