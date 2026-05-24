import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  formatUnits,
  type Address,
  type PrivateKeyAccount,
} from 'viem';
import { xLayerMainnet, USDT_ADDRESS, NATIVE_OKB } from '../chain.js';
import type { LogLevel, LogPrefix } from '../types.js';

type LogFn = (prefix: LogPrefix, level: LogLevel, msg: string, tx?: string) => void;

const ONCHAINOS_SWAP_URL = 'https://web3.okx.com/api/v5/dex/aggregator/swap';
const PROFITABILITY_MULTIPLIER = 1.5;

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export async function checkAndRefuel(
  account: PrivateKeyAccount,
  log: LogFn,
): Promise<string | null> {
  const httpRpc = process.env.X_LAYER_MAINNET_RPC ?? 'https://rpc.xlayer.tech';
  const publicClient = createPublicClient({ chain: xLayerMainnet, transport: http(httpRpc) });
  const walletClient = createWalletClient({ chain: xLayerMainnet, transport: http(httpRpc), account });

  log('METABOLISM', 'warn', 'OKB below threshold — scanning protocol fee reserves...');

  let usdtBalance = 0n;
  try {
    usdtBalance = await publicClient.readContract({
      address: USDT_ADDRESS as Address,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });
  } catch {
    log('METABOLISM', 'warn', 'USDT balance check failed — node may be syncing');
    return null;
  }

  if (usdtBalance === 0n) {
    log('METABOLISM', 'info', 'No USDT reserves available. Metabolism idle — awaiting fee accumulation.');
    return null;
  }

  const usdtFormatted = formatUnits(usdtBalance, 6);
  log('METABOLISM', 'info', `Found ${usdtFormatted} USDT in fee reserves. Routing swap via OKX DEX aggregator...`);

  const apiKey = process.env.OKX_API_KEY ?? '';
  const params = new URLSearchParams({
    chainId: '196',
    fromTokenAddress: USDT_ADDRESS,
    toTokenAddress: NATIVE_OKB,
    amount: usdtBalance.toString(),
    slippage: '0.005',
    userWalletAddress: account.address,
  });

  const res = await fetch(`${ONCHAINOS_SWAP_URL}?${params}`, {
    headers: { 'Ok-Access-Key': apiKey },
  });

  if (!res.ok) {
    log('METABOLISM', 'error', `DEX aggregator HTTP ${res.status}. Swap aborted.`);
    return null;
  }

  const data = (await res.json()) as {
    code: string;
    msg?: string;
    data?: Array<{ tx: { to: string; data: string; value: string; gas: string }; routerResult: { toTokenAmount: string } }>;
  };

  if (data.code !== '0' || !data.data?.length) {
    log('METABOLISM', 'error', `DEX route error: ${data.msg ?? 'unknown'}`);
    return null;
  }

  const { tx, routerResult } = data.data[0];
  const expectedOKB = formatEther(BigInt(routerResult.toTokenAmount));

  // Profitability guard: estimated OKB received must exceed gas cost × 1.5
  const gasCostEstimate = 0.001; // ~0.001 OKB for a DEX swap on X Layer
  if (parseFloat(expectedOKB) < gasCostEstimate * PROFITABILITY_MULTIPLIER) {
    log('METABOLISM', 'warn', `Profitability guard: expected ${expectedOKB} OKB < ${gasCostEstimate * PROFITABILITY_MULTIPLIER} OKB minimum. Swap skipped.`);
    return null;
  }

  log('METABOLISM', 'info', `Swap route: ${usdtFormatted} USDT → ~${parseFloat(expectedOKB).toFixed(4)} OKB. Broadcasting...`);

  try {
    const txHash = await walletClient.sendTransaction({
      to: tx.to as Address,
      data: tx.data as `0x${string}`,
      value: BigInt(tx.value ?? '0'),
      gas: BigInt(tx.gas ?? '300000'),
    });

    log('METABOLISM', 'success', `Swap confirmed. +${parseFloat(expectedOKB).toFixed(4)} OKB refueled.`, txHash);
    return txHash;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log('METABOLISM', 'error', `Swap broadcast failed: ${msg}`);
    return null;
  }
}
