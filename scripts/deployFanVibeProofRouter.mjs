import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, getAddress, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { xLayer } from 'viem/chains';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const DEPLOYMENT_PATH = path.join(root, 'contracts', 'deployments', 'xlayer.json');
const ARTIFACT = path.join(root, 'contracts', 'artifacts', 'contracts', 'src', 'FanVibeV4ProofRouter.sol', 'FanVibeV4ProofRouter.json');
const POOL_MANAGER = getAddress('0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32');

function usage() {
  console.log('Usage:');
  console.log('  HOOK_DEPLOYER_PRIVATE_KEY=0x... npm run hook:deploy-router');
  console.log('');
  console.log('Compile first if needed:');
  console.log('  npm run hook:compile');
}

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const privateKey = process.env.HOOK_DEPLOYER_PRIVATE_KEY;
  if (!privateKey?.startsWith('0x')) {
    usage();
    throw new Error('HOOK_DEPLOYER_PRIVATE_KEY is required');
  }

  const deployment = readJson(DEPLOYMENT_PATH);
  const artifact = readJson(ARTIFACT);
  const account = privateKeyToAccount(privateKey);
  const transport = http(process.env.X_LAYER_MAINNET_RPC ?? 'https://rpc.xlayer.tech');
  const publicClient = createPublicClient({ chain: xLayer, transport });
  const walletClient = createWalletClient({ account, chain: xLayer, transport });

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [POOL_MANAGER, account.address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) throw new Error('Proof router deployment did not return a contract address');

  const next = {
    ...deployment,
    proofRouter: {
      address: getAddress(receipt.contractAddress),
      deployTxHash: hash,
      deployStatus: receipt.status,
      owner: account.address,
    },
  };
  fs.writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(JSON.stringify(next.proofRouter, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
