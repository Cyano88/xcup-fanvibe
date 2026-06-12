import { useEffect, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { AlertCircle, CheckCircle2, ExternalLink, Medal, Trophy, Wallet } from 'lucide-react';
import { formatUnits } from 'viem';
import { formatOkbUsdFromWei } from '../lib/useOkbUsdPrice';
import { fanDisplayName, getStoredProfileName, shortWallet } from '../lib/fanProfile';
import { xLayerPublicClient } from '../lib/publicClient';
import { FANVIBE_TOKEN_ADDRESS, FANVIBE_TOKEN_URL } from '../lib/fanvibeToken';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const FANVIBE_SEASON_BG = '/assets/fanvibe-season-bg.jpeg';
const FVB_ENTRY_MIN_WEI = 1n;
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

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

interface CountrySupportEntry {
  rank: number;
  code: string;
  name: string;
  iso: string;
  volumeWei: string;
  positions: number;
  supporters: number;
  lastActiveAt: number;
}

interface Props {
  okbUsd: number | null;
  onOpenWorldCup: () => void;
}

function compactUsd(value: string | null): string {
  return value?.replace(/^US/, '') ?? '$0.00';
}

function compactTokenBalance(value: bigint): string {
  const n = Number(formatUnits(value, 18));
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 1 : 2)}K`;
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n > 0 ? '< 1' : '0';
}

const rankPrize = (rank: number) => {
  if (rank === 1) return '$100';
  if (rank === 2) return '$60';
  if (rank === 3) return '$30';
  return '$10';
};

const rankTone = (rank: number) => {
  if (rank === 1) return 'from-amber-300/30 to-yellow-500/10 text-amber-100 border-amber-200/30';
  if (rank === 2) return 'from-zinc-200/25 to-white/5 text-zinc-100 border-white/20';
  return 'from-blue-300/25 to-blue-500/10 text-blue-100 border-blue-200/25';
};

const flagUrl = (iso: string) =>
  iso === 'un' || iso === 'tbd' ? '' : `https://flagcdn.com/w640/${iso.toLowerCase()}.png`;

export function MatchdayCupLeaderboard({ okbUsd, onOpenWorldCup }: Props) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [countrySupport, setCountrySupport] = useState<CountrySupportEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [supportLoaded, setSupportLoaded] = useState(false);
  const [fvbBalance, setFvbBalance] = useState<bigint | null>(null);
  const [eligibilityLoaded, setEligibilityLoaded] = useState(false);
  const connectedAddress = user?.wallet?.address ?? wallets[0]?.address ?? null;

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch(`${BACKEND_HTTP}/matchday-cup/leaderboard?limit=10`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('matchday leaderboard')))
        .then((data: { entries?: LeaderboardEntry[] }) => {
          if (cancelled) return;
          setEntries(data.entries ?? []);
          setLoaded(true);
        })
        .catch(() => {
          if (cancelled) return;
          setEntries([]);
          setLoaded(true);
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
    let cancelled = false;
    const refresh = () => {
      fetch(`${BACKEND_HTTP}/matchday-cup/country-support?limit=6`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('country support')))
        .then((data: { entries?: CountrySupportEntry[] }) => {
          if (cancelled) return;
          setCountrySupport(data.entries ?? []);
          setSupportLoaded(true);
        })
        .catch(() => {
          if (cancelled) return;
          setCountrySupport([]);
          setSupportLoaded(true);
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
    if (!connectedAddress) {
      setFvbBalance(null);
      setEligibilityLoaded(false);
      return;
    }

    let cancelled = false;
    const refresh = () => {
      xLayerPublicClient.readContract({
        address: FANVIBE_TOKEN_ADDRESS as `0x${string}`,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [connectedAddress as `0x${string}`],
      })
        .then(balance => {
          if (cancelled) return;
          setFvbBalance(balance);
          setEligibilityLoaded(true);
        })
        .catch(() => {
          if (cancelled) return;
          setFvbBalance(null);
          setEligibilityLoaded(true);
        });
    };

    refresh();
    const timer = setInterval(refresh, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connectedAddress]);

  const topThree = entries.slice(0, 3);
  const eligible = !!connectedAddress && fvbBalance !== null && fvbBalance >= FVB_ENTRY_MIN_WEI;
  const eligibilityLabel = !connectedAddress
    ? 'Connect wallet to check entry'
    : !eligibilityLoaded
      ? 'Checking $FVB balance'
      : eligible
        ? 'Eligible for Matchday Cup'
        : 'Hold $FVB to enter';
  const eligibilityDetail = !connectedAddress
    ? 'Use the same wallet for $FVB and match stakes.'
    : fvbBalance === null
      ? 'Balance check unavailable. Try again from an X Layer wallet.'
      : `${compactTokenBalance(fvbBalance)} FVB in ${shortWallet(connectedAddress)}`;

  return (
    <section
      className="fanvibe-live-panel rounded-lg border border-white/10 p-4 shadow-sm"
      style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}
    >
      <div className="relative z-10 space-y-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-blue-100/90">
              <Trophy size={13} />
              Matchday leaderboard
            </div>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Top fans chasing the $200 Matchday Cup.
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-200/90">
              Rankings come from OKB stakes placed on live World Cup match predictions. Hold $FVB for entry and use the same wallet for stakes.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenWorldCup}
            className="inline-flex h-9 shrink-0 items-center rounded-lg bg-white px-3 text-xs font-bold text-zinc-950 transition-colors hover:bg-zinc-200"
          >
            Open matches
          </button>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {topThree.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/15 bg-black/25 px-3 py-8 text-center text-sm text-zinc-300 md:col-span-3">
              {loaded ? 'The first real World Cup stake starts the Matchday Cup ranking.' : 'Loading Matchday Cup ranking...'}
            </div>
          ) : topThree.map(entry => {
            const profileName = entry.displayName || getStoredProfileName(entry.address);
            const volumeUsd = compactUsd(formatOkbUsdFromWei(entry.volumeWei, okbUsd));
            const record = `${entry.wins}W - ${entry.losses}L - ${entry.active} active`;
            return (
              <div key={entry.address} className={`rounded-lg border bg-gradient-to-br ${rankTone(entry.rank)} px-3 py-3 shadow-sm backdrop-blur-[2px]`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/35 text-white">
                      {entry.rank === 1 ? <Trophy size={18} /> : <Medal size={18} />}
                    </div>
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-white/60">Rank {entry.rank}</div>
                      <div className="text-sm font-semibold text-white">{rankPrize(entry.rank)}</div>
                    </div>
                  </div>
                  <div className="text-right text-xs font-bold tabular-nums text-white">{volumeUsd}</div>
                </div>
                <div className="mt-4 truncate text-sm font-semibold text-white">
                  {fanDisplayName(entry.address, profileName)}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-medium text-white/60">
                  <span>{record}</span>
                  <span>{shortWallet(entry.address)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className={`flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3 backdrop-blur-[2px] ${
          eligible
            ? 'border-emerald-300/25 bg-emerald-500/10'
            : 'border-white/10 bg-black/30'
        }`}>
          <div className="flex min-w-0 items-center gap-3">
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
              eligible ? 'bg-emerald-500 text-white' : 'bg-white text-zinc-950'
            }`}>
              {eligible ? <CheckCircle2 size={17} /> : connectedAddress ? <AlertCircle size={17} /> : <Wallet size={17} />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">{eligibilityLabel}</div>
              <div className="mt-0.5 truncate text-xs font-medium text-zinc-300">{eligibilityDetail}</div>
            </div>
          </div>
          <a
            href={FANVIBE_TOKEN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-bold text-zinc-200 transition-colors hover:border-blue-300/50 hover:text-blue-100"
          >
            Buy $FVB
            <ExternalLink size={12} />
          </a>
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-100/80">
                Country backing
              </div>
              <div className="mt-1 text-sm font-semibold text-white">
                Nations rising from match stakes
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {countrySupport.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/15 bg-black/25 px-3 py-4 text-center text-sm text-zinc-300 sm:col-span-2 lg:col-span-3">
                {supportLoaded ? 'Country backing appears after fans stake home or away on real World Cup matches.' : 'Loading country backing...'}
              </div>
            ) : countrySupport.map(entry => {
              const volumeUsd = compactUsd(formatOkbUsdFromWei(entry.volumeWei, okbUsd));
              const flag = flagUrl(entry.iso);
              return (
                <div key={entry.code} className="flex min-w-0 items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 backdrop-blur-[2px]">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded bg-white text-xs font-black text-zinc-950">
                    {entry.rank}
                  </div>
                  {flag ? (
                    <img src={flag} alt="" className="h-7 w-10 shrink-0 rounded object-cover ring-1 ring-white/15" />
                  ) : (
                    <div className="h-7 w-10 shrink-0 rounded bg-white/10" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">{entry.name}</div>
                    <div className="mt-0.5 text-[11px] font-medium text-zinc-400">
                      {entry.supporters} fans - {entry.positions} stakes
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs font-bold tabular-nums text-white">
                    {volumeUsd}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
