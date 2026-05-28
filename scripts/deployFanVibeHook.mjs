import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters, toBytes, toHex, concatHex, createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { xLayer } from 'viem/chains';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const POOL_MANAGER = getAddress('0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32');
const CREATE2_DEPLOYER = getAddress('0x4e59b44847b379578588920cA78FbF26c0B4956C');
const BEFORE_SWAP_ONLY_FLAGS = 0x0080n;
const HOOK_FLAG_MASK = 0x3fffn;
const ARTIFACT = path.join(root, 'contracts', 'artifacts', 'contracts', 'src', 'FanVibeMatchdayHook.sol', 'FanVibeMatchdayHook.json');
const OUT = path.join(root, 'contracts', 'deployments', 'xlayer.json');

function usage() {
  console.log('Usage:');
  console.log('  npm run hook:compile');
  console.log('  HOOK_DEPLOYER_PRIVATE_KEY=0x... npm run hook:deploy');
}

function create2Address(deployer, salt, initCodeHash) {
  return getAddress(`0x${keccak256(concatHex(['0xff', deployer, salt, initCodeHash])).slice(-40)}`);
}

function findSalt(initCodeHash) {
  for (let i = 0n; i < 1_500_000n; i += 1n) {
    const salt = toHex(i, { size: 32 });
    const addr = create2Address(CREATE2_DEPLOYER, salt, initCodeHash);
    if ((BigInt(addr) & HOOK_FLAG_MASK) === BEFORE_SWAP_ONLY_FLAGS) {
      return { salt, addr };
    }
  }
  throw new Error('Unable to mine a beforeSwap-only hook address within search limit');
}

async function main() {
  if (!fs.existsSync(ARTIFACT)) {
    usage();
    throw new Error(`Missing artifact: ${ARTIFACT}`);
  }

  const pk = process.env.HOOK_DEPLOYER_PRIVATE_KEY;
  if (!pk?.startsWith('0x')) {
    usage();
    throw new Error('HOOK_DEPLOYER_PRIVATE_KEY is required for mainnet deployment');
  }

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const account = privateKeyToAccount(pk);
  const args = encodeAbiParameters(parseAbiParameters('address manager, address initialOwner'), [POOL_MANAGER, account.address]);
  const initCode = concatHex([artifact.bytecode, args]);
  const initCodeHash = keccak256(initCode);
  const { salt, addr } = findSalt(initCodeHash);

  const publicClient = createPublicClient({ chain: xLayer, transport: http(process.env.X_LAYER_MAINNET_RPC ?? 'https://rpc.xlayer.tech') });
  const existingCode = await publicClient.getCode({ address: addr });
  if (existingCode && existingCode !== '0x') {
    throw new Error(`Target hook address already has code: ${addr}`);
  }

  const wallet = createWalletClient({ account, chain: xLayer, transport: http(process.env.X_LAYER_MAINNET_RPC ?? 'https://rpc.xlayer.tech') });
  const data = concatHex([salt, initCode]);
  const hash = await wallet.sendTransaction({ to: CREATE2_DEPLOYER, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const deployment = {
    chainId: 196,
    status: receipt.status,
    deployer: account.address,
    txHash: hash,
    hookAddress: addr,
    salt,
    poolManager: POOL_MANAGER,
    create2Deployer: CREATE2_DEPLOYER,
    permissions: 'beforeSwap',
    pool: {
      pair: 'WOKB/USDT',
      fee: '0x800000',
      tickSpacing: 10,
    },
  };

  fs.writeFileSync(OUT, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
