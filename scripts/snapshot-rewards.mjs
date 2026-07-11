/**
 * Season 1 Rewards Snapshot — sign and submit
 * Usage: node scripts/snapshot-rewards.mjs <adminPrivateKey> [--overwrite] [--season=season-1]
 *
 * Example:
 *   node scripts/snapshot-rewards.mjs 0xYOUR_ADMIN_PRIVATE_KEY
 *
 * The admin key never leaves your machine. This script signs
 * X-Cup-Rewards-Snapshot:<seasonId>:<nonce> and POSTs to the backend,
 * which freezes the current qualified top-5 X-connected wallets and
 * their reward allocations to storage.
 */

import { privateKeyToAccount } from 'viem/accounts';

const args = process.argv.slice(2);
const adminPk = args.find(a => a.startsWith('0x'));
const overwrite = args.includes('--overwrite');
const seasonArg = args.find(a => a.startsWith('--season='));
const seasonId = seasonArg ? seasonArg.split('=')[1] : 'season-1';

if (!adminPk) {
  console.error('Usage: node scripts/snapshot-rewards.mjs <adminPrivateKey> [--overwrite] [--season=season-1]');
  process.exit(1);
}

const BACKEND = process.env.BACKEND_URL ?? 'https://xcup-fanvibe-production.up.railway.app';
const nonce = Date.now();
const account = privateKeyToAccount(adminPk);
const message = `X-Cup-Rewards-Snapshot:${seasonId}:${nonce}`;

console.log(`\n🏆 X Cup FanVibe — Season Rewards Snapshot`);
console.log(`   Season   : ${seasonId}`);
console.log(`   Signer   : ${account.address}`);
console.log(`   Nonce    : ${nonce}`);
console.log(`   Overwrite: ${overwrite ? 'YES' : 'no'}`);
console.log(`   Backend  : ${BACKEND}\n`);

const signature = await account.signMessage({ message });
console.log(`✓ Signed  : ${signature.slice(0, 20)}...\n`);

console.log(`→ Freezing snapshot...\n`);
const res = await fetch(`${BACKEND}/rewards/snapshot`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ seasonId, signature, nonce, overwrite }),
});

const data = await res.json();

if (!res.ok || data.success === false) {
  console.error(`❌ Snapshot failed: ${data.error ?? res.statusText}`);
  process.exit(1);
}

const snap = data.snapshot;
const usdt = wei => `$${(Number(BigInt(wei || '0')) / 1e6).toFixed(2)}`;
const fvb = wei => `${(Number(BigInt(wei || '0')) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 })} FVB`;

console.log(`✅ Snapshot frozen`);
console.log(`   Block           : ${snap.snapshottedAtBlock}`);
console.log(`   Snapshotted at  : ${new Date(snap.snapshottedAt).toISOString()}`);
console.log(`   Reg closes at   : ${new Date(snap.registrationClosesAt).toISOString()}`);
console.log(`   First payout    : ${new Date(snap.firstPayoutAt).toISOString()}`);
console.log(`   Final payout    : ${new Date(snap.finalPayoutAt).toISOString()}`);
console.log(`   USDT pool       : ${usdt(snap.usdtPoolWei)}`);
console.log(`   FVB pool        : ${fvb(snap.fvbPoolWei)}`);
console.log(`\n   Entries:`);
for (const e of snap.entries) {
  console.log(`     #${e.rank}  ${e.address}  @${e.xHandle}  score ${e.score}`);
  console.log(`         USDT: ${usdt(e.usdtWei)}  ·  FVB: ${fvb(e.fvbWei)}${e.redirectedToBuyback ? '  (team → buyback)' : ''}`);
}
console.log(`\n   Buyback pool    : ${usdt(snap.buybackPool.usdtWei)} + ${fvb(snap.buybackPool.fvbWei)}`);
console.log(`\n→ Users can now register at https://www.fanvibe.xyz/claim`);
