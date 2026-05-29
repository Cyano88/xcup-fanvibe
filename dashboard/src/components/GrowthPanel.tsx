import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, Trophy, Users } from 'lucide-react';
import { formatOkbUsdFromWei } from '../lib/useOkbUsdPrice';
import { fanDisplayName, getStoredProfileName, shortWallet } from '../lib/fanProfile';
import { captureReferralFromUrl, claimReferralRewards, fetchReferralSummary, getCapturedReferral, type ReferralSummary } from '../lib/accountData';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';

interface LeaderboardEntry {
  rank: number;
  address: string;
  volumeWei: string;
  returnedWei: string;
  wins: number;
  losses: number;
  active: number;
  refunded: number;
  positions: number;
  winRate: number | null;
  lastActiveAt: number;
  displayName?: string;
}

interface Props {
  address: string | null;
  okbUsd: number | null;
}

function compactUsd(value: string | null): string {
  return value?.replace(/^US/, '') ?? '$0.00';
}

export function GrowthPanel({ address, okbUsd }: Props) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [referralSource, setReferralSource] = useState<string | null>(() => getCapturedReferral());
  const [referralSummary, setReferralSummary] = useState<ReferralSummary | null>(null);
  const [claimingRewards, setClaimingRewards] = useState(false);
  const [claimError, setClaimError] = useState('');

  useEffect(() => {
    setReferralSource(captureReferralFromUrl());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch(`${BACKEND_HTTP}/leaderboard?limit=20`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('leaderboard')))
        .then((data: { entries?: LeaderboardEntry[] }) => {
          if (cancelled) return;
          const seen = new Set<string>();
          const unique = (data.entries ?? []).filter(entry => {
            const key = entry.address.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          setLeaderboard(unique);
        })
        .catch(() => {
          if (!cancelled) setLeaderboard([]);
        });
    };
    refresh();
    const timer = setInterval(refresh, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!address) {
      setReferralSummary(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      fetchReferralSummary(address)
        .then(summary => {
          if (!cancelled) setReferralSummary(summary);
        })
        .catch(() => {
          if (!cancelled) setReferralSummary(null);
        });
    };
    refresh();
    const timer = setInterval(refresh, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [address]);

  const referralLink = useMemo(() => {
    if (!address) return 'Sign in to create your invite link';
    return `${window.location.origin}/?ref=${address}`;
  }, [address]);

  const copyReferral = useCallback(() => {
    if (!address) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopiedReferral(true);
      setTimeout(() => setCopiedReferral(false), 1200);
    }).catch(() => {});
  }, [address, referralLink]);

  const claimRewards = useCallback(() => {
    if (!address || claimingRewards) return;
    setClaimError('');
    setClaimingRewards(true);
    claimReferralRewards(address)
      .then(result => setReferralSummary(result.summary))
      .catch((err: unknown) => setClaimError(err instanceof Error ? err.message : 'Reward claim failed'))
      .finally(() => setClaimingRewards(false));
  }, [address, claimingRewards]);

  const topEntries = leaderboard.slice(0, 3);
  const expandedEntries = leaderboard.slice(0, 12);
  const rule = referralSummary?.rewards.rule;
  const rewardLine = referralSummary
    ? `${referralSummary.qualified}/${referralSummary.count} qualified - ${formatOkbUsdFromWei(referralSummary.rewards.claimableWei, okbUsd)?.replace(/^US/, '') ?? '$0.00'} claimable`
    : rule
      ? `${formatOkbUsdFromWei(rule.referrerRewardWei, okbUsd)?.replace(/^US/, '') ?? '0.0005 OKB'} per qualified invite`
      : 'Rewards unlock after a referred wallet stakes.';
  const claimableWei = BigInt(referralSummary?.rewards.claimableWei ?? '0');
  const claimableUsd = compactUsd(formatOkbUsdFromWei(referralSummary?.rewards.claimableWei ?? '0', okbUsd));
  const pendingUsd = compactUsd(formatOkbUsdFromWei(referralSummary?.rewards.pendingWei ?? '0', okbUsd));

  return (
    <div className="mt-4 grid min-w-0 gap-3">
      <div className="min-w-0 rounded-lg border border-zinc-100 bg-white p-3 dark:border-zinc-900 dark:bg-zinc-950">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
              <Users size={12} />
              Referrals
            </div>
            <div className="mt-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50">Invite fans</div>
          </div>
          <button
            type="button"
            onClick={copyReferral}
            disabled={!address}
            className="inline-flex h-8 w-20 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white text-xs font-bold text-zinc-950 transition-colors hover:border-zinc-300 hover:bg-zinc-50 active:border-zinc-300 active:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:active:border-zinc-700 dark:active:bg-zinc-900 dark:focus-visible:ring-zinc-700"
          >
            {copiedReferral ? <Check size={13} /> : <Copy size={13} />}
            {copiedReferral ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="mt-3 min-w-0 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-900 dark:bg-zinc-900/60 dark:text-zinc-500">
          <div className="truncate">{referralLink}</div>
        </div>
        <div className="mt-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-600">
          {referralSource ? `Joined through ${shortWallet(referralSource)}.` : 'Invite rewards qualify after a first valid stake.'}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-md border border-zinc-100 px-2 py-2 dark:border-zinc-900">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600">Invites</div>
            <div className="mt-1 text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{referralSummary?.count ?? 0}</div>
          </div>
          <div className="rounded-md border border-zinc-100 px-2 py-2 dark:border-zinc-900">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600">Qualified</div>
            <div className="mt-1 text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{referralSummary?.qualified ?? 0}</div>
          </div>
          <div className="rounded-md border border-zinc-100 px-2 py-2 dark:border-zinc-900">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600">Pending</div>
            <div className="mt-1 text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {referralSummary?.rewards.pendingOKB ? Number(referralSummary.rewards.pendingOKB).toFixed(4) : '0.0000'} OKB
            </div>
          </div>
        </div>
        <div className="mt-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-600">
          {rewardLine}
        </div>
        <div className="mt-3 flex min-w-0 items-center justify-between gap-3 rounded-md border border-zinc-100 bg-white px-3 py-2 dark:border-zinc-900 dark:bg-zinc-950">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600">Reward cycle</div>
            <div className="mt-1 truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              {claimableWei > 0n ? `${claimableUsd} ready` : `${pendingUsd} pending`}
            </div>
          </div>
          {claimableWei > 0n ? (
            <button
              type="button"
              onClick={claimRewards}
              disabled={claimingRewards}
              className="inline-flex h-8 shrink-0 items-center rounded-md bg-zinc-950 px-3 text-xs font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {claimingRewards ? 'Claiming' : 'Claim'}
            </button>
          ) : referralSummary?.rewards.latestPayoutUrl ? (
            <a
              href={referralSummary.rewards.latestPayoutUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2.5 text-xs font-bold text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-950 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
            >
              Paid <ExternalLink size={11} />
            </a>
          ) : null}
        </div>
        {claimError && (
          <div className="mt-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
            {claimError === 'reward wallet needs funding'
              ? 'Rewards are queued until the reward wallet is funded.'
              : claimError === 'reward wallet is not configured'
                ? 'Rewards are queued until the reward wallet is live.'
              : claimError === 'reward cycle limit reached'
                ? 'Rewards are queued until the next reward cycle.'
                : claimError}
          </div>
        )}
      </div>

      <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-900 dark:bg-transparent">
        <button
          type="button"
          onClick={() => setLeaderboardOpen(open => !open)}
          className="flex w-full min-w-0 items-center justify-between gap-4 px-4 py-3 text-xs text-zinc-500 transition-colors hover:text-zinc-700 dark:bg-transparent dark:text-zinc-600 dark:hover:text-zinc-400"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex shrink-0 items-center gap-2 font-semibold text-zinc-600 dark:text-zinc-400">
              <Trophy size={12} />
              Leaderboard
            </span>
            <span className="season-status-rotate hidden min-w-0 sm:inline-flex text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">
              {topEntries.length === 0 ? (
                <span>Rankings appear after public stakes</span>
              ) : topEntries.map(entry => {
                const profileName = entry.displayName || getStoredProfileName(entry.address);
                const volumeUsd = compactUsd(formatOkbUsdFromWei(entry.volumeWei, okbUsd));
                return (
                  <span key={entry.address} className="truncate">
                    #{entry.rank} {fanDisplayName(entry.address, profileName)} - {volumeUsd}
                  </span>
                );
              })}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <a
              href="/docs"
              onClick={(event) => event.stopPropagation()}
              className="hidden items-center gap-1 text-xs font-semibold text-zinc-400 transition-colors hover:text-blue-500 sm:inline-flex"
            >
              Proof <ExternalLink size={11} />
            </a>
            {leaderboardOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </button>

        {leaderboardOpen && (
          <div className="space-y-2 border-t border-zinc-100 p-3 dark:border-zinc-900">
            {leaderboard.length === 0 ? (
              <div className="rounded-md border border-zinc-100 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-900 dark:text-zinc-500">
                Rankings appear after the first public stakes.
              </div>
            ) : expandedEntries.map(entry => {
              const profileName = entry.displayName || getStoredProfileName(entry.address);
              const volumeUsd = compactUsd(formatOkbUsdFromWei(entry.volumeWei, okbUsd));
              const winRate = entry.winRate === null ? '--' : `${Math.round(entry.winRate * 100)}%`;
              return (
                <div key={entry.address} className="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-900 dark:bg-zinc-900/55">
                  <div className="grid h-7 w-7 place-items-center rounded bg-zinc-950 text-xs font-black text-white dark:bg-white dark:text-zinc-950">
                    {entry.rank}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
                      {fanDisplayName(entry.address, profileName)}
                    </div>
                    <div className="mt-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-600">
                      {entry.wins}W - {entry.losses}L - {entry.active} active
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{volumeUsd}</div>
                    <div className="mt-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-600">{winRate}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
