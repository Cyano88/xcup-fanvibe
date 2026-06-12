import { useEffect, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { AlertCircle, CheckCircle2, ExternalLink, Trophy, Wallet } from 'lucide-react';
import { formatUnits } from 'viem';
import { formatOkbUsdFromWei } from '../lib/useOkbUsdPrice';
import { fanDisplayName, getStoredProfileName, shortWallet } from '../lib/fanProfile';
import { xLayerPublicClient } from '../lib/publicClient';
import { FANVIBE_TOKEN_ADDRESS, FANVIBE_TOKEN_URL } from '../lib/fanvibeToken';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
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
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-900 dark:bg-zinc-950 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-600">
            <Trophy size={13} />
            Matchday Cup leaderboard
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Real World Cup fixtures only
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Rankings come from OKB stakes placed on live World Cup match predictions. Hold $FVB for Matchday Cup entry.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenWorldCup}
          className="inline-flex h-9 shrink-0 items-center rounded-lg bg-zinc-950 px-3 text-xs font-bold text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Open matches
        </button>
      </div>

      <div className={`mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3 ${
        eligible
          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10'
          : 'border-zinc-100 bg-zinc-50 dark:border-zinc-900 dark:bg-zinc-900/60'
      }`}>
        <div className="flex min-w-0 items-center gap-3">
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
            eligible
              ? 'bg-emerald-600 text-white'
              : 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950'
          }`}>
            {eligible ? <CheckCircle2 size={17} /> : connectedAddress ? <AlertCircle size={17} /> : <Wallet size={17} />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{eligibilityLabel}</div>
            <div className="mt-0.5 truncate text-xs font-medium text-zinc-500 dark:text-zinc-500">{eligibilityDetail}</div>
          </div>
        </div>
        <a
          href={FANVIBE_TOKEN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-800 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-blue-500/50 dark:hover:text-blue-300"
        >
          Buy $FVB
          <ExternalLink size={12} />
        </a>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {topThree.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-5 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-500 md:col-span-3">
            {loaded ? 'The first real World Cup stake starts the Matchday Cup ranking.' : 'Loading Matchday Cup ranking...'}
          </div>
        ) : topThree.map(entry => {
          const profileName = entry.displayName || getStoredProfileName(entry.address);
          const volumeUsd = compactUsd(formatOkbUsdFromWei(entry.volumeWei, okbUsd));
          const record = `${entry.wins}W - ${entry.losses}L - ${entry.active} active`;
          return (
            <div key={entry.address} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3 dark:border-zinc-900 dark:bg-zinc-900/60">
              <div className="flex items-center justify-between gap-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded bg-blue-600 text-xs font-black text-white">
                  {entry.rank}
                </div>
                <div className="text-right text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {volumeUsd}
                </div>
              </div>
              <div className="mt-3 truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                {fanDisplayName(entry.address, profileName)}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-600">
                <span>{record}</span>
                <span>{shortWallet(entry.address)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-600">
              Country backing
            </div>
            <div className="mt-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Nations rising from match stakes
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {countrySupport.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-500 sm:col-span-2 lg:col-span-3">
              {supportLoaded ? 'Country backing appears after fans stake home or away on real World Cup matches.' : 'Loading country backing...'}
            </div>
          ) : countrySupport.map(entry => {
            const volumeUsd = compactUsd(formatOkbUsdFromWei(entry.volumeWei, okbUsd));
            const flag = flagUrl(entry.iso);
            return (
              <div key={entry.code} className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-900 dark:bg-zinc-900/60">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded bg-zinc-950 text-xs font-black text-white dark:bg-white dark:text-zinc-950">
                  {entry.rank}
                </div>
                {flag ? (
                  <img src={flag} alt="" className="h-7 w-10 shrink-0 rounded object-cover ring-1 ring-zinc-200 dark:ring-zinc-800" />
                ) : (
                  <div className="h-7 w-10 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{entry.name}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-600">
                    {entry.supporters} fans - {entry.positions} stakes
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {volumeUsd}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
