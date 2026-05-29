import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, Trophy, Users } from 'lucide-react';
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

  const topEntries = leaderboard.slice(0, 3);
  const expandedEntries = leaderboard.slice(0, 12);

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
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-zinc-950 px-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-blue-500 dark:hover:text-white"
          >
            {copiedReferral ? <Check size={13} /> : <Copy size={13} />}
            {copiedReferral ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="mt-3 min-w-0 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-900 dark:bg-zinc-900/60 dark:text-zinc-500">
          <div className="truncate">{referralLink}</div>
        </div>
        <div className="mt-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-600">
          {referralSource ? `Joined through ${shortWallet(referralSource)}.` : 'Invite tracking is stored for the next rewards layer.'}
        </div>
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
