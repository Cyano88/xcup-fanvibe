import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, getAddress, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { xLayer } from 'viem/chains';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const DEPLOYMENT_PATH = path.join(root, 'contracts', 'deployments', 'xlayer.json');
const PHASES = new Map([
  ['preseason', 0],
  ['open', 1],
  ['matchopen', 1],
  ['live', 2],
  ['settled', 3],
]);

const hookAbi = parseAbi([
  'function setMatchPhase(uint8 nextPhase,string fixtureId) external',
  'function phase() view returns (uint8)',
  'function currentFee() view returns (uint24)',
]);

function usage() {
  console.log('Usage:');
  console.log('  HOOK_DEPLOYER_PRIVATE_KEY=0x... HOOK_PHASE=live HOOK_FIXTURE_ID=fanvibe-demo npm run hook:set-phase');
  console.log('');
  console.log('Phases: preseason, open, live, settled');
}

async function main() {
  const privateKey = process.env.HOOK_DEPLOYER_PRIVATE_KEY;
  const requestedPhase = String(process.env.HOOK_PHASE ?? '').toLowerCase();
  const nextPhase = PHASES.get(requestedPhase);
  if (!privateKey?.startsWith('0x') || nextPhase === undefined) {
    usage();
    throw new Error('HOOK_DEPLOYER_PRIVATE_KEY and valid HOOK_PHASE are required');
  }

  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf8'));
  const hookAddress = getAddress(deployment.hookAddress);
  const account = privateKeyToAccount(privateKey);
  const transport = http(process.env.X_LAYER_MAINNET_RPC ?? 'https://rpc.xlayer.tech');
  const publicClient = createPublicClient({ chain: xLayer, transport });
  const walletClient = createWalletClient({ account, chain: xLayer, transport });
  const fixtureId = process.env.HOOK_FIXTURE_ID ?? 'fanvibe-demo';

  const hash = await walletClient.writeContract({
    address: hookAddress,
    abi: hookAbi,
    functionName: 'setMatchPhase',
    args: [nextPhase, fixtureId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const [phase, currentFee] = await Promise.all([
    publicClient.readContract({ address: hookAddress, abi: hookAbi, functionName: 'phase' }),
    publicClient.readContract({ address: hookAddress, abi: hookAbi, functionName: 'currentFee' }),
  ]);

  const next = {
    ...deployment,
    proof: {
      ...deployment.proof,
      phaseTxHash: hash,
      phaseStatus: receipt.status,
      phase: requestedPhase,
      fixtureId,
      currentFee: Number(currentFee),
    },
  };
  fs.writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(JSON.stringify({ txHash: hash, status: receipt.status, phase: Number(phase), currentFee: Number(currentFee) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
