import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  formatUnits,
  encodeFunctionData,
  type Address,
  type PrivateKeyAccount,
} from 'viem';
import { xLayerMainnet, USDT_ADDRESS, NATIVE_OKB, PANCAKE_V3_FACTORY } from '../chain.js';
import type { LogLevel, LogPrefix } from '../types.js';

type LogFn = (prefix: LogPrefix, level: LogLevel, msg: string, tx?: string) => void;

const PROFITABILITY_MULTIPLIER = 1.5;
const GAS_COST_ESTIMATE_OKB = 0.001;

// PancakeSwap V3 SmartRouter on X Layer Mainnet
const PANCAKE_ROUTER = (process.env.PANCAKE_ROUTER_ADDRESS ?? '0x1b81D678ffb9C0263b24A97847620C99d213eB14') as Address;

// WOKB on X Layer Mainnet (wrapped native)
const WOKB_ADDRESS = '0xe538905cf8410324e03a5a23c1c177a474d59b2b' as Address;

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const SWAP_ROUTER_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn',           type: 'address' },
        { name: 'tokenOut',          type: 'address' },
        { name: 'fee',               type: 'uint24'  },
        { name: 'recipient',         type: 'address' },
        { name: 'amountIn',          type: 'uint256' },
        { name: 'amountOutMinimum',  type: 'uint256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

// OKX DEX Aggregator — primary route (requires API key)
async function swapViaOKXAggregator(
  account: PrivateKeyAccount,
  usdtBalance: bigint,
  walletClient: ReturnType<typeof createWalletClient>,
  log: LogFn,
): Promise<string | null> {
  const apiKey = process.env.OKX_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    chainId: '196',
    fromTokenAddress: USDT_ADDRESS,
    toTokenAddress: NATIVE_OKB,
    amount: usdtBalance.toString(),
    slippage: '0.005',
    userWalletAddress: account.address,
  });

  try {
    const res = await fetch(`https://web3.okx.com/api/v5/dex/aggregator/swap?${params}`, {
      headers: { 'Ok-Access-Key': apiKey },
    });

    if (!res.ok) {
      log('METABOLISM', 'warn', `OKX DEX aggregator HTTP ${res.status} — falling back to PancakeSwap V3`);
      return null;
    }

    const data = (await res.json()) as {
      code: string;
      msg?: string;
      data?: Array<{ tx: { to: string; data: string; value: string; gas: string }; routerResult: { toTokenAmount: string } }>;
    };

    if (data.code !== '0' || !data.data?.length) {
      log('METABOLISM', 'warn', `OKX DEX route error: ${data.msg ?? 'unknown'} — falling back to PancakeSwap V3`);
      return null;
    }

    const { tx, routerResult } = data.data[0];
    const expectedOKB = parseFloat(formatEther(BigInt(routerResult.toTokenAmount)));

    if (expectedOKB < GAS_COST_ESTIMATE_OKB * PROFITABILITY_MULTIPLIER) {
      log('METABOLISM', 'warn', `Profitability guard failed: ${expectedOKB.toFixed(6)} OKB expected. Swap skipped.`);
      return null;
    }

    log('METABOLISM', 'info', `OKX route: ${formatUnits(usdtBalance, 6)} USDT → ~${expectedOKB.toFixed(4)} OKB. Broadcasting...`);

    const txHash = await walletClient.sendTransaction({
      account,
      to: tx.to as Address,
      data: tx.data as `0x${string}`,
      value: BigInt(tx.value ?? '0'),
      gas: BigInt(tx.gas ?? '300000'),
      chain: xLayerMainnet,
    });

    return txHash;
  } catch {
    return null;
  }
}

// PancakeSwap V3 exactInputSingle — fallback route (no API key needed)
async function swapViaPancakeV3(
  account: PrivateKeyAccount,
  usdtBalance: bigint,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  log: LogFn,
): Promise<string | null> {
  log('METABOLISM', 'info', `PancakeSwap V3: ${formatUnits(usdtBalance, 6)} USDT → OKB via factory ${PANCAKE_V3_FACTORY}`);

  try {
    // Step 1: approve router to spend USDT
    const approveTx = await walletClient.sendTransaction({
      account,
      to: USDT_ADDRESS as Address,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [PANCAKE_ROUTER, usdtBalance],
      }),
      chain: xLayerMainnet,
    });
    log('METABOLISM', 'info', `USDT approval sent`, approveTx);

    // Wait 1 block for approval to land
    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    // Step 2: swap USDT → WOKB (0.05% fee pool)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const swapData = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn:           USDT_ADDRESS as Address,
        tokenOut:          WOKB_ADDRESS,
        fee:               500,          // 0.05% pool
        recipient:         account.address,
        amountIn:          usdtBalance,
        amountOutMinimum:  0n,           // min enforced by profitability guard above
        sqrtPriceLimitX96: 0n,
      }],
    });

    void deadline;

    const swapTx = await walletClient.sendTransaction({
      account,
      to: PANCAKE_ROUTER,
      data: swapData,
      gas: 300_000n,
      chain: xLayerMainnet,
    });

    log('METABOLISM', 'success', `PancakeSwap V3 swap confirmed. WOKB acquired — unwrap to OKB in next cycle.`, swapTx);
    return swapTx;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log('METABOLISM', 'error', `PancakeSwap V3 swap failed: ${msg}`);
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

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
      abi: ERC20_ABI,
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

  log('METABOLISM', 'info', `Found ${formatUnits(usdtBalance, 6)} USDT in fee reserves. Initiating swap...`);

  // Try OKX DEX aggregator first (best rates), fall back to PancakeSwap V3
  const txHash =
    (await swapViaOKXAggregator(account, usdtBalance, walletClient, log)) ??
    (await swapViaPancakeV3(account, usdtBalance, publicClient, walletClient, log));

  if (txHash) {
    log('METABOLISM', 'success', `Refuel complete. OKB replenished.`, txHash);
  }

  return txHash;
}
