import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { formatOkbUsdFromWei } from '../lib/useOkbUsdPrice';
import { fanDisplayName, getStoredProfileName, shortWallet } from '../lib/fanProfile';
import { explorerAddr } from '../lib/chain';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const FANVIBE_SEASON_BG = '/assets/fanvibe-season-bg.jpeg';
const LEADERBOARD_BATCH_SIZE = 20;

interface MatchdayEntry {
  rank: number | null;
  address: string;
  displayName?: string;
  volumeWei: string;
  returnedWei: string;
  wins: number;
  losses: number;
  active: number;
  refunded: number;
  positions: number;
  winRate: number | null;
  lastActiveAt: number;
  score?: number;
  scoreComponents?: {
    volume: number;
    wins: number;
    active: number;
    participation: number;
  };
  fvbBalanceWei?: string | null;
  fvbEligibleWei?: string | null;
  fvbEligibilityCapWei?: string;
  fvbEligible?: boolean | null;
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
  address?: string | null;
  onOpenWorldCup: () => void;
}

interface MatchdayActivityMeta {
  totalFans: number;
  eligibleFans: number;
  pendingFvbFans: number;
  syncingFvbFans: number;
}

function compactUsd(value: string | null): string {
  return value?.replace(/^US/, '') ?? '$0.00';
}

function formatOkbVolume(value: string): string {
  const n = Number(value) / 1e18;
  if (!Number.isFinite(n)) return '0';
  if (n >= 100) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return n > 0 ? n.toFixed(4) : '0';
}

function formatFvbBalance(value: string | null | undefined): string {
  if (!value) return '0';
  const n = Number(value) / 1e18;
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 1 : 2)}K`;
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n > 0 ? '< 1' : '0';
}

function formatScore(value: number | undefined): string {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value ?? 0).toLocaleString();
}

function scoreBreakdown(entry: MatchdayEntry): string {
  const parts = entry.scoreComponents;
  if (!parts) return `${entry.positions} stake${entry.positions === 1 ? '' : 's'}`;
  return [
    `Volume ${formatScore(parts.volume)}`,
    `Wins ${formatScore(parts.wins)}`,
    `Live ${formatScore(parts.active)}`,
    `Stakes ${formatScore(parts.participation)}`,
  ].join(' / ');
}

const flagUrl = (iso: string) =>
  iso === 'un' || iso === 'tbd' ? '' : `https://flagcdn.com/w640/${iso.toLowerCase()}.png`;

export function MatchdayCupLeaderboard({ okbUsd, address, onOpenWorldCup }: Props) {
  const [activeBoard, setActiveBoard] = useState<'matchday' | 'countries'>('matchday');
  const [matchdayEntries, setMatchdayEntries] = useState<MatchdayEntry[]>([]);
  const [countrySupport, setCountrySupport] = useState<CountrySupportEntry[]>([]);
  const [myRank, setMyRank] = useState<MatchdayEntry | null>(null);
  const [myRankLoaded, setMyRankLoaded] = useState(false);
  const [matchdayLoaded, setMatchdayLoaded] = useState(false);
  const [supportLoaded, setSupportLoaded] = useState(false);
  const [matchdayActivity, setMatchdayActivity] = useState<MatchdayActivityMeta | null>(null);
  const [visibleMatchday, setVisibleMatchday] = useState(LEADERBOARD_BATCH_SIZE);
  const [visibleCountries, setVisibleCountries] = useState(LEADERBOARD_BATCH_SIZE);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch(`${BACKEND_HTTP}/matchday-cup/leaderboard?limit=50`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('matchday leaderboard')))
        .then((data: { entries?: MatchdayEntry[]; activity?: MatchdayActivityMeta }) => {
          if (cancelled) return;
          setMatchdayEntries(data.entries ?? []);
          setMatchdayActivity(data.activity ?? null);
          setMatchdayLoaded(true);
        })
        .catch(() => {
          if (cancelled) return;
          setMatchdayEntries([]);
          setMatchdayActivity(null);
          setMatchdayLoaded(true);
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
      setMyRank(null);
      setMyRankLoaded(false);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      fetch(`${BACKEND_HTTP}/matchday-cup/rank/${address}`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('my rank')))
        .then((data: { entry?: MatchdayEntry }) => {
          if (cancelled) return;
          setMyRank(data.entry ?? null);
          setMyRankLoaded(true);
        })
        .catch(() => {
          if (cancelled) return;
          setMyRank(null);
          setMyRankLoaded(true);
        });
    };
    refresh();
    const timer = setInterval(refresh, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch(`${BACKEND_HTTP}/matchday-cup/country-support?limit=50`)
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

  const visibleMatchdayRows = matchdayEntries.slice(0, visibleMatchday);
  const visibleCountryRows = countrySupport.slice(0, visibleCountries);
  const activeRowsLoaded = activeBoard === 'matchday' ? matchdayLoaded : supportLoaded;
  const hasMoreRows = activeBoard === 'matchday'
    ? visibleMatchday < matchdayEntries.length
    : visibleCountries < countrySupport.length;
  const showMoreRows = () => {
    if (activeBoard === 'matchday') {
      setVisibleMatchday(count => Math.min(count + LEADERBOARD_BATCH_SIZE, matchdayEntries.length));
    } else {
      setVisibleCountries(count => Math.min(count + LEADERBOARD_BATCH_SIZE, countrySupport.length));
    }
  };

  return (
    <>
      <section
        className="fanvibe-live-panel rounded-lg border border-white/10 p-3 shadow-sm sm:p-4"
        style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}
      >
        <div className="relative z-10">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.14em] text-blue-100/95">
                <Trophy size={13} />
                Matchday leaderboard
              </div>
              <h3 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-white">
                Top fans chasing the $200 Matchday Cup.
              </h3>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-zinc-200/90">
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
        </div>
      </section>

      <section className="mt-4 overflow-hidden rounded-lg border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white shadow-sm">
        <div className="p-3 sm:p-4">
          {address && (
            <div className="mb-3 rounded-lg border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-900/45 bg-zinc-50 px-3 py-3">
              {myRankLoaded && myRank ? (() => {
                const volumeUsd = compactUsd(formatOkbUsdFromWei(myRank.volumeWei, okbUsd));
                const fvbStatus = myRank.fvbEligible === null || myRank.fvbEligible === undefined
                  ? 'FVB syncing'
                  : myRank.fvbEligible
                    ? `${formatFvbBalance(myRank.fvbEligibleWei)} FVB eligible`
                    : 'Needs FVB';
                const rankStatus = myRank.rank
                  ? fvbStatus
                  : myRank.fvbEligible === false && (myRank.score ?? 0) > 0
                    ? 'Activity recorded. Hold FVB to enter the ranked board.'
                    : fvbStatus;
                return (
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] dark:text-zinc-500 text-zinc-500">My Rank</div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-lg font-black tabular-nums dark:text-white text-zinc-950">
                          {myRank.rank ? `#${myRank.rank}` : 'Unranked'}
                        </span>
                        <span className="text-sm font-bold tabular-nums dark:text-zinc-300 text-zinc-700">
                          {formatScore(myRank.score)} pts
                        </span>
                        <span className="truncate text-xs font-semibold dark:text-zinc-500 text-zinc-500">
                          {shortWallet(myRank.address)}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] font-medium dark:text-zinc-400 text-zinc-500">
                        {rankStatus}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(myRank.scoreComponents
                          ? [
                              ['Volume', myRank.scoreComponents.volume],
                              ['Wins', myRank.scoreComponents.wins],
                              ['Live', myRank.scoreComponents.active],
                              ['Stakes', myRank.scoreComponents.participation],
                            ]
                          : [
                              ['Stakes', myRank.positions],
                            ]
                        ).map(([label, value]) => (
                          <span key={label} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-400 dark:ring-zinc-800">
                            {label} {formatScore(Number(value))}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-right sm:min-w-[260px]">
                      <div>
                        <div className="text-sm font-black tabular-nums dark:text-white text-zinc-950">{myRank.wins}</div>
                        <div className="text-[10px] font-bold uppercase tracking-wide dark:text-zinc-500 text-zinc-500">Wins</div>
                      </div>
                      <div>
                        <div className="text-sm font-black tabular-nums dark:text-white text-zinc-950">{myRank.active}</div>
                        <div className="text-[10px] font-bold uppercase tracking-wide dark:text-zinc-500 text-zinc-500">Live</div>
                      </div>
                      <div>
                        <div className="text-sm font-black tabular-nums dark:text-white text-zinc-950">{formatOkbVolume(myRank.volumeWei)}</div>
                        <div className="text-[10px] font-bold uppercase tracking-wide dark:text-zinc-500 text-zinc-500">{volumeUsd}</div>
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] dark:text-zinc-500 text-zinc-500">My Rank</div>
                    <div className="mt-1 text-sm font-semibold dark:text-zinc-300 text-zinc-700">
                      {myRankLoaded ? 'Rank unavailable right now.' : 'Loading your Matchday Cup rank...'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-md dark:bg-zinc-900 bg-zinc-100 p-0.5">
              <button
                type="button"
                onClick={() => setActiveBoard('matchday')}
                className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${activeBoard === 'matchday' ? 'dark:bg-white bg-zinc-950 dark:text-zinc-950 text-white' : 'dark:text-zinc-400 text-zinc-500 dark:hover:text-white hover:text-zinc-950'}`}
              >
                Matchday ranking
              </button>
              <button
                type="button"
                onClick={() => setActiveBoard('countries')}
                className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${activeBoard === 'countries' ? 'dark:bg-white bg-zinc-950 dark:text-zinc-950 text-white' : 'dark:text-zinc-400 text-zinc-500 dark:hover:text-white hover:text-zinc-950'}`}
              >
                Country backing
              </button>
            </div>
            <div className="text-[11px] font-semibold dark:text-zinc-500 text-zinc-500">
              {activeBoard === 'matchday'
                ? `${matchdayActivity?.eligibleFans ?? matchdayEntries.length} eligible fans ranked`
                : `${countrySupport.length} countries ranked`}
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border dark:border-zinc-900 border-zinc-200">
            {activeBoard === 'matchday' ? (
              visibleMatchdayRows.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm dark:text-zinc-400 text-zinc-500">
                  {activeRowsLoaded
                    ? matchdayActivity && matchdayActivity.totalFans > 0
                      ? `${matchdayActivity.totalFans} fan${matchdayActivity.totalFans === 1 ? '' : 's'} have match activity. Hold FVB with the same wallet to enter the ranked board.`
                      : 'The first real World Cup stake starts the Matchday Cup ranking.'
                    : 'Loading Matchday rankings...'}
                </div>
              ) : visibleMatchdayRows.map(entry => {
                const profileName = entry.displayName ?? getStoredProfileName(entry.address);
                const volumeUsd = compactUsd(formatOkbUsdFromWei(entry.volumeWei, okbUsd));
                const fvbStatus = entry.fvbEligible === null || entry.fvbEligible === undefined
                  ? 'FVB syncing'
                  : entry.fvbEligible
                    ? `${formatFvbBalance(entry.fvbEligibleWei)} FVB eligible`
                    : 'Needs FVB';
                return (
                  <a
                    key={entry.address}
                    href={explorerAddr(entry.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-3 border-b dark:border-zinc-900 border-zinc-200 px-3 py-3 text-sm last:border-b-0 transition-colors dark:hover:bg-white/[0.04] hover:bg-zinc-50"
                  >
                    <div className="grid h-7 w-7 place-items-center rounded dark:bg-white bg-zinc-950 text-xs font-black dark:text-zinc-950 text-white">{entry.rank}</div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold dark:text-white text-zinc-950">
                        {fanDisplayName(entry.address, profileName)}
                      </div>
                      <div className="mt-0.5 text-[11px] font-medium dark:text-zinc-400 text-zinc-500">
                        {shortWallet(entry.address)} - {fvbStatus}
                      </div>
                      <div className="mt-1 truncate text-[10px] font-medium dark:text-zinc-500 text-zinc-500">
                        {scoreBreakdown(entry)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold tabular-nums dark:text-white text-zinc-950">
                        {formatScore(entry.score)} pts
                      </div>
                      <div className="mt-0.5 text-[10px] font-medium text-zinc-500">
                        {entry.wins}W / {entry.active} live - {formatOkbVolume(entry.volumeWei)} OKB
                      </div>
                      <div className="mt-0.5 text-[10px] font-medium text-zinc-500">{volumeUsd}</div>
                    </div>
                  </a>
                );
              })
            ) : visibleCountryRows.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm dark:text-zinc-400 text-zinc-500">
                {activeRowsLoaded ? 'Country backing appears after fans stake home or away on real World Cup matches.' : 'Loading country backing...'}
              </div>
            ) : visibleCountryRows.map(entry => {
              const volumeUsd = compactUsd(formatOkbUsdFromWei(entry.volumeWei, okbUsd));
              const flag = flagUrl(entry.iso);
              return (
                <div key={entry.code} className="grid min-w-0 grid-cols-[auto_auto_1fr_auto] items-center gap-3 border-b dark:border-zinc-900 border-zinc-200 px-3 py-3 last:border-b-0">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded dark:bg-white bg-zinc-950 text-xs font-black dark:text-zinc-950 text-white">
                    {entry.rank}
                  </div>
                  {flag ? (
                    <img src={flag} alt="" className="h-7 w-10 shrink-0 rounded object-cover ring-1 ring-white/15" />
                  ) : (
                    <div className="h-7 w-10 shrink-0 rounded bg-white/10" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold dark:text-white text-zinc-950">{entry.name}</div>
                    <div className="mt-0.5 text-[11px] font-medium dark:text-zinc-400 text-zinc-500">
                      {entry.supporters} fans - {entry.positions} stakes
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs font-bold tabular-nums dark:text-white text-zinc-950">
                    {volumeUsd}
                  </div>
                </div>
              );
            })}
          </div>
          {hasMoreRows && (
            <button
              type="button"
              onClick={showMoreRows}
              className="mt-3 w-full rounded-md border dark:border-zinc-900 border-zinc-200 px-3 py-2 text-xs font-bold dark:text-zinc-300 text-zinc-600 transition-colors hover:border-blue-300/50 dark:hover:text-blue-100 hover:text-zinc-950"
            >
              Show 20 more
            </button>
          )}
        </div>
      </section>
    </>
  );
}
