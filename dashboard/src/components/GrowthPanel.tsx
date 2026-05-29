import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Share2, Trophy, Users } from 'lucide-react';
import type { UserPosition } from '../types';
import { formatOkbUsdFromWei } from '../lib/useOkbUsdPrice';
import { fanDisplayName, getStoredProfileName, shortWallet } from '../lib/fanProfile';
import { captureReferralFromUrl, getCapturedReferral } from '../lib/accountData';

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
  positions: UserPosition[];
  okbUsd: number | null;
}

function compactUsd(value: string | null): string {
  return value?.replace(/^US/, '') ?? '$0.00';
}

function formatPositionAmount(position: UserPosition, okbUsd: number | null): string {
  const wei = position.type === 'refund' ? position.refund.amountWei : position.stake.amountWei;
  return compactUsd(formatOkbUsdFromWei(wei, okbUsd));
}

function shareTitle(position?: UserPosition): string {
  if (!position) return 'FanVibe prediction';
  if (position.type === 'champion') return `${position.stake.teamCode} to win the World Cup`;
  if (position.type === 'refund') return `${position.refund.outcome.toUpperCase()} refunded`;
  const fixture = position.fixture ?? position.stake.fixture;
  const matchup = fixture ? `${fixture.home.code} vs ${fixture.away.code}` : 'World Cup match';
  return `${position.stake.outcome.toUpperCase()} on ${matchup}`;
}

function shareText(position: UserPosition | undefined, address: string | null, okbUsd: number | null): string {
  const amount = position ? formatPositionAmount(position, okbUsd) : '$0.00';
  const name = fanDisplayName(address, getStoredProfileName(address)) || 'A FanVibe user';
  return `${name} backed ${shareTitle(position)} on FanVibe (${amount}). Verified on X Layer.\n\nhttps://fanvibe.xyz`;
}

export function GrowthPanel({ address, positions, okbUsd }: Props) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const [referralSource, setReferralSource] = useState<string | null>(() => getCapturedReferral());

  useEffect(() => {
    setReferralSource(captureReferralFromUrl());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch(`${BACKEND_HTTP}/leaderboard?limit=5`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('leaderboard')))
        .then((data: { entries?: LeaderboardEntry[] }) => {
          if (!cancelled) setLeaderboard(data.entries ?? []);
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

  const referralLink = useMemo(() => {
    if (!address) return 'Sign in to create your invite link';
    return `${window.location.origin}/?ref=${address}`;
  }, [address]);

  const sharePosition = positions[0];
  const shareCopy = useMemo(() => shareText(sharePosition, address, okbUsd), [address, okbUsd, sharePosition]);

  const copyReferral = useCallback(() => {
    if (!address) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopiedReferral(true);
      setTimeout(() => setCopiedReferral(false), 1200);
    }).catch(() => {});
  }, [address, referralLink]);

  const shareStake = useCallback(() => {
    if (navigator.share) {
      navigator.share({ title: 'FanVibe', text: shareCopy, url: 'https://fanvibe.xyz' }).catch(() => {});
      return;
    }
    navigator.clipboard.writeText(shareCopy).then(() => {
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 1200);
    }).catch(() => {});
  }, [shareCopy]);

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.15fr]">
      <div className="rounded-lg border border-zinc-100 bg-white p-3 dark:border-zinc-900 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-3">
          <div>
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
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-950 px-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-blue-500 dark:hover:text-white"
          >
            {copiedReferral ? <Check size={13} /> : <Copy size={13} />}
            {copiedReferral ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="mt-3 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-900 dark:bg-zinc-900/60 dark:text-zinc-500">
          <div className="truncate">{referralLink}</div>
        </div>
        <div className="mt-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-600">
          {referralSource ? `Joined through ${shortWallet(referralSource)}.` : 'Invite tracking is stored for the next rewards layer.'}
        </div>

        <div className="mt-4 rounded-lg border border-zinc-100 bg-zinc-950 p-3 text-white dark:border-zinc-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-blue-300">Share card</div>
              <div className="mt-2 text-lg font-semibold leading-tight">{shareTitle(sharePosition)}</div>
              <div className="mt-2 text-sm font-medium text-zinc-400">{sharePosition ? formatPositionAmount(sharePosition, okbUsd) : 'Place a stake to generate your first card'}</div>
            </div>
            <div className="rounded-md bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-950">X Layer</div>
          </div>
          <button
            type="button"
            onClick={shareStake}
            disabled={!sharePosition}
            className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-white text-xs font-bold text-zinc-950 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Share2 size={13} />
            {copiedShare ? 'Copied' : 'Share stake'}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white p-3 dark:border-zinc-900 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
              <Trophy size={12} />
              Leaderboard
            </div>
            <div className="mt-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50">Top fans</div>
          </div>
          <a href="/docs" className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 transition-colors hover:text-blue-500">
            Proof <ExternalLink size={11} />
          </a>
        </div>
        <div className="mt-3 space-y-2">
          {leaderboard.length === 0 ? (
            <div className="rounded-md border border-zinc-100 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-900 dark:text-zinc-500">
              Rankings appear after the first public stakes.
            </div>
          ) : leaderboard.map(entry => {
            const profileName = entry.displayName || getStoredProfileName(entry.address);
            const volumeUsd = compactUsd(formatOkbUsdFromWei(entry.volumeWei, okbUsd));
            const winRate = entry.winRate === null ? '--' : `${Math.round(entry.winRate * 100)}%`;
            return (
              <div key={entry.address} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-900 dark:bg-zinc-900/55">
                <div className="grid h-7 w-7 place-items-center rounded bg-zinc-950 text-xs font-black text-white dark:bg-white dark:text-zinc-950">
                  {entry.rank}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    {fanDisplayName(entry.address, profileName)}
                  </div>
                  <div className="mt-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-600">
                    {entry.wins}W · {entry.losses}L · {entry.active} active
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
      </div>
    </div>
  );
}
