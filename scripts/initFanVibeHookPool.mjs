import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { xLayer } from 'viem/chains';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const DEPLOYMENT_PATH = path.join(root, 'contracts', 'deployments', 'xlayer.json');

const POOL_MANAGER = getAddress('0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32');
const WOKB = getAddress('0xe538905cf8410324e03A5A23C1c177a474D59b2b');
const USDT = getAddress('0x1E4a5963aBFD975d8c9021ce480b42188849D41d');
const DYNAMIC_FEE_FLAG = 0x800000;
const TICK_SPACING = 10;

const poolManagerAbi = parseAbi([
  'function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) external returns (int24 tick)',
]);

const hookAbi = parseAbi([
  'function approvePool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool approved) external',
]);

function usage() {
  console.log('Usage:');
  console.log('  HOOK_DEPLOYER_PRIVATE_KEY=0x... npm run hook:init-pool');
  console.log('');
  console.log('Optional:');
  console.log('  HOOK_INITIAL_OKB_USDT_PRICE=88');
}

function readDeployment() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    throw new Error(`Missing deployment file: ${DEPLOYMENT_PATH}`);
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf8'));
}

function sortCurrencies(a, b) {
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

function parseDecimal(value, decimals) {
  const raw = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid decimal value: ${value}`);
  const [whole, fraction = ''] = raw.split('.');
  const padded = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(`${whole}${padded}`.replace(/^0+(?=\d)/, '') || '0');
}

function sqrt(value) {
  if (value < 0n) throw new Error('sqrt only supports unsigned values');
  if (value < 2n) return value;
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

function sqrtPriceX96ForWokbUsdt(okbUsdtPrice) {
  const usdtRaw = parseDecimal(okbUsdtPrice, 6);
  const wokbRaw = 10n ** 18n;

  // Pool currency0 is USDT and currency1 is WOKB, so price is token1/token0.
  return sqrt((wokbRaw << 192n) / usdtRaw);
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

async function main() {
  const privateKey = process.env.HOOK_DEPLOYER_PRIVATE_KEY;
  if (!privateKey?.startsWith('0x')) {
    usage();
    throw new Error('HOOK_DEPLOYER_PRIVATE_KEY is required');
  }

  const deployment = readDeployment();
  if (deployment.status !== 'success' || !deployment.hookAddress) {
    throw new Error('Hook deployment is not marked successful in xlayer.json');
  }

  const account = privateKeyToAccount(privateKey);
  const hookAddress = getAddress(deployment.hookAddress);
  const [currency0, currency1] = sortCurrencies(USDT, WOKB);
  const key = {
    currency0,
    currency1,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: TICK_SPACING,
    hooks: hookAddress,
  };
  const id = poolId(key);
  const initialPrice = process.env.HOOK_INITIAL_OKB_USDT_PRICE ?? '88';
  const sqrtPriceX96 = sqrtPriceX96ForWokbUsdt(initialPrice);

  const transport = http(process.env.X_LAYER_MAINNET_RPC ?? 'https://rpc.xlayer.tech');
  const publicClient = createPublicClient({ chain: xLayer, transport });
  const walletClient = createWalletClient({ account, chain: xLayer, transport });

  const initHash = await walletClient.writeContract({
    address: POOL_MANAGER,
    abi: poolManagerAbi,
    functionName: 'initialize',
    args: [key, sqrtPriceX96],
  });
  const initReceipt = await publicClient.waitForTransactionReceipt({ hash: initHash });

  const approveHash = await walletClient.writeContract({
    address: hookAddress,
    abi: hookAbi,
    functionName: 'approvePool',
    args: [key, true],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const nextDeployment = {
    ...deployment,
    poolId: id,
    pool: {
      ...deployment.pool,
      currency0,
      currency1,
      fee: `0x${DYNAMIC_FEE_FLAG.toString(16)}`,
      tickSpacing: TICK_SPACING,
      initialOkbUsdtPrice: initialPrice,
      sqrtPriceX96: sqrtPriceX96.toString(),
      initializeTxHash: initHash,
      initializeStatus: initReceipt.status,
      approvePoolTxHash: approveHash,
      approvePoolStatus: approveReceipt.status,
    },
  };

  fs.writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(nextDeployment, null, 2)}\n`);
  console.log(JSON.stringify(nextDeployment, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
