import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { formatUnits, parseAbiItem, zeroAddress } from 'viem';
import { formatOkbUsdFromWei } from '../lib/useOkbUsdPrice';
import { fanDisplayName, getStoredProfileName, shortWallet } from '../lib/fanProfile';
import { xLayerPublicClient } from '../lib/publicClient';
import { FANVIBE_TOKEN_ADDRESS } from '../lib/fanvibeToken';
import { explorerAddr } from '../lib/chain';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const FANVIBE_SEASON_BG = '/assets/fanvibe-season-bg.jpeg';
const FVB_TRANSFER_FROM_BLOCK = 62_489_600n;
const HOLDER_ELIGIBILITY_CAP_WEI = 450_000n * 10n ** 18n;
const LEADERBOARD_BATCH_SIZE = 20;
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

interface HolderEntry {
  rank: number;
  address: string;
  balanceWei: bigint;
  eligibleWei: bigint;
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
  const [activeBoard, setActiveBoard] = useState<'holders' | 'countries'>('holders');
  const [holders, setHolders] = useState<HolderEntry[]>([]);
  const [countrySupport, setCountrySupport] = useState<CountrySupportEntry[]>([]);
  const [holdersLoaded, setHoldersLoaded] = useState(false);
  const [supportLoaded, setSupportLoaded] = useState(false);
  const [visibleHolders, setVisibleHolders] = useState(LEADERBOARD_BATCH_SIZE);
  const [visibleCountries, setVisibleCountries] = useState(LEADERBOARD_BATCH_SIZE);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const logs = await xLayerPublicClient.getLogs({
          address: FANVIBE_TOKEN_ADDRESS as `0x${string}`,
          event: TRANSFER_EVENT,
          fromBlock: FVB_TRANSFER_FROM_BLOCK,
          toBlock: 'latest',
        });
        if (cancelled) return;

        const candidates = new Set<string>();
        logs.forEach(log => {
          const from = log.args.from?.toLowerCase();
          const to = log.args.to?.toLowerCase();
          if (from && from !== zeroAddress) candidates.add(from);
          if (to && to !== zeroAddress) candidates.add(to);
        });

        const balances = await Promise.all(
          Array.from(candidates).map(async candidate => {
            const balance = await xLayerPublicClient.readContract({
              address: FANVIBE_TOKEN_ADDRESS as `0x${string}`,
              abi: ERC20_BALANCE_ABI,
              functionName: 'balanceOf',
              args: [candidate as `0x${string}`],
            });
            return { address: candidate, balance };
          }),
        );
        if (cancelled) return;

        const ranked = balances
          .filter(item => item.balance > 0n)
          .sort((a, b) => a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1)
          .slice(0, 50)
          .map((item, index) => ({
            rank: index + 1,
            address: item.address,
            balanceWei: item.balance,
            eligibleWei: item.balance > HOLDER_ELIGIBILITY_CAP_WEI ? HOLDER_ELIGIBILITY_CAP_WEI : item.balance,
          }));
        setHolders(ranked);
        setHoldersLoaded(true);
      } catch {
        if (cancelled) return;
        setHolders([]);
        setHoldersLoaded(true);
      }
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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

  const visibleHolderRows = holders.slice(0, visibleHolders);
  const visibleCountryRows = countrySupport.slice(0, visibleCountries);
  const activeRowsLoaded = activeBoard === 'holders' ? holdersLoaded : supportLoaded;
  const hasMoreRows = activeBoard === 'holders'
    ? visibleHolders < holders.length
    : visibleCountries < countrySupport.length;
  const showMoreRows = () => {
    if (activeBoard === 'holders') {
      setVisibleHolders(count => Math.min(count + LEADERBOARD_BATCH_SIZE, holders.length));
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-md dark:bg-zinc-900 bg-zinc-100 p-0.5">
              <button
                type="button"
                onClick={() => setActiveBoard('holders')}
                className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${activeBoard === 'holders' ? 'dark:bg-white bg-zinc-950 dark:text-zinc-950 text-white' : 'dark:text-zinc-400 text-zinc-500 dark:hover:text-white hover:text-zinc-950'}`}
              >
                Top FVB holders
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
              {activeBoard === 'holders' ? `${holders.length} holders indexed` : `${countrySupport.length} countries ranked`}
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border dark:border-zinc-900 border-zinc-200">
            {activeBoard === 'holders' ? (
              visibleHolderRows.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm dark:text-zinc-400 text-zinc-500">
                  {activeRowsLoaded ? 'FVB holder rankings appear after token transfers are indexed.' : 'Loading FVB holders...'}
                </div>
              ) : visibleHolderRows.map(entry => {
                const profileName = getStoredProfileName(entry.address);
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
                        {shortWallet(entry.address)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold tabular-nums dark:text-white text-zinc-950">{compactTokenBalance(entry.eligibleWei)} FVB</div>
                      <div className="mt-0.5 text-[10px] font-medium text-zinc-500">{compactTokenBalance(entry.balanceWei)} held</div>
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
