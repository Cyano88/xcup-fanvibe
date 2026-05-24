/**
 * Oracle Override — sign and submit a match settlement
 * Usage: node scripts/oracle-override.mjs <fixtureId> <outcome> <adminPrivateKey>
 *
 * Example:
 *   node scripts/oracle-override.mjs grp-b-1 home 0xYOUR_ADMIN_PRIVATE_KEY
 *
 * Outcomes: home | draw | away
 * Fixture IDs: grp-a-1, grp-a-2, grp-b-1, grp-b-2, grp-c-1, grp-d-1, grp-e-1, grp-f-1, grp-g-1, grp-h-1
 */

import { privateKeyToAccount } from 'viem/accounts';

const [,, fixtureId, outcome, adminPk] = process.argv;

if (!fixtureId || !outcome || !adminPk) {
  console.error('Usage: node scripts/oracle-override.mjs <fixtureId> <outcome> <adminPrivateKey>');
  console.error('Example: node scripts/oracle-override.mjs grp-b-1 home 0xYOUR_KEY');
  process.exit(1);
}

if (!['home', 'draw', 'away'].includes(outcome)) {
  console.error('Outcome must be: home | draw | away');
  process.exit(1);
}

const BACKEND = process.env.BACKEND_URL ?? 'https://xcup-fanvibe-production.up.railway.app';
const nonce = Date.now();

const account = privateKeyToAccount(adminPk);
const message = `X-Cup-Oracle:${fixtureId}:${outcome}:${nonce}`;

console.log(`\n⚽ X Cup FanVibe — Oracle Override`);
console.log(`   Fixture : ${fixtureId}`);
console.log(`   Outcome : ${outcome.toUpperCase()}`);
console.log(`   Signer  : ${account.address}`);
console.log(`   Message : ${message}`);
console.log(`   Backend : ${BACKEND}\n`);

const signature = await account.signMessage({ message });
console.log(`✓ Signed  : ${signature.slice(0, 20)}...`);

console.log(`\n→ Submitting to referee daemon...`);

const res = await fetch(`${BACKEND}/oracle/override`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fixtureId, outcome, signature, nonce }),
});

const data = await res.json();

if (data.success) {
  console.log(`\n✅ Settlement confirmed!`);
  console.log(`   Winners   : ${data.result.winnerCount}`);
  console.log(`   Total pool: ${(Number(BigInt(data.result.totalPool)) / 1e18).toFixed(6)} OKB`);
  if (data.result.payouts.length > 0) {
    console.log(`   Payouts:`);
    for (const p of data.result.payouts) {
      console.log(`     ${p.address.slice(0,10)}... → ${(Number(BigInt(p.amountWei)) / 1e18).toFixed(6)} OKB`);
      console.log(`     TX: https://www.okx.com/web3/explorer/xlayer/tx/${p.txHash}`);
    }
  } else {
    console.log(`   No stakes on this outcome yet — settlement recorded on-chain.`);
  }
  console.log(`\n   Explorer: ${data.result.explorerUrl}`);
} else {
  console.error(`\n❌ Settlement failed: ${data.error}`);
}
