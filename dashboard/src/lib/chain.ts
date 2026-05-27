import { defineChain } from 'viem';

export const X_LAYER_RPC_URLS = [
  'https://xlayer.drpc.org',
  'https://rpc.xlayer.tech',
  'https://xlayerrpc.okx.com',
] as const;

export const xLayerMainnet = defineChain({
  id: 196,
  name: 'X Layer Mainnet',
  network: 'xlayer-mainnet',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: { http: [...X_LAYER_RPC_URLS], webSocket: ['wss://xlayer.drpc.org'] },
    public:  { http: [...X_LAYER_RPC_URLS], webSocket: ['wss://xlayer.drpc.org'] },
  },
  blockExplorers: {
    default: { name: 'OKX Explorer', url: 'https://www.okx.com/web3/explorer/xlayer' },
  },
});

export const CHAIN_ID_HEX = '0xc4'; // 196

export const explorerTx = (hash: string) =>
  `https://www.okx.com/web3/explorer/xlayer/tx/${hash}`;

export const explorerAddr = (addr: string) =>
  `https://www.okx.com/web3/explorer/xlayer/address/${addr}`;
