import { createPublicClient, fallback, http } from 'viem';
import { X_LAYER_RPC_URLS, xLayerMainnet } from './chain';

export const xLayerPublicClient = createPublicClient({
  chain: xLayerMainnet,
  transport: fallback(X_LAYER_RPC_URLS.map(url => http(url))),
});
