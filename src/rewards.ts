import { recoverMessageAddress } from 'viem';
import {
  readRewardsSnapshot,
  writeRewardsSnapshot,
  type PersistedRewardsEntry,
  type PersistedRewardsSnapshot,
} from './seasonStore.js';

export const SEASON_1_ID = 'season-1';

// USDT on X Layer (Tether USD, 6 decimals) — verified on-chain 2026-07-11
export const USDT_TOKEN_ADDRESS = '0x1E4a5963aBFD975d8c9021ce480b42188849D41d';
export const USDT_DECIMALS = 6;

// Season 1 config — see docs/season1-rewards.md for the source of truth
export const SEASON_1_USDT_POOL_WEI = 200_000_000n; // $200 (6 decimals)
export const SEASON_1_USDT_PER_RANK_WEI = 40_000_000n; // $40 (6 decimals)
export const SEASON_1_FVB_POOL_BPS = 50n; // 0.5% = 50 bps
export const SEASON_1_TOP_N = 5;
export const SEASON_1_FVB_TOP_N = 3;

// Deadlines (UTC)
export const SEASON_1_REGISTRATION_CLOSES_AT = Date.UTC(2026, 6, 13, 23, 59, 0);
export const SEASON_1_FIRST_PAYOUT_AT = SEASON_1_REGISTRATION_CLOSES_AT;
export const SEASON_1_FINAL_PAYOUT_AT = Date.UTC(2026, 7, 11, 23, 59, 0);

// Team wallet — receives no direct reward; its USDT slot is redirected to buyback pool.
const TEAM_WALLET_ADDRESSES = new Set<string>([
  '0x71f38cd580f2b4e31a7e01d60bf5c48e33201b2a',
]);

function isTeamWallet(address: string): boolean {
  return TEAM_WALLET_ADDRESSES.has(address.toLowerCase());
}

export function registrationMessage(seasonId: string, address: string, snapshottedAt: number): string {
  return `X-Cup-Reward-Register:${seasonId}:${address.toLowerCase()}:${snapshottedAt}`;
}

export interface SnapshotCandidate {
  address: string;
  xHandle: string;
  xUserId: string | null;
  score: number;
}

export interface SnapshotInputs {
  seasonId: string;
  block: number;
  candidates: SnapshotCandidate[]; // pre-ranked, already xConnected-filtered
  fvbTotalSupplyWei: bigint;
}

export function computeSnapshotFromInputs(inputs: SnapshotInputs): PersistedRewardsSnapshot {
  const { seasonId, block, candidates, fvbTotalSupplyWei } = inputs;
  const now = Date.now();

  const topN = candidates.slice(0, SEASON_1_TOP_N).map((c, i) => ({ ...c, rank: i + 1 }));
  if (topN.length === 0) throw new Error('No candidates supplied for snapshot');

  const fvbPoolWei = (fvbTotalSupplyWei * SEASON_1_FVB_POOL_BPS) / 10_000n;

  // FVB is only distributed to the top FVB_TOP_N candidates that are NOT team wallets.
  // Team wallet's would-be FVB slot rolls to buyback.
  const fvbEligible = topN
    .filter(c => c.rank <= SEASON_1_FVB_TOP_N)
    .filter(c => !isTeamWallet(c.address));
  const totalFvbEligibleScore = fvbEligible.reduce((sum, c) => sum + Math.max(0, c.score), 0);

  const buybackSources: PersistedRewardsSnapshot['buybackPool']['sources'] = [];
  let buybackUsdtWei = 0n;
  let buybackFvbWei = 0n;

  const entries: PersistedRewardsEntry[] = topN.map(c => {
    const teamWallet = isTeamWallet(c.address);
    const usdtAllocatedWei = teamWallet ? 0n : SEASON_1_USDT_PER_RANK_WEI;

    let fvbAllocatedWei = 0n;
    if (c.rank <= SEASON_1_FVB_TOP_N && !teamWallet && totalFvbEligibleScore > 0) {
      // Weighted by score. Integer-safe: numerator first, then divide.
      const scaledScore = BigInt(Math.max(0, c.score));
      const denom = BigInt(totalFvbEligibleScore);
      fvbAllocatedWei = (fvbPoolWei * scaledScore) / denom;
    }

    if (teamWallet) {
      buybackUsdtWei += SEASON_1_USDT_PER_RANK_WEI;
      buybackSources.push({
        reason: 'team_wallet',
        address: c.address.toLowerCase(),
        usdtWei: SEASON_1_USDT_PER_RANK_WEI.toString(),
        fvbWei: '0',
      });
    }

    return {
      rank: c.rank,
      address: c.address.toLowerCase(),
      xHandle: c.xHandle,
      xUserId: c.xUserId,
      score: c.score,
      usdtWei: usdtAllocatedWei.toString(),
      fvbWei: fvbAllocatedWei.toString(),
      tranches: {
        firstUsdtWei: (usdtAllocatedWei / 2n).toString(),
        firstFvbWei: (fvbAllocatedWei / 2n).toString(),
        finalUsdtWei: (usdtAllocatedWei - usdtAllocatedWei / 2n).toString(),
        finalFvbWei: (fvbAllocatedWei - fvbAllocatedWei / 2n).toString(),
      },
      redirectedToBuyback: teamWallet,
      registeredAt: null,
      registrationSignature: null,
      registrationMessage: null,
      firstUsdtStatus: 'pending',
      firstUsdtTxHash: null,
      firstFvbStatus: 'pending',
      firstFvbTxHash: null,
      finalUsdtStatus: 'pending',
      finalUsdtTxHash: null,
      finalFvbStatus: 'pending',
      finalFvbTxHash: null,
    };
  });

  // Fold FVB dust from integer division into buyback so nothing is silently lost.
  const totalFvbAllocated = entries.reduce((sum, e) => sum + BigInt(e.fvbWei), 0n);
  const fvbDust = fvbPoolWei - totalFvbAllocated;
  if (fvbDust > 0n) {
    buybackFvbWei += fvbDust;
    buybackSources.push({
      reason: 'forfeit',
      address: 'dust',
      usdtWei: '0',
      fvbWei: fvbDust.toString(),
    });
  }

  return {
    version: 1,
    seasonId,
    snapshottedAt: now,
    snapshottedAtBlock: block,
    registrationClosesAt: SEASON_1_REGISTRATION_CLOSES_AT,
    firstPayoutAt: SEASON_1_FIRST_PAYOUT_AT,
    finalPayoutAt: SEASON_1_FINAL_PAYOUT_AT,
    fvbTokenAddress: (process.env.FANVIBE_TOKEN_ADDRESS ?? '0x35a676Ca9347499f97819813a38ED14e6a7C5e3F').toLowerCase(),
    fvbDecimals: 18,
    fvbTotalSupplyWei: fvbTotalSupplyWei.toString(),
    fvbPoolWei: fvbPoolWei.toString(),
    usdtTokenAddress: USDT_TOKEN_ADDRESS.toLowerCase(),
    usdtDecimals: USDT_DECIMALS,
    usdtPoolWei: SEASON_1_USDT_POOL_WEI.toString(),
    usdtPerRankWei: SEASON_1_USDT_PER_RANK_WEI.toString(),
    entries,
    buybackPool: {
      usdtWei: buybackUsdtWei.toString(),
      fvbWei: buybackFvbWei.toString(),
      sources: buybackSources,
    },
    updatedAt: now,
  };
}

export async function loadOrCreateSnapshot(inputs: SnapshotInputs): Promise<PersistedRewardsSnapshot> {
  const existing = await readRewardsSnapshot(inputs.seasonId);
  if (existing) return existing;
  const snapshot = computeSnapshotFromInputs(inputs);
  await writeRewardsSnapshot(snapshot);
  return snapshot;
}

export async function loadSnapshot(seasonId: string): Promise<PersistedRewardsSnapshot | null> {
  return readRewardsSnapshot(seasonId);
}

function findEntryIndex(snapshot: PersistedRewardsSnapshot, address: string): number {
  const target = address.toLowerCase();
  return snapshot.entries.findIndex(e => e.address.toLowerCase() === target);
}

export function publicViewOfEntry(entry: PersistedRewardsEntry) {
  return {
    rank: entry.rank,
    address: entry.address,
    xHandle: entry.xHandle,
    score: entry.score,
    usdtWei: entry.usdtWei,
    fvbWei: entry.fvbWei,
    tranches: entry.tranches,
    redirectedToBuyback: entry.redirectedToBuyback,
    registered: entry.registeredAt !== null,
    registeredAt: entry.registeredAt,
    firstUsdtStatus: entry.firstUsdtStatus,
    firstUsdtTxHash: entry.firstUsdtTxHash,
    firstFvbStatus: entry.firstFvbStatus,
    firstFvbTxHash: entry.firstFvbTxHash,
    finalUsdtStatus: entry.finalUsdtStatus,
    finalUsdtTxHash: entry.finalUsdtTxHash,
    finalFvbStatus: entry.finalFvbStatus,
    finalFvbTxHash: entry.finalFvbTxHash,
  };
}

export function publicViewOfSnapshot(snapshot: PersistedRewardsSnapshot) {
  return {
    seasonId: snapshot.seasonId,
    snapshottedAt: snapshot.snapshottedAt,
    snapshottedAtBlock: snapshot.snapshottedAtBlock,
    registrationClosesAt: snapshot.registrationClosesAt,
    firstPayoutAt: snapshot.firstPayoutAt,
    finalPayoutAt: snapshot.finalPayoutAt,
    fvbTokenAddress: snapshot.fvbTokenAddress,
    fvbDecimals: snapshot.fvbDecimals,
    fvbPoolWei: snapshot.fvbPoolWei,
    usdtTokenAddress: snapshot.usdtTokenAddress,
    usdtDecimals: snapshot.usdtDecimals,
    usdtPoolWei: snapshot.usdtPoolWei,
    usdtPerRankWei: snapshot.usdtPerRankWei,
    entries: snapshot.entries.map(publicViewOfEntry),
    buybackPool: snapshot.buybackPool,
  };
}

export interface RegisterInput {
  seasonId: string;
  address: string;
  signature: `0x${string}`;
}

export async function registerForRewards(input: RegisterInput): Promise<PersistedRewardsEntry> {
  const snapshot = await readRewardsSnapshot(input.seasonId);
  if (!snapshot) throw new Error('Snapshot not found');

  const now = Date.now();
  if (now >= snapshot.registrationClosesAt) {
    throw new Error('Registration window has closed');
  }

  const idx = findEntryIndex(snapshot, input.address);
  if (idx === -1) throw new Error('Address not in reward snapshot');
  const entry = snapshot.entries[idx];

  if (entry.registeredAt !== null) {
    // Idempotent: same signature returns the existing registration; otherwise reject.
    if (entry.registrationSignature === input.signature) return entry;
    throw new Error('Address already registered');
  }

  const message = registrationMessage(snapshot.seasonId, entry.address, snapshot.snapshottedAt);
  const recovered = await recoverMessageAddress({
    message,
    signature: input.signature,
  });
  if (recovered.toLowerCase() !== entry.address.toLowerCase()) {
    throw new Error(`Signature does not match address — recovered ${recovered}, expected ${entry.address}`);
  }

  const updated: PersistedRewardsEntry = {
    ...entry,
    registeredAt: now,
    registrationSignature: input.signature,
    registrationMessage: message,
  };
  snapshot.entries[idx] = updated;
  await writeRewardsSnapshot(snapshot);
  return updated;
}

export type TrancheKind = 'first' | 'final';
export type RewardToken = 'usdt' | 'fvb';

export function releaseMessage(
  seasonId: string,
  address: string,
  token: RewardToken,
  tranche: TrancheKind,
  nonce: number,
): string {
  return `X-Cup-Rewards-Release:${seasonId}:${address.toLowerCase()}:${token}:${tranche}:${nonce}`;
}

interface TrancheAmounts {
  amountWei: bigint;
  statusField: keyof PersistedRewardsEntry;
  txHashField: keyof PersistedRewardsEntry;
  unlockAt: number;
  tokenAddress: string;
}

function trancheDetails(
  snapshot: PersistedRewardsSnapshot,
  entry: PersistedRewardsEntry,
  token: RewardToken,
  tranche: TrancheKind,
): TrancheAmounts {
  const isUsdt = token === 'usdt';
  const isFirst = tranche === 'first';
  const amountWei = isUsdt
    ? BigInt(isFirst ? entry.tranches.firstUsdtWei : entry.tranches.finalUsdtWei)
    : BigInt(isFirst ? entry.tranches.firstFvbWei : entry.tranches.finalFvbWei);
  const statusField = (
    isUsdt
      ? (isFirst ? 'firstUsdtStatus' : 'finalUsdtStatus')
      : (isFirst ? 'firstFvbStatus' : 'finalFvbStatus')
  ) as keyof PersistedRewardsEntry;
  const txHashField = (
    isUsdt
      ? (isFirst ? 'firstUsdtTxHash' : 'finalUsdtTxHash')
      : (isFirst ? 'firstFvbTxHash' : 'finalFvbTxHash')
  ) as keyof PersistedRewardsEntry;
  return {
    amountWei,
    statusField,
    txHashField,
    unlockAt: isFirst ? snapshot.firstPayoutAt : snapshot.finalPayoutAt,
    tokenAddress: isUsdt ? snapshot.usdtTokenAddress : snapshot.fvbTokenAddress,
  };
}

export interface ReleaseInput {
  seasonId: string;
  address: string;
  token: RewardToken;
  tranche: TrancheKind;
  send: (params: { token: `0x${string}`; to: `0x${string}`; amountWei: bigint; label: string }) => Promise<`0x${string}`>;
}

export interface ReleaseResult {
  txHash: `0x${string}`;
  entry: PersistedRewardsEntry;
}

export function forfeitMessage(seasonId: string, address: string, nonce: number): string {
  return `X-Cup-Rewards-Forfeit:${seasonId}:${address.toLowerCase()}:${nonce}`;
}

export async function forfeitToBuyback(seasonId: string, address: string): Promise<PersistedRewardsSnapshot> {
  const snapshot = await readRewardsSnapshot(seasonId);
  if (!snapshot) throw new Error('Snapshot not found');

  const idx = snapshot.entries.findIndex(e => e.address.toLowerCase() === address.toLowerCase());
  if (idx === -1) throw new Error('Address not in reward snapshot');
  const entry = snapshot.entries[idx];

  if (entry.registeredAt !== null) throw new Error('Address is registered — cannot forfeit');
  if (Date.now() < snapshot.registrationClosesAt) {
    throw new Error(`Registration window still open until ${new Date(snapshot.registrationClosesAt).toISOString()}`);
  }
  if (entry.redirectedToBuyback) throw new Error('This slot was already routed to buyback');

  const usdtWei = BigInt(entry.usdtWei);
  const fvbWei = BigInt(entry.fvbWei);
  if (usdtWei === 0n && fvbWei === 0n) throw new Error('No allocation left to sweep');

  // Refuse if any payout was already sent — that would create a bookkeeping inconsistency.
  const anySent = [
    entry.firstUsdtStatus,
    entry.firstFvbStatus,
    entry.finalUsdtStatus,
    entry.finalFvbStatus,
  ].some(status => status === 'sent');
  if (anySent) throw new Error('At least one tranche has already been paid — refusing to sweep');

  const updatedEntry: PersistedRewardsEntry = {
    ...entry,
    usdtWei: '0',
    fvbWei: '0',
    tranches: {
      firstUsdtWei: '0',
      firstFvbWei: '0',
      finalUsdtWei: '0',
      finalFvbWei: '0',
    },
    redirectedToBuyback: true,
  };
  snapshot.entries[idx] = updatedEntry;
  snapshot.buybackPool = {
    usdtWei: (BigInt(snapshot.buybackPool.usdtWei) + usdtWei).toString(),
    fvbWei: (BigInt(snapshot.buybackPool.fvbWei) + fvbWei).toString(),
    sources: [
      ...snapshot.buybackPool.sources,
      {
        reason: 'forfeit',
        address: entry.address.toLowerCase(),
        usdtWei: usdtWei.toString(),
        fvbWei: fvbWei.toString(),
      },
    ],
  };
  await writeRewardsSnapshot(snapshot);
  return snapshot;
}

export async function releaseTranche(input: ReleaseInput): Promise<ReleaseResult> {
  const snapshot = await readRewardsSnapshot(input.seasonId);
  if (!snapshot) throw new Error('Snapshot not found');

  const idx = snapshot.entries.findIndex(e => e.address.toLowerCase() === input.address.toLowerCase());
  if (idx === -1) throw new Error('Address not in reward snapshot');
  const entry = snapshot.entries[idx];

  if (entry.registeredAt === null) throw new Error('Address has not registered');
  if (entry.redirectedToBuyback) throw new Error('This slot is redirected to buyback and cannot be released to the wallet');

  const { amountWei, statusField, txHashField, unlockAt, tokenAddress } = trancheDetails(
    snapshot,
    entry,
    input.token,
    input.tranche,
  );

  if (amountWei <= 0n) throw new Error(`No allocation for ${input.token} in ${input.tranche} tranche`);
  const now = Date.now();
  if (now < unlockAt) throw new Error(`Tranche is still locked until ${new Date(unlockAt).toISOString()}`);

  const currentStatus = entry[statusField] as PersistedRewardsEntry['firstUsdtStatus'];
  if (currentStatus === 'sent') throw new Error('Tranche already sent — refusing to double-send');

  // Reserve slot before sending: mark as pending in-memory (does not persist yet — we persist after we get a hash).
  // Because the release path is admin-triggered and single-threaded per request, no lock is needed beyond this
  // "check status === sent → abort" guard.

  const txHash = await input.send({
    token: tokenAddress as `0x${string}`,
    to: entry.address as `0x${string}`,
    amountWei,
    label: `${input.token.toUpperCase()} ${input.tranche} tranche → rank #${entry.rank}`,
  });

  const updated: PersistedRewardsEntry = {
    ...entry,
    [statusField]: 'sent',
    [txHashField]: txHash,
  } as PersistedRewardsEntry;
  snapshot.entries[idx] = updated;
  await writeRewardsSnapshot(snapshot);
  return { txHash, entry: updated };
}
