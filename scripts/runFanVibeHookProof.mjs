import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { xLayer } from 'viem/chains';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const DEPLOYMENT_PATH = path.join(root, 'contracts', 'deployments', 'xlayer.json');

const WOKB = getAddress('0xe538905cf8410324e03A5A23C1c177a474D59b2b');
const USDT = getAddress('0x1E4a5963aBFD975d8c9021ce480b42188849D41d');
const DYNAMIC_FEE_FLAG = 0x800000;
const TICK_SPACING = 10;
const MIN_SQRT_RATIO_PLUS_ONE = 4295128740n;
const MAX_SQRT_RATIO_MINUS_ONE = 1461446703485210103287273052203988822378723970341n;

const erc20Abi = parseAbi([
  'function approve(address spender,uint256 amount) returns (bool)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

const hookAbi = parseAbi([
  'event MatchdayFeeApplied(bytes32 indexed poolId,address indexed sender,uint8 indexed phase,uint24 fee)',
  'function setMatchPhase(uint8 nextPhase,string fixtureId) external',
  'function phase() view returns (uint8)',
  'function currentFee() view returns (uint24)',
]);

const routerAbi = parseAbi([
  'function modifyLiquidity((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt) params,bytes hookData) payable returns (int256 delta)',
  'function swapExactIn((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,uint128 amountIn,uint160 sqrtPriceLimitX96,bytes hookData) payable returns (int256 delta)',
]);

function usage() {
  console.log('Usage:');
  console.log('  HOOK_DEPLOYER_PRIVATE_KEY=0x... HOOK_PROOF_MODE=liquidity npm run hook:proof');
  console.log('  HOOK_DEPLOYER_PRIVATE_KEY=0x... HOOK_PROOF_MODE=swap npm run hook:proof');
  console.log('');
  console.log('Liquidity env:');
  console.log('  HOOK_LIQUIDITY_DELTA=1000000');
  console.log('  HOOK_TICK_LOWER=-887220');
  console.log('  HOOK_TICK_UPPER=887220');
  console.log('');
  console.log('Swap env:');
  console.log('  HOOK_SWAP_TOKEN=wokb');
  console.log('  HOOK_SWAP_AMOUNT=0.000001');
}

function sortCurrencies(a, b) {
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

function poolId(key) {
  return keccak256(encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ],
    }],
    [key],
  ));
}

async function ensureAllowance({ publicClient, walletClient, account, token, spender, amount }) {
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, spender],
  });
  if (allowance >= amount) return null;

  const hash = await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status };
}

async function tokenInfo(publicClient, token, owner) {
  const [symbol, decimals, balance] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
  ]);
  return { symbol, decimals, balance };
}

async function main() {
  const privateKey = process.env.HOOK_DEPLOYER_PRIVATE_KEY;
  const mode = String(process.env.HOOK_PROOF_MODE ?? '').toLowerCase();
  if (!privateKey?.startsWith('0x') || !['liquidity', 'swap'].includes(mode)) {
    usage();
    throw new Error('HOOK_DEPLOYER_PRIVATE_KEY and HOOK_PROOF_MODE=liquidity|swap are required');
  }

  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf8'));
  if (!deployment.proofRouter?.address) {
    throw new Error('Missing proofRouter.address in xlayer.json. Run npm run hook:deploy-router first.');
  }

  const account = privateKeyToAccount(privateKey);
  const transport = http(process.env.X_LAYER_MAINNET_RPC ?? 'https://rpc.xlayer.tech');
  const publicClient = createPublicClient({ chain: xLayer, transport });
  const walletClient = createWalletClient({ account, chain: xLayer, transport });
  const hookAddress = getAddress(deployment.hookAddress);
  const routerAddress = getAddress(deployment.proofRouter.address);
  const [currency0, currency1] = sortCurrencies(USDT, WOKB);
  const key = {
    currency0,
    currency1,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: TICK_SPACING,
    hooks: hookAddress,
  };
  const id = poolId(key);

  if (id.toLowerCase() !== String(deployment.poolId).toLowerCase()) {
    throw new Error(`Pool id mismatch. Expected ${deployment.poolId}, computed ${id}`);
  }

  const [wokbInfo, usdtInfo] = await Promise.all([
    tokenInfo(publicClient, WOKB, account.address),
    tokenInfo(publicClient, USDT, account.address),
  ]);

  if (mode === 'liquidity') {
    const liquidityDelta = BigInt(process.env.HOOK_LIQUIDITY_DELTA ?? '0');
    if (liquidityDelta <= 0n) throw new Error('Set HOOK_LIQUIDITY_DELTA to a positive integer');

    const tickLower = Number(process.env.HOOK_TICK_LOWER ?? '-887220');
    const tickUpper = Number(process.env.HOOK_TICK_UPPER ?? '887220');
    if (tickLower % TICK_SPACING !== 0 || tickUpper % TICK_SPACING !== 0 || tickLower >= tickUpper) {
      throw new Error('Ticks must align to tick spacing 10, and lower must be less than upper');
    }

    if (wokbInfo.balance === 0n || usdtInfo.balance === 0n) {
      throw new Error(`Liquidity proof needs both tokens. Current balances: ${wokbInfo.symbol} ${formatUnits(wokbInfo.balance, wokbInfo.decimals)}, ${usdtInfo.symbol} ${formatUnits(usdtInfo.balance, usdtInfo.decimals)}`);
    }

    const approvals = await Promise.all([
      ensureAllowance({ publicClient, walletClient, account, token: WOKB, spender: routerAddress, amount: wokbInfo.balance }),
      ensureAllowance({ publicClient, walletClient, account, token: USDT, spender: routerAddress, amount: usdtInfo.balance }),
    ]);

    const hash = await walletClient.writeContract({
      address: routerAddress,
      abi: routerAbi,
      functionName: 'modifyLiquidity',
      args: [key, { tickLower, tickUpper, liquidityDelta, salt: '0x0000000000000000000000000000000000000000000000000000000000000000' }, '0x'],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const next = {
      ...deployment,
      proof: {
        ...deployment.proof,
        liquidityTxHash: hash,
        liquidityStatus: receipt.status,
        tickLower,
        tickUpper,
        liquidityDelta: liquidityDelta.toString(),
        tokenApprovalTxs: approvals.filter(Boolean),
      },
    };
    fs.writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(JSON.stringify(next.proof, null, 2));
    return;
  }

  const token = String(process.env.HOOK_SWAP_TOKEN ?? 'wokb').toLowerCase();
  const zeroForOne = token === 'usdt';
  const input = zeroForOne ? usdtInfo : wokbInfo;
  const inputToken = zeroForOne ? USDT : WOKB;
  const amountIn = parseUnits(process.env.HOOK_SWAP_AMOUNT ?? (zeroForOne ? '0.01' : '0.000001'), input.decimals);
  if (amountIn <= 0n) throw new Error('HOOK_SWAP_AMOUNT must be positive');
  if (input.balance < amountIn) {
    throw new Error(`Swap proof needs ${input.symbol}. Current balance: ${formatUnits(input.balance, input.decimals)} ${input.symbol}`);
  }

  const phaseHash = await walletClient.writeContract({
    address: hookAddress,
    abi: hookAbi,
    functionName: 'setMatchPhase',
    args: [2, 'fanvibe-v4-proof'],
  });
  const phaseReceipt = await publicClient.waitForTransactionReceipt({ hash: phaseHash });

  const approval = await ensureAllowance({ publicClient, walletClient, account, token: inputToken, spender: routerAddress, amount: amountIn });
  const sqrtPriceLimitX96 = zeroForOne ? MIN_SQRT_RATIO_PLUS_ONE : MAX_SQRT_RATIO_MINUS_ONE;
  const hash = await walletClient.writeContract({
    address: routerAddress,
    abi: routerAbi,
    functionName: 'swapExactIn',
    args: [key, zeroForOne, amountIn, sqrtPriceLimitX96, '0x'],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const [phase, currentFee] = await Promise.all([
    publicClient.readContract({ address: hookAddress, abi: hookAbi, functionName: 'phase' }),
    publicClient.readContract({ address: hookAddress, abi: hookAbi, functionName: 'currentFee' }),
  ]);

  const feeEvents = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== hookAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: hookAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === 'MatchdayFeeApplied') feeEvents.push(decoded.args);
    } catch {
      // Ignore non-hook-proof events from the same address.
    }
  }

  const next = {
    ...deployment,
    proof: {
      ...deployment.proof,
      phaseTxHash: phaseHash,
      phaseStatus: phaseReceipt.status,
      swapApprovalTx: approval,
      swapTxHash: hash,
      swapStatus: receipt.status,
      swapToken: input.symbol,
      swapAmount: formatUnits(amountIn, input.decimals),
      phase: Number(phase),
      currentFee: Number(currentFee),
      matchdayFeeApplied: feeEvents.map(event => ({
        poolId: event.poolId,
        sender: event.sender,
        phase: Number(event.phase),
        fee: Number(event.fee),
      })),
    },
  };
  fs.writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(JSON.stringify(next.proof, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
