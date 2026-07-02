import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatEther } from 'viem';
import { BookOpen, BriefcaseBusiness, ChevronDown, ChevronUp, ExternalLink, Globe, Home, Link2, Newspaper, Radio, Search, Trophy, X } from 'lucide-react';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { FixtureCard } from './components/FixtureCard';
import { LogStream } from './components/LogStream';
import { MyPositions } from './components/MyPositions';
import { MatchViewer } from './components/MatchViewer';
import { GroupTable } from './components/GroupTable';
import { MatchdayCupLeaderboard } from './components/MatchdayCupLeaderboard';
import { FvbTradeSafety } from './components/FvbTradeSafety';
import { BracketView } from './components/BracketView';
import { ChampionPick } from './components/ChampionPick';
import type { ChampionPool, DaemonLog, DaemonState, Fixture, MatchState, MetabolicState, Outcome, Pool, SettlementResult, UserPosition } from './types';
import { explorerAddr, explorerTx } from './lib/chain';
import { xLayerPublicClient } from './lib/publicClient';
import { shortAddr } from './lib/encode';
import { captureReferralFromUrl } from './lib/accountData';
import { flushPendingStakeReports } from './lib/stakeReport';
import { FANVIBE_TOKEN_ADDRESS, FANVIBE_TOKEN_LOGO } from './lib/fanvibeToken';
import { fetchFvbMarketPriceWei } from './lib/fvbPrice';
import { formatOkbUsdFromWei, useOkbUsdPrice } from './lib/useOkbUsdPrice';

const BACKEND_WS = import.meta.env.VITE_BACKEND_WS ?? 'ws://localhost:3001';
const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const REFEREE_ADDR = (import.meta.env.VITE_REFEREE_ADDRESS ?? '') as string;
const FANVIBE_SEASON_BG = '/assets/fanvibe-season-bg.jpeg';
const BRAND_E_IMAGE = '/assets/brand-e.png';
const LAST_WALLET_KEY = 'fanvibe.lastWalletAddress';
const ACTIVE_TAB_KEY = 'fanvibe.activeTab';
const FVB_VALUE_REFRESH_MS = 30_000;
const WORLD_CUP_FEED_REFRESH_MS = 120_000;
const WATCHED_MATCH_REFRESH_MS = 60_000;
const OFFLINE_RESERVE_REFRESH_MS = 60_000;
const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const KNOCKOUT_FILTERS = ['R32', 'R16', 'QF', 'SF', '3PL', 'F'];
const ERC20_BALANCE_ABI = [{
  type: 'function',
  name: 'balanceOf',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

const WorldCupNews = lazy(() => import('./components/WorldCupNews').then(module => ({ default: module.WorldCupNews })));
const rpcClient = xLayerPublicClient;

type AppTab = 'home' | 'search' | 'news' | 'portfolio';
type HomeView = 'matches' | 'leaderboard';

interface WorldCupFeed {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  source: 'sportmonks' | 'wc2026api' | 'balldontlie' | 'zafronix' | 'static';
  mode: 'live' | 'fallback';
  updatedAt: number;
  freshnessSeconds: number;
  providerConfigured: boolean;
  error?: string;
}

function defaultMetabolism(): MetabolicState {
  return { okbBalance: '0', okbBalanceFormatted: '0.000000', healthPercent: 0, isRefuelNeeded: false, checkedAt: Date.now() };
}

function readActiveTab(): AppTab {
  try {
    const tab = window.localStorage.getItem(ACTIVE_TAB_KEY);
    return tab === 'home' || tab === 'search' || tab === 'news' || tab === 'portfolio' ? tab : 'home';
  } catch {
    return 'home';
  }
}

function getRememberedWalletAddress(): string | null {
  try {
    return window.localStorage.getItem(LAST_WALLET_KEY);
  } catch {
    return null;
  }
}

function parseProviderTime(value: string): number {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return Date.parse(normalized);
}

function flagUrl(iso: string): string {
  return iso === 'un' || iso === 'tbd' ? '' : `https://flagcdn.com/w640/${iso.toLowerCase()}.png`;
}

function stripUsdPrefix(value: string | null): string | null {
  return value ? value.replace(/^US/, '') : null;
}

function formatOKBWei(wei: bigint | string | number): string {
  try {
    const value = typeof wei === 'bigint' ? wei : BigInt(wei);
    const formatted = Number(formatEther(value));
    return `${formatted.toFixed(formatted >= 10 ? 2 : 4)} OKB`;
  } catch {
    return '0 OKB';
  }
}

function explorerBlock(blockNumber: number): string {
  return `https://www.okx.com/web3/explorer/xlayer/block/${blockNumber}`;
}

function positionPortfolioWei(position: UserPosition, fixtures: Fixture[], matchStates: Record<string, MatchState>): bigint {
  try {
    if (position.type === 'refund') return position.status === 'queued' ? BigInt(position.refund.amountWei) : 0n;
    if (position.type === 'champion') {
      if (position.status === 'active') return BigInt(position.stake.amountWei);
      if (position.status === 'settled_winner' && !position.payout) return BigInt(position.stake.amountWei);
      return 0n;
    }

    const stakeWei = BigInt(position.stake.amountWei);
    const liveFixture = fixtures.find(fixture => fixture.id === position.stake.fixtureId) ?? position.fixture;
    const liveState = liveFixture ? matchStates[liveFixture.id] : undefined;
    if (liveState?.status === 'live' || liveState?.status === 'half_time') return stakeWei;
    if (liveFixture?.status === 'settled' && liveFixture.result) {
      return liveFixture.result === position.stake.outcome && position.status !== 'paid'
        ? BigInt(position.payout?.amountWei ?? position.stake.amountWei)
        : 0n;
    }
    if (position.status === 'active' || position.status === 'won_pending_payout') {
      return BigInt(position.payout?.amountWei ?? position.stake.amountWei);
    }
    return 0n;
  } catch {
    return 0n;
  }
}

async function fvbPortfolioValueWei(address: string): Promise<bigint> {
  try {
    const balance = await rpcClient.readContract({
      address: FANVIBE_TOKEN_ADDRESS as `0x${string}`,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    if (balance <= 0n) return 0n;
    const priceWei = await fetchFvbMarketPriceWei();
    if (!priceWei) return 0n;
    return (balance * priceWei) / 10n ** 18n;
  } catch {
    return 0n;
  }
}

function fixtureRank(fixture: Fixture, matchStates: Record<string, MatchState>): number {
  const state = matchStates[fixture.id];
  if (state?.status === 'live' || state?.status === 'half_time' || fixture.status === 'locked') return 0;
  if (state?.status === 'finished' || fixture.status === 'settled') return 2;
  return 1;
}

function fixtureTime(fixture: Fixture, matchStates: Record<string, MatchState>): number {
  const state = matchStates[fixture.id];
  const raw = state?.status === 'finished' && state.finishedAt ? state.finishedAt : parseProviderTime(fixture.kickoff);
  return Number.isFinite(raw) ? raw : 0;
}

export default function App() {
  const okbUsd = useOkbUsdPrice();
  const [accountValueLabel, setAccountValueLabel] = useState('$0.00');
  const [dark, setDark] = useState(() => {
    const saved = window.localStorage.getItem('fanvibe-theme');
    if (saved === 'light') return false;
    if (saved === 'dark') return true;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  });
  const [engineOnline, setEngineOnline] = useState(false);
  const [refereeAddress, setRefereeAddress] = useState(REFEREE_ADDR);
  const [metabolism, setMetabolism] = useState<MetabolicState>(defaultMetabolism);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [worldCupFeed, setWorldCupFeed] = useState<WorldCupFeed | null>(null);
  const [pools, setPools] = useState<Record<string, Pool>>({});
  const [championPool, setChampionPool] = useState<ChampionPool | undefined>(undefined);
  const [logs, setLogs] = useState<DaemonLog[]>([]);
  const [lastBlock, setLastBlock] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [settlements, setSettlements] = useState<SettlementResult[]>([]);
  const [stakeClosedNotices, setStakeClosedNotices] = useState<Record<string, string>>({});
  const [logOpen, setLogOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState('live');
  const [searchQuery, setSearchQuery] = useState('');
  const [matchStates, setMatchStates] = useState<Record<string, MatchState>>({});
  const [watchingFixtureId, setWatchingId] = useState<string | null>(null);
  const [homeCupView, setHomeCupView] = useState<HomeView>('matches');
  const [activeTab, setActiveTab] = useState<AppTab>(() => readActiveTab());
  const [focusedFixtureId, setFocusedFixtureId] = useState<string | null>(null);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [capturedReferrer, setCapturedReferrer] = useState<string | null>(null);
  const [settlementWalletAddress, setSettlementWalletAddress] = useState<string | null>(() => getRememberedWalletAddress());
  const watchedStateRef = useRef<Record<string, MatchState>>({});
  const watchedFixtureRef = useRef<Record<string, Fixture>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    window.localStorage.setItem('fanvibe-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
    } catch {
      /* best-effort tab memory */
    }
  }, [activeTab]);

  useEffect(() => {
    captureReferralFromUrl();
    flushPendingStakeReports().catch(() => {});
    const timer = window.setInterval(() => flushPendingStakeReports().catch(() => {}), 60_000);
    const params = new URLSearchParams(window.location.search);
    const matchId = params.get('match');
    const ref = params.get('ref');
    if (matchId) {
      setFocusedFixtureId(matchId);
      setActiveTab('home');
      setHomeCupView('matches');
      setGroupFilter('live');
    }
    if (ref && /^0x[0-9a-fA-F]{40}$/.test(ref)) {
      setInviteVisible(true);
      setCapturedReferrer(ref);
    }
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshWallet = () => setSettlementWalletAddress(getRememberedWalletAddress());
    refreshWallet();
    const timer = window.setInterval(refreshWallet, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const applyDaemonState = useCallback((state: DaemonState) => {
    setRefereeAddress(state.refereeAddress || REFEREE_ADDR);
    setMetabolism(state.metabolism);
    setPools(state.pools);
    setChampionPool(state.championPool);
    setLogs(state.recentLogs);
    setLastBlock(state.lastBlock);
    setWsConnected(state.wsConnected);
    setSettlements(state.settlements);
    setMatchStates(prev => ({ ...prev, ...state.matchStates }));
    if (state.fixtures?.length) {
      setFixtures(prev => prev.length ? prev : state.fixtures);
    }
  }, []);

  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(BACKEND_WS);
    wsRef.current = ws;
    ws.onopen = () => {
      setEngineOnline(true);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as { type: string; data: unknown };
        if (msg.type === 'state') applyDaemonState(msg.data as DaemonState);
        if (msg.type === 'log') setLogs(prev => [...prev.slice(-199), msg.data as DaemonLog]);
        if (msg.type === 'settlement') {
          const settlement = msg.data as SettlementResult;
          setSettlements(prev => [...prev, settlement]);
          setFixtures(prev => prev.map(fixture => fixture.id === settlement.fixtureId ? { ...fixture, status: 'settled', result: settlement.outcome } : fixture));
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      setEngineOnline(false);
      reconnectRef.current = setTimeout(connectWS, 5000);
    };
    ws.onerror = () => ws.close();
  }, [applyDaemonState]);

  useEffect(() => {
    connectWS();
    fetch(`${BACKEND_HTTP}/state`)
      .then(response => response.json())
      .then((state: DaemonState) => {
        setEngineOnline(true);
        applyDaemonState(state);
      })
      .catch(() => {});
    return () => {
      wsRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [applyDaemonState, connectWS]);

  useEffect(() => {
    const loadWorldCupFeed = () => {
      fetch(`${BACKEND_HTTP}/worldcup/feed`)
        .then(response => response.json())
        .then((feed: WorldCupFeed) => {
          const nextFixtures = Array.isArray(feed.fixtures) ? feed.fixtures : [];
          setFixtures(nextFixtures);
          setMatchStates(prev => ({ ...prev, ...(feed.matchStates ?? {}) }));
          setWorldCupFeed(feed);
        })
        .catch(() => {
          setWorldCupFeed({
            fixtures: [],
            matchStates: {},
            source: 'static',
            mode: 'fallback',
            updatedAt: Date.now(),
            freshnessSeconds: 0,
            providerConfigured: false,
            error: 'World Cup feed unavailable',
          });
        });
    };
    loadWorldCupFeed();
    const timer = window.setInterval(loadWorldCupFeed, WORLD_CUP_FEED_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (engineOnline || !refereeAddress) return;
    const fetchBalance = async () => {
      try {
        const balance = await rpcClient.getBalance({ address: refereeAddress as `0x${string}` });
        setMetabolism(prev => ({
          ...prev,
          okbBalance: balance.toString(),
          okbBalanceFormatted: Number(formatEther(balance)).toFixed(6),
          healthPercent: Math.min(100, Number((balance * 100n) / BigInt(5e17))),
          isRefuelNeeded: balance < BigInt(3e15),
          checkedAt: Date.now(),
        }));
      } catch {
        /* keep last known reserve state */
      }
    };
    fetchBalance();
    const timer = window.setInterval(fetchBalance, OFFLINE_RESERVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [engineOnline, refereeAddress]);

  useEffect(() => {
    let cancelled = false;
    const refreshAccountValue = async () => {
      const address = getRememberedWalletAddress();
      if (!address) {
        setAccountValueLabel('$0.00');
        return;
      }
      try {
        const [balanceWei, positionsResponse, fvbValueWei] = await Promise.all([
          rpcClient.getBalance({ address: address as `0x${string}` }),
          fetch(`${BACKEND_HTTP}/positions/${address}`),
          fvbPortfolioValueWei(address),
        ]);
        if (!positionsResponse.ok) throw new Error(`positions ${positionsResponse.status}`);
        const data = await positionsResponse.json() as { positions?: UserPosition[] };
        const openExposureWei = (data.positions ?? []).reduce((sum, position) => sum + positionPortfolioWei(position, fixtures, matchStates), 0n);
        if (!cancelled) setAccountValueLabel(stripUsdPrefix(formatOkbUsdFromWei(balanceWei + openExposureWei + fvbValueWei, okbUsd)) ?? '$0.00');
      } catch {
        if (!cancelled) setAccountValueLabel(prev => prev || '$0.00');
      }
    };
    refreshAccountValue();
    const timer = window.setInterval(refreshAccountValue, FVB_VALUE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fixtures, matchStates, okbUsd]);

  useEffect(() => {
    if (!focusedFixtureId || !fixtures.some(fixture => fixture.id === focusedFixtureId)) return;
    const targetId = focusedFixtureId;
    const timer = window.setTimeout(() => {
      const node = document.querySelector(`[data-fixture-id="${targetId}"]`);
      if (node instanceof HTMLElement) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFocusedFixtureId(null);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [fixtures, focusedFixtureId]);

  useEffect(() => {
    watchedStateRef.current = { ...watchedStateRef.current, ...matchStates };
  }, [matchStates]);

  const showStakeClosedNotice = useCallback((fixtureId: string, reason?: string) => {
    setStakeClosedNotices(prev => ({ ...prev, [fixtureId]: reason ?? 'Stake on the next available match.' }));
    window.setTimeout(() => {
      setStakeClosedNotices(prev => {
        const next = { ...prev };
        delete next[fixtureId];
        return next;
      });
    }, 5200);
  }, []);

  const handleStake = useCallback((fixtureId: string, outcome: Outcome) => {
    const fixture = fixtures.find(item => item.id === fixtureId);
    const matchState = matchStates[fixtureId];
    if (!fixture) return false;
    if (fixture.status === 'settled') {
      showStakeClosedNotice(fixtureId, 'This match has already settled.');
      return false;
    }
    if (matchState?.status === 'finished') {
      showStakeClosedNotice(fixtureId, 'This match has finished.');
      return false;
    }
    void outcome;
    return true;
  }, [fixtures, matchStates, showStakeClosedNotice]);

  const handleWatch = useCallback((fixtureId: string) => {
    setWatchingId(fixtureId);
    setActiveTab('home');
    setHomeCupView('matches');
    const url = new URL(window.location.href);
    url.searchParams.set('match', fixtureId);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    fetch(`${BACKEND_HTTP}/worldcup/match/${encodeURIComponent(fixtureId)}`)
      .then(response => response.ok ? response.json() : null)
      .then((result: { fixture?: Fixture; matchState?: MatchState | null } | null) => {
        if (!result) return;
        if (result.fixture) {
          watchedFixtureRef.current[fixtureId] = result.fixture;
          setFixtures(prev => prev.map(item => item.id === result.fixture!.id ? result.fixture! : item));
        }
        if (result.matchState) {
          watchedStateRef.current[fixtureId] = result.matchState;
          setMatchStates(prev => ({ ...prev, [fixtureId]: result.matchState! }));
        }
      })
      .catch(() => {});
  }, []);

  const openMatchdayLeaderboard = useCallback(() => {
    setActiveTab('home');
    setHomeCupView('leaderboard');
    const url = new URL(window.location.href);
    url.searchParams.delete('match');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const watchingFixture = watchingFixtureId
    ? fixtures.find(fixture => fixture.id === watchingFixtureId) ?? watchedFixtureRef.current[watchingFixtureId] ?? null
    : null;
  const watchingMatchState = watchingFixtureId
    ? matchStates[watchingFixtureId] ?? watchedStateRef.current[watchingFixtureId] ?? null
    : null;

  useEffect(() => {
    if (!watchingFixtureId || !watchingFixture) return;
    watchedFixtureRef.current[watchingFixtureId] = watchingFixture;
  }, [watchingFixture, watchingFixtureId]);

  useEffect(() => {
    if (!watchingFixtureId) return;
    let cancelled = false;
    const loadWatchedMatch = () => {
      fetch(`${BACKEND_HTTP}/worldcup/match/${encodeURIComponent(watchingFixtureId)}`)
        .then(response => response.ok ? response.json() : null)
        .then((result: { fixture?: Fixture; matchState?: MatchState | null } | null) => {
          if (cancelled || !result) return;
          if (result.fixture) {
            watchedFixtureRef.current[watchingFixtureId] = result.fixture;
            setFixtures(prev => prev.map(item => item.id === result.fixture!.id ? result.fixture! : item));
          }
          if (result.matchState) {
            watchedStateRef.current[watchingFixtureId] = result.matchState;
            setMatchStates(prev => ({ ...prev, [watchingFixtureId]: result.matchState! }));
          }
        })
        .catch(() => {});
    };
    loadWatchedMatch();
    const timer = window.setInterval(loadWatchedMatch, WATCHED_MATCH_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [watchingFixtureId]);

  const worldCupFeedReady = fixtures.length > 0 && worldCupFeed?.providerConfigured !== false;
  const worldCupLiveDataActive = worldCupFeed?.mode === 'live';
  const worldCupSourceLabel = worldCupFeed?.source ? worldCupFeed.source.toUpperCase() : 'SYNC';
  const worldCupFreshness = worldCupFeed
    ? worldCupFeed.mode === 'live'
      ? `updated ${Math.max(0, Math.round((Date.now() - worldCupFeed.updatedAt) / 1000))}s ago`
      : 'fallback feed'
    : 'loading feed';
  const realtimeTabs = useMemo(() => {
    const rtGroups = Array.from(new Set(fixtures.filter(fixture => !fixture.round).map(fixture => fixture.group))).sort();
    return [
      { id: 'live', label: 'Live', tone: 'live' },
      ...rtGroups.map(group => ({ id: group, label: group, tone: 'group' })),
      { id: 'knockouts', label: 'Knockouts', tone: 'knockout' },
      ...KNOCKOUT_FILTERS.map(round => ({ id: round, label: round === '3PL' ? '3rd' : round, tone: 'knockout' })),
      { id: 'bracket', label: 'Bracket', tone: 'bracket' },
    ];
  }, [fixtures]);

  const currentFixtures = useMemo(() => {
    const resolved = fixtures.filter(fixture => fixture.home.code !== 'TBD' && fixture.away.code !== 'TBD');
    if (groupFilter === 'live') {
      return [...resolved].sort((a, b) => {
        const rankDiff = fixtureRank(a, matchStates) - fixtureRank(b, matchStates);
        if (rankDiff !== 0) return rankDiff;
        return fixtureTime(a, matchStates) - fixtureTime(b, matchStates);
      });
    }
    if (GROUPS.includes(groupFilter)) return resolved.filter(fixture => fixture.group === groupFilter && !fixture.round);
    if (groupFilter === 'knockouts') return resolved.filter(fixture => !!fixture.round);
    if (KNOCKOUT_FILTERS.includes(groupFilter)) return resolved.filter(fixture => fixture.round === groupFilter);
    if (groupFilter === 'bracket') return [];
    return resolved;
  }, [fixtures, groupFilter, matchStates]);

  const visibleFixtures = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return currentFixtures;
    return currentFixtures.filter(fixture => [
      fixture.home.name,
      fixture.home.code,
      fixture.away.name,
      fixture.away.code,
      fixture.group,
      fixture.round ?? '',
      fixture.venue,
    ].some(value => value.toLowerCase().includes(query)));
  }, [currentFixtures, searchQuery]);

  const worldCupLiveEntries = worldCupLiveDataActive
    ? Object.entries(matchStates).filter(([, state]) => state.status === 'live' || state.status === 'half_time')
    : [];
  const selectedGroupFixtures = GROUPS.includes(groupFilter) ? fixtures.filter(fixture => fixture.group === groupFilter && !fixture.round) : [];
  const selectedGroupResults = selectedGroupFixtures.filter(fixture => matchStates[fixture.id]?.status === 'finished');
  const matchdayPrizeTeams = fixtures.slice(0, 4).map(fixture => fixture.home).filter(team => team.iso !== 'tbd');
  const reserveUsd = formatOkbUsdFromWei(metabolism.okbBalance, okbUsd);
  const healthColor = metabolism.isRefuelNeeded
    ? 'dark:text-red-400 text-red-600'
    : metabolism.healthPercent < 40
      ? 'dark:text-blue-300 text-blue-600'
      : 'dark:text-emerald-400 text-emerald-600';
  const proofPlatformVolumeWei = Object.values(pools).reduce((sum, pool) => sum + BigInt(pool.home) + BigInt(pool.draw) + BigInt(pool.away), 0n);
  const proofPoolUsd = formatOkbUsdFromWei(proofPlatformVolumeWei, okbUsd);
  const payoutSettlementCount = settlements.reduce((sum, settlement) => sum + settlement.payouts.filter(payout => payout.txHash).length, 0);
  const proofStakeTxs = logs.filter(log => log.txHash && /stake/i.test(log.message)).slice(-8).reverse();
  const proofPayoutTxs = settlements.flatMap(settlement => settlement.payouts
    .filter(payout => payout.txHash)
    .map(payout => ({ ...payout, fixtureId: settlement.fixtureId })))
    .slice(-8)
    .reverse();

  const tabs: Array<{ id: AppTab; label: string; icon: typeof Home }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'news', label: 'News', icon: Newspaper },
    { id: 'portfolio', label: 'Portfolio', icon: BriefcaseBusiness },
  ];

  return (
    <div className="min-h-screen dark:bg-black bg-zinc-50 dark:text-white text-zinc-900">
      <header className="sticky top-0 z-40 border-b dark:border-zinc-900 border-zinc-200 dark:bg-black/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:pl-28">
          <button type="button" onClick={() => { setActiveTab('home'); setHomeCupView('matches'); }} className="flex min-w-0 items-center gap-2 text-left">
            <img src={BRAND_E_IMAGE} alt="" className="h-8 w-8 rounded-lg object-cover" />
            <div className="min-w-0">
              <div className="truncate text-sm font-black tracking-tight">FanVibe</div>
              <div className="truncate text-[11px] font-semibold dark:text-zinc-500 text-zinc-500">{accountValueLabel} account view</div>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <div className={`hidden rounded-full px-2.5 py-1 text-[11px] font-bold sm:block ${wsConnected || engineOnline ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-zinc-500/10 text-zinc-500'}`}>
              {wsConnected || engineOnline ? 'Live' : 'Syncing'}
            </div>
            <ThemeSwitcher dark={dark} onToggle={() => setDark(value => !value)} />
          </div>
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 right-0 z-50 border-t dark:border-zinc-900 border-zinc-200 dark:bg-black/95 bg-white/95 lg:bottom-auto lg:right-auto lg:top-0 lg:h-screen lg:w-24 lg:border-r lg:border-t-0">
        <div className="grid grid-cols-5 gap-1 px-2 py-2 lg:flex lg:h-full lg:flex-col lg:px-3 lg:pt-20">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-[11px] font-bold transition-colors ${
                  selected
                    ? 'dark:bg-blue-500/15 bg-blue-50 dark:text-blue-300 text-blue-700'
                    : 'dark:text-zinc-500 text-zinc-500 dark:hover:bg-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-200 hover:text-zinc-900'
                }`}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
          <a href="/docs" title="Docs" className="flex w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-[11px] font-bold transition-colors dark:text-zinc-500 text-zinc-500 dark:hover:bg-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-200 hover:text-zinc-900">
            <BookOpen size={18} />
            <span>Docs</span>
          </a>
        </div>
      </aside>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 pb-24 sm:px-6 lg:pl-28">
        {(activeTab === 'home' || activeTab === 'search') && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-1 rounded-xl border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-900 bg-zinc-100 p-1 shadow-sm">
              <button
                type="button"
                onClick={() => { setHomeCupView('matches'); setActiveTab('home'); }}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${homeCupView === 'matches' ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200 shadow-sm' : 'dark:text-zinc-400 text-zinc-500'}`}
              >
                <Globe size={14} />
                World Cup Matches
              </button>
              <button
                type="button"
                onClick={() => { setHomeCupView('leaderboard'); setActiveTab('home'); }}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${homeCupView === 'leaderboard' ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200 shadow-sm' : 'dark:text-zinc-400 text-zinc-500'}`}
              >
                <Trophy size={14} />
                Distribution Cup
              </button>
            </div>
            <div className="hidden items-center gap-2 rounded-full border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950 bg-white px-3 py-1.5 shadow-sm sm:flex">
              <span className="text-[11px] font-bold dark:text-white text-zinc-950">{homeCupView === 'leaderboard' ? 'Distribution Cup' : 'World Cup Matches'}</span>
              <span className="text-[11px] font-semibold dark:text-zinc-400 text-zinc-500">{worldCupSourceLabel} - {worldCupFreshness}</span>
            </div>
          </div>
        )}

        {activeTab === 'home' && homeCupView === 'matches' && (
          <section className="fanvibe-live-panel rounded-lg border border-white/10 p-3 shadow-sm sm:p-4" style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}>
            <div className="relative z-10 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.14em] text-blue-100/95">
                  <Trophy size={15} />
                  Distribution Cup
                  <span className="rounded-full border border-emerald-300/40 bg-emerald-400/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-100">Graduated to v4</span>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-5 text-zinc-200/90">
                  Trade $FVB with OKX Wallet, connect X, then climb Distribution Cup as World Cup fixtures unfold.
                </p>
                <FvbTradeSafety compact showTradeLink className="mt-2 max-w-2xl" />
                <div className="mt-2 inline-flex items-baseline gap-1.5 text-white">
                  <span className="text-2xl font-semibold leading-none">$40</span>
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-zinc-300">Each for Top 5</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="matchday-prize-orb" aria-hidden="true">
                    <img src={FANVIBE_TOKEN_LOGO} alt="" className="matchday-prize-ball" />
                    <div className="matchday-prize-flags">
                      {matchdayPrizeTeams.map(team => flagUrl(team.iso) ? <img key={team.code} src={flagUrl(team.iso)} alt="" /> : null)}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-zinc-300">
                    <div><span>Top 1-5</span><span className="ml-1 text-xs font-bold text-white">$40 each</span></div>
                    <div><span>Top 1-3</span><span className="ml-1 text-xs font-bold text-white">+ 0.5% FVB supply share</span></div>
                    <div><span>Entry</span><span className="ml-1 text-xs font-bold text-white">$250+ FVB volume + X</span></div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'home' && homeCupView === 'matches' && (
          <div className="flex items-center gap-2 overflow-x-auto rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/80 bg-white p-1.5 shadow-sm scrollbar-none">
            {realtimeTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setGroupFilter(tab.id)}
                className={`season-filter-tab shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${
                  groupFilter === tab.id
                    ? tab.tone === 'live'
                      ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200 shadow-sm'
                      : tab.tone === 'group'
                        ? 'dark:bg-blue-500 bg-blue-600 text-white shadow-sm'
                        : 'bg-rose-600 text-white shadow-sm'
                    : 'dark:text-zinc-400 text-zinc-500 border dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-300 dark:bg-zinc-900/35 bg-zinc-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'home' && homeCupView === 'matches' && worldCupFeedReady && (
          <ChampionPick
            key="realtime-world-cup-champion"
            fixtures={fixtures}
            matchStates={matchStates}
            eliminatedTeams={new Set()}
            refereeAddress={refereeAddress}
            daemonChampPool={championPool}
          />
        )}

        {activeTab === 'home' && homeCupView === 'leaderboard' && (
          <MatchdayCupLeaderboard okbUsd={okbUsd} address={settlementWalletAddress} onOpenWorldCup={() => setHomeCupView('matches')} />
        )}

        {activeTab === 'home' && homeCupView === 'matches' && worldCupLiveEntries.length > 0 && (
          <div className="fanvibe-live-panel rounded-lg border border-white/10 p-3 shadow-sm" style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}>
            <div className="relative z-10 flex items-center justify-between gap-3 pb-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-extrabold tracking-[0.18em] text-blue-100/90"><Radio size={12} />LIVE MATCH STRIP</div>
                <div className="mt-0.5 text-sm font-semibold text-white">{worldCupLiveEntries.length} live World Cup {worldCupLiveEntries.length === 1 ? 'match' : 'matches'}</div>
              </div>
              <div className="rounded-md border border-white/10 bg-black/35 px-3 py-1.5 text-right backdrop-blur-[2px]">
                <div className="text-[10px] font-bold uppercase text-zinc-300">Feed</div>
                <div className="text-xs font-semibold text-white">{worldCupFreshness}</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'search' && (
          <div className="flex flex-col gap-3 rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/80 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <label className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 dark:text-zinc-600 text-zinc-400" />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search teams, groups, venues, or match codes"
                className="h-10 w-full rounded-lg border dark:border-zinc-800 border-zinc-200 dark:bg-black bg-zinc-50 pl-9 pr-3 text-sm font-medium outline-none placeholder:dark:text-zinc-700 placeholder:text-zinc-400 dark:text-zinc-100 text-zinc-900"
              />
            </label>
            <div className="flex items-center gap-2 text-[11px] font-semibold dark:text-zinc-500 text-zinc-500">
              <span>{visibleFixtures.length} matches</span>
              {searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="rounded-md border dark:border-zinc-800 border-zinc-200 px-2 py-1 dark:text-zinc-400 text-zinc-600">Clear</button>}
            </div>
          </div>
        )}

        {activeTab === 'search' && (
          <div className="flex items-center gap-2 overflow-x-auto rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/80 bg-white p-1.5 shadow-sm scrollbar-none">
            {realtimeTabs.map(tab => (
              <button key={tab.id} type="button" onClick={() => setGroupFilter(tab.id)} className={`season-filter-tab shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${groupFilter === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'dark:text-zinc-400 text-zinc-500 border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-900/35 bg-zinc-50'}`}>
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'portfolio' && (
          <MyPositions fixtures={fixtures} matchStates={matchStates} onWatch={handleWatch} />
        )}

        {activeTab === 'search' && GROUPS.includes(groupFilter) && (
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-4 border-b dark:border-zinc-900 border-zinc-200 pb-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">World Cup Group</div>
                <h2 className="mt-1 text-xl font-semibold tracking-tight dark:text-zinc-100 text-zinc-900">Group {groupFilter}</h2>
              </div>
              <div className="text-right text-xs dark:text-zinc-500 text-zinc-400">{selectedGroupFixtures.length} fixtures</div>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="overflow-hidden rounded-lg border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white">
                <div className="border-b dark:border-zinc-900 border-zinc-100 px-4 py-3">
                  <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-400 text-zinc-500">Previously Played</div>
                </div>
                <div className="divide-y dark:divide-zinc-900 divide-zinc-100">
                  {selectedGroupResults.length > 0 ? selectedGroupResults.map(fixture => {
                    const state = matchStates[fixture.id];
                    return (
                      <div key={fixture.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-semibold dark:text-zinc-200 text-zinc-800">{fixture.home.code} vs {fixture.away.code}</div>
                          <div className="mt-0.5 text-[11px] dark:text-zinc-600 text-zinc-400">{fixture.venue}</div>
                        </div>
                        <div className="shrink-0 text-lg font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">{state.homeScore} - {state.awayScore}</div>
                      </div>
                    );
                  }) : (
                    <div className="px-4 py-5 text-sm dark:text-zinc-500 text-zinc-500">No completed matches in Group {groupFilter} yet.</div>
                  )}
                </div>
              </div>
              <GroupTable fixtures={fixtures} matchStates={matchStates} selectedGroup={groupFilter} />
            </div>
          </section>
        )}

        {(activeTab === 'search' || (activeTab === 'home' && homeCupView === 'matches')) && (groupFilter === 'bracket' || groupFilter === 'knockouts' || KNOCKOUT_FILTERS.includes(groupFilter)) ? (
          <BracketView
            fixtures={fixtures}
            matchStates={matchStates}
            onWatch={handleWatch}
            activeRound={(['R32', 'R16', 'QF', 'SF', '3PL', 'F', 'knockouts', 'bracket'].includes(groupFilter) ? groupFilter : 'bracket') as 'R32' | 'R16' | 'QF' | 'SF' | '3PL' | 'F' | 'knockouts' | 'bracket'}
          />
        ) : (activeTab === 'search' || (activeTab === 'home' && homeCupView === 'matches')) && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                {GROUPS.includes(groupFilter) ? `Group ${groupFilter} Fixtures` : 'Fixture Board'}
              </div>
              <div className="text-[11px] dark:text-zinc-500 text-zinc-400">Active first, upcoming next, FT last</div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleFixtures.map(fixture => (
                <FixtureCard
                  key={fixture.id}
                  fixture={fixture}
                  pool={pools[fixture.id]}
                  matchState={matchStates[fixture.id]}
                  stakeClosedNotice={stakeClosedNotices[fixture.id]}
                  refereeAddress={refereeAddress}
                  onStake={handleStake}
                  onWatch={handleWatch}
                  onOpenLeaderboard={openMatchdayLeaderboard}
                />
              ))}
            </div>
            {visibleFixtures.length === 0 && (
              <div className="rounded-lg border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white px-4 py-8 text-center text-sm dark:text-zinc-500 text-zinc-500">
                {!worldCupFeedReady ? 'World Cup markets open after the live match feed is active.' : 'No matches found. Try a team name, code, group, or venue.'}
              </div>
            )}
          </section>
        )}

        {inviteVisible && activeTab === 'home' && homeCupView === 'matches' && (!settlementWalletAddress || !capturedReferrer || capturedReferrer.toLowerCase() !== settlementWalletAddress.toLowerCase()) && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs dark:border-blue-500/20 dark:bg-blue-500/10">
            <span className="flex items-center gap-2 truncate text-blue-800 dark:text-blue-200">
              <Link2 size={12} className="shrink-0" />
              <span className="truncate font-semibold">Match opened from an invite</span>
              <span className="hidden truncate font-medium text-blue-700/80 sm:inline dark:text-blue-300/70">Stake to back the fan who shared it.</span>
            </span>
            <button type="button" onClick={() => setInviteVisible(false)} aria-label="Dismiss invite notice" className="shrink-0 rounded-md p-1 text-blue-700/80 transition-colors hover:bg-blue-100 hover:text-blue-900 dark:text-blue-200/80 dark:hover:bg-blue-500/15 dark:hover:text-blue-100">
              <X size={12} />
            </button>
          </div>
        )}

        {activeTab === 'portfolio' && (
          <div className="border-t dark:border-zinc-900 border-zinc-200">
            <button type="button" onClick={() => setLogOpen(open => !open)} className="flex w-full items-center justify-between gap-4 py-3 text-xs dark:text-zinc-600 text-zinc-500 dark:hover:text-zinc-400 hover:text-zinc-700">
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-semibold dark:text-zinc-400 text-zinc-600">Account Activity</span>
                <span className="hidden text-[11px] font-semibold dark:text-zinc-500 text-zinc-400 sm:inline-flex">{logs.length} recent updates</span>
              </span>
              {logOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {logOpen && <LogStream logs={logs} daemonOnline={engineOnline} />}
          </div>
        )}

        {activeTab === 'home' && (
          <div className="overflow-hidden rounded-xl border dark:border-zinc-900 border-zinc-200">
            <div className="flex w-full items-center justify-between gap-4 bg-white px-4 py-3 text-xs dark:bg-transparent dark:text-zinc-600 text-zinc-500">
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-semibold dark:text-zinc-400 text-zinc-600">Platform Steps</span>
                <span className="hidden text-[11px] font-semibold dark:text-zinc-500 text-zinc-400 sm:inline-flex">Pick a live World Cup market, stake OKB, and track verified results.</span>
              </span>
            </div>
          </div>
        )}

        {activeTab === 'portfolio' && (
          <div className="border-t dark:border-zinc-900 border-zinc-200">
            <button type="button" onClick={() => setProofOpen(open => !open)} className="flex w-full items-center justify-between gap-4 py-3 text-xs dark:text-zinc-600 text-zinc-500 dark:hover:text-zinc-400 hover:text-zinc-700">
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-semibold dark:text-zinc-400 text-zinc-600">Why X Layer</span>
                <span className="hidden min-w-0 text-[11px] font-semibold dark:text-zinc-500 text-zinc-400 sm:inline-flex">Fast OKB staking, explorer-linked records, autonomous payouts</span>
              </span>
              {proofOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {proofOpen && (
              <div className="border-t dark:border-zinc-900 border-zinc-100 py-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Network</div>
                    <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">X Layer Mainnet</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Payout Account</div>
                    {refereeAddress ? (
                      <a href={explorerAddr(refereeAddress)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900 hover:text-blue-500">
                        {shortAddr(refereeAddress)} <ExternalLink size={12} />
                      </a>
                    ) : <div className="mt-1 text-sm font-semibold dark:text-zinc-500 text-zinc-500">Not connected</div>}
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Latest Block</div>
                    {lastBlock > 0 ? (
                      <a href={explorerBlock(lastBlock)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900 hover:text-blue-500">
                        {lastBlock.toLocaleString()} <ExternalLink size={12} />
                      </a>
                    ) : <div className="mt-1 text-sm font-semibold dark:text-zinc-500 text-zinc-500">Syncing</div>}
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Payout Float</div>
                    <div className={`mt-1 text-sm font-semibold tabular-nums ${healthColor}`}>{metabolism.okbBalanceFormatted} OKB</div>
                    {reserveUsd && <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">{reserveUsd}</div>}
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Status</div>
                    <div className={`mt-1 text-sm font-semibold ${wsConnected || engineOnline ? 'dark:text-emerald-300 text-emerald-600' : 'dark:text-zinc-500 text-zinc-500'}`}>{wsConnected || engineOnline ? 'Online' : 'Offline'}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 divide-x divide-y border-y dark:divide-zinc-900 divide-zinc-100 dark:border-zinc-900 border-zinc-100 md:grid-cols-4 md:divide-y-0">
                  <div className="px-3 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Platform Volume</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">{formatOKBWei(proofPlatformVolumeWei)}</div>
                    {proofPoolUsd && <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">{proofPoolUsd}</div>}
                  </div>
                  <div className="px-3 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Open Markets</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">{fixtures.filter(fixture => fixture.status === 'open').length}</div>
                  </div>
                  <div className="px-3 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Payouts</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">{payoutSettlementCount}</div>
                  </div>
                  <div className="px-3 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Feed</div>
                    <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">{worldCupSourceLabel}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Recent Stakes</div>
                    <div className="divide-y border-y dark:divide-zinc-900 divide-zinc-100 dark:border-zinc-900 border-zinc-100">
                      {proofStakeTxs.length > 0 ? proofStakeTxs.map(log => (
                        <a key={`${log.id}-${log.txHash}`} href={explorerTx(log.txHash!)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 py-2 text-xs transition-colors hover:text-blue-500">
                          <span className="min-w-0 truncate dark:text-zinc-300 text-zinc-700">{log.message}</span>
                          <span className="shrink-0 font-semibold tabular-nums dark:text-zinc-500 text-zinc-500">{shortAddr(log.txHash!)}</span>
                        </a>
                      )) : <div className="py-2 text-xs dark:text-zinc-500 text-zinc-500">No stake transactions indexed yet.</div>}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Recent Payouts</div>
                    <div className="divide-y border-y dark:divide-zinc-900 divide-zinc-100 dark:border-zinc-900 border-zinc-100">
                      {proofPayoutTxs.length > 0 ? proofPayoutTxs.map(payout => (
                        <a key={`${payout.fixtureId}-${payout.txHash}`} href={explorerTx(payout.txHash)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 py-2 text-xs transition-colors hover:text-blue-500">
                          <span className="min-w-0 truncate dark:text-zinc-300 text-zinc-700">{payout.fixtureId} payout</span>
                          <span className="shrink-0 font-semibold tabular-nums dark:text-zinc-500 text-zinc-500">{formatOKBWei(payout.amountWei)} - {shortAddr(payout.txHash)}</span>
                        </a>
                      )) : <div className="py-2 text-xs dark:text-zinc-500 text-zinc-500">Payout links appear after a settled match has winners.</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'news' && (
          <Suspense fallback={<div className="rounded-xl border dark:border-zinc-900 border-zinc-200 px-4 py-6 text-sm dark:text-zinc-500 text-zinc-500">Loading match desk...</div>}>
            <WorldCupNews />
          </Suspense>
        )}

        <div className="space-y-2 border-t dark:border-zinc-900 border-zinc-100 pb-4 pt-4 text-center">
          <div className="flex items-center justify-center gap-4">
            <a href="https://x.com/FanVibeOnX" target="_blank" rel="noopener noreferrer" className="text-xs dark:text-zinc-600 text-zinc-400 underline decoration-transparent underline-offset-4 transition-colors hover:text-zinc-600 hover:decoration-zinc-400 dark:hover:text-zinc-300 dark:hover:decoration-zinc-500">
              X/Twitter
            </a>
          </div>
          <a href={explorerAddr(refereeAddress)} target="_blank" rel="noopener noreferrer" className="inline-flex text-[11px] dark:text-zinc-600 text-zinc-400 underline decoration-transparent underline-offset-4 transition-colors hover:text-zinc-600 hover:decoration-zinc-400 dark:hover:text-zinc-300 dark:hover:decoration-zinc-500">
            Built on OKX X Layer
          </a>
        </div>
      </main>

      {watchingFixture && watchingMatchState && (
        <MatchViewer fixture={watchingFixture} fixtures={fixtures} matchState={watchingMatchState} onClose={() => setWatchingId(null)} />
      )}
    </div>
  );
}
