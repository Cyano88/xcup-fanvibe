/**
 * Season 1 Rewards Snapshot — sign and submit
 *
 * Recommended (key never in argv, never in shell history, never in ps aux):
 *   ADMIN_PRIVATE_KEY=0xYOUR_KEY node scripts/snapshot-rewards.mjs
 *
 * Or read from a file (also safe from argv/history):
 *   ADMIN_PRIVATE_KEY_FILE=~/.fanvibe-admin.key node scripts/snapshot-rewards.mjs
 *
 * Fallback (visible to ps aux briefly; leaks into shell history unless you
 * prefix the command with a space and HISTCONTROL=ignorespace is set):
 *   node scripts/snapshot-rewards.mjs 0xYOUR_KEY
 *
 * Optional flags: [--overwrite] [--season=season-1]
 *
 * The admin key never leaves your machine. This script signs
 * X-Cup-Rewards-Snapshot:<seasonId>:<nonce> and POSTs to the backend,
 * which freezes the current qualified top-5 X-connected wallets and
 * their reward allocations to storage.
 */

import { readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';

const args = process.argv.slice(2);
const overwrite = args.includes('--overwrite');
const seasonArg = args.find(a => a.startsWith('--season='));
const seasonId = seasonArg ? seasonArg.split('=')[1] : 'season-1';

function resolveAdminKey() {
  if (process.env.ADMIN_PRIVATE_KEY) return process.env.ADMIN_PRIVATE_KEY.trim();
  if (process.env.ADMIN_PRIVATE_KEY_FILE) {
    return readFileSync(process.env.ADMIN_PRIVATE_KEY_FILE, 'utf8').trim();
  }
  const argKey = args.find(a => a.startsWith('0x') && a.length >= 64);
  return argKey ?? null;
}

const adminPk = resolveAdminKey();

if (!adminPk) {
  console.error('Missing admin key. Set ADMIN_PRIVATE_KEY env var, or ADMIN_PRIVATE_KEY_FILE, or pass the key as an argument.');
  console.error('Example: ADMIN_PRIVATE_KEY=0xYOUR_KEY node scripts/snapshot-rewards.mjs');
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(adminPk)) {
  console.error('Admin key format invalid — expected 0x-prefixed 32-byte hex (64 hex chars).');
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
console.log(`   USD₮0 pool       : ${usdt(snap.usdtPoolWei)}`);
console.log(`   FVB pool        : ${fvb(snap.fvbPoolWei)}`);
console.log(`\n   Entries:`);
for (const e of snap.entries) {
  console.log(`     #${e.rank}  ${e.address}  @${e.xHandle}  score ${e.score}`);
  console.log(`         USD₮0: ${usdt(e.usdtWei)}  ·  FVB: ${fvb(e.fvbWei)}${e.redirectedToBuyback ? '  (team → buyback)' : ''}`);
}
console.log(`\n   Buyback pool    : ${usdt(snap.buybackPool.usdtWei)} + ${fvb(snap.buybackPool.fvbWei)}`);
console.log(`\n→ Users can now register at https://www.fanvibe.xyz/claim`);
