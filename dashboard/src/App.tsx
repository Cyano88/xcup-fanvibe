import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, http, formatEther } from 'viem';
import { BookOpen, BriefcaseBusiness, ChevronDown, ChevronUp, ExternalLink, Globe, Home, Newspaper, Radio, Search, Trophy, Volume2, VolumeX, X } from 'lucide-react';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { FixtureCard } from './components/FixtureCard';
import { LogStream } from './components/LogStream';
import { MyPositions } from './components/MyPositions';
import { MatchViewer } from './components/MatchViewer';
import { GroupTable } from './components/GroupTable';
import { MatchdayCupLeaderboard } from './components/MatchdayCupLeaderboard';
import type { DaemonState, DaemonLog, Fixture, Pool, Outcome, SettlementResult, MetabolicState, MatchState, Team, UserPosition } from './types';
import { BracketView } from './components/BracketView';
import { ChampionPick } from './components/ChampionPick';
import { simulateMatch } from './lib/clientSim';
import { X_LAYER_RPC_URLS, xLayerMainnet, explorerAddr, explorerTx } from './lib/chain';
import { shortAddr } from './lib/encode';
import { flushPendingStakeReports } from './lib/stakeReport';
import { captureReferralFromUrl } from './lib/accountData';
import { formatOkbUsd, formatOkbUsdFromWei, useOkbUsdPrice } from './lib/useOkbUsdPrice';
import { FANVIBE_TOKEN_LOGO, FANVIBE_TOKEN_URL } from './lib/fanvibeToken';
import {
  SEASON_GROUPS,
  DEFAULT_SEASON_TIMING,
  TEST_SEASON_TIMING,
  allGroupMatchesFinished,
  advanceKnockout,
  baseFixtureId,
  createSeasonFixtures,
  currentGroupMatchday,
  isSeasonFixtureDue,
  isGroupStageFixture,
  qualifiedTeams,
  seedRoundOf32,
  seasonFixtureKickoffDelayMs,
  seasonFixtureStartAtMs,
  setSeasonTiming,
  type SeasonTiming,
} from './lib/seasonTournament';

const BACKEND_WS   = import.meta.env.VITE_BACKEND_WS   ?? 'ws://localhost:3001';
const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP  ?? 'http://localhost:3001';
const REFEREE_ADDR = (import.meta.env.VITE_REFEREE_ADDRESS ?? '') as string;
const FANVIBE_SEASON_BG = '/assets/fanvibe-season-bg.jpeg';
const FANVIBE_HERO_LOGO = '/assets/fanvibe-hero-logo.jpeg';
const BRAND_E_IMAGE = '/assets/brand-e.png';
const FRANCE_26_THEME = '/assets/france-26-theme.mp3';
const FANVIBE_V4_HOOK = '0x4B6612ca209f07db44f8A651E4217A75106C4080';
const FANVIBE_V4_POOL_ID = '0x04a73ca9283b864136f6e14dc41de8dd1defad19b353242a9fc100d4b46fa15b';
const FANVIBE_V4_DEPLOY_TX = '0xeff4a1213e9324508461375f49889aa1e3c49dd25c9cdfd2040cae18771080c8';
const FANVIBE_V4_INIT_TX = '0x1ad16c9894db8ad8b1a1e29c9f7425170dc20188f81eb20b0ad77f32f4d95306';
const FANVIBE_V4_APPROVE_TX = '0xf0b842fa937598ff7b8babd6585a6946020339e6ef3a2119e32f273928d58237';
const FANVIBE_V4_SWAP_PROOF_TX = '0xe38fd0daf3e879270ecff754f5cbf4668715825b0ed11926f873cacd50ad9c3c';
const SEASON_CACHE_KEY = 'fanvibe.seasonSnapshot.prod';
const LAST_WALLET_KEY = 'fanvibe.lastWalletAddress';
const ACTIVE_TAB_KEY = 'fanvibe.activeTab';
const SETTLEMENT_NOTICE_MS = 5 * 60 * 1000;
const WorldCupNews = lazy(() => import('./components/WorldCupNews').then(module => ({ default: module.WorldCupNews })));
const flagUrl = (iso: string) =>
  iso === 'un' || iso === 'tbd' ? '' : `https://flagcdn.com/w640/${iso.toLowerCase()}.png`;
const UNRESOLVED_TEAM_CODES = new Set(['TBD', '1ST', '2ND', '3RD', 'WIN', 'LOS']);
const parseProviderTime = (value: string) => {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return Date.parse(normalized);
};
const isResolvedFixture = (fixture?: Fixture | null) =>
  !!fixture
  && !UNRESOLVED_TEAM_CODES.has(fixture.home.code)
  && !UNRESOLVED_TEAM_CODES.has(fixture.away.code)
  && fixture.home.iso !== 'tbd'
  && fixture.away.iso !== 'tbd';
const explorerBlock = (blockNumber: number) =>
  `https://www.okx.com/web3/explorer/xlayer/block/${blockNumber}`;

const rpcClient = createPublicClient({ chain: xLayerMainnet, transport: http(X_LAYER_RPC_URLS[0]) });

type SeasonPhase = 'preseason' | 'playing' | 'champion' | 'interseason';
type AppTab = 'home' | 'search' | 'news' | 'portfolio';

interface InitialSeasonState {
  version?: 1;
  mode?: SeasonStorageMode;
  seasonNumber: number;
  phase: SeasonPhase;
  phaseEndsAt: number;
  phaseTimer: number;
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  eliminatedTeams: string[];
  champion: Team | null;
  previousKnockoutResults?: {
    seasonNumber: number;
    champion: Team | null;
    fixtures: Fixture[];
    matchStates: Record<string, MatchState>;
  } | null;
  seasonWinners?: Array<{
    seasonNumber: number;
    team: Team;
  }>;
  tournamentGen: number;
  timings?: SeasonTiming;
  updatedAt?: number;
}

type SeasonStorageMode = 'prod' | 'test';

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

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtOKBWei(wei: bigint | string | number): string {
  try {
    const value = typeof wei === 'bigint' ? wei : BigInt(wei);
    const formatted = Number(formatEther(value));
    return `${formatted.toFixed(formatted >= 10 ? 2 : 4)} OKB`;
  } catch {
    return '0 OKB';
  }
}

function stripUsdPrefix(value: string | null): string | null {
  return value ? value.replace(/^US/, '') : null;
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

function settlementHasPayoutForAddress(settlement: SettlementResult, address: string | null): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase();
  return settlement.payouts.some(payout => !!payout.txHash && payout.address.toLowerCase() === normalized);
}

function settlementKey(settlement: SettlementResult): string {
  return `${settlement.fixtureId}-${settlement.blockNumber}-${settlement.settledAt}`;
}

function settlementTimeMs(settlement: SettlementResult): number {
  return settlement.settledAt > 10_000_000_000 ? settlement.settledAt : settlement.settledAt * 1000;
}

function positionPortfolioWei(position: UserPosition, fixtures: Fixture[], matchStates: Record<string, MatchState>): bigint {
  try {
    if (position.type === 'refund') {
      return position.status === 'queued' ? BigInt(position.refund.amountWei) : 0n;
    }

    if (position.type === 'champion') {
      if (position.status === 'active') return BigInt(position.stake.amountWei);
      if (position.status === 'settled_winner' && !position.payout) return BigInt(position.stake.amountWei);
      return 0n;
    }

    const stakeWei = BigInt(position.stake.amountWei);
    const liveFixture = fixtures.find(fixture => fixture.id === position.stake.fixtureId) ?? position.fixture;
    const liveState = liveFixture ? matchStates[liveFixture.id] : undefined;
    const stakeMs = position.stake.timestamp > 10_000_000_000 ? position.stake.timestamp : position.stake.timestamp * 1000;
    const settlementAppliesToStake = !!position.settlement && position.settlement.settledAt >= stakeMs;
    const currentFixtureIsLive = liveState?.status === 'live' || liveState?.status === 'half_time';
    const currentFixtureUnsettled = !!liveFixture?.status && liveFixture.status !== 'settled';

    if (currentFixtureIsLive || currentFixtureUnsettled) return stakeWei;
    if (liveFixture?.status === 'settled' && liveFixture.result) {
      return liveFixture.result === position.stake.outcome && position.status !== 'paid'
        ? BigInt(position.payout?.amountWei ?? position.stake.amountWei)
        : 0n;
    }
    if (!settlementAppliesToStake) return stakeWei;
    if (position.status === 'active' || position.status === 'won_pending_payout') {
      return BigInt(position.payout?.amountWei ?? position.stake.amountWei);
    }
    return 0n;
  } catch {
    return 0n;
  }
}

function seasonFixturesFromState(incoming: Fixture[]): Fixture[] {
  if (!incoming.length) return [];
  return incoming;
}

function freshSeasonState(
  seasonNumber = 1,
  now = Date.now(),
  timings: SeasonTiming = DEFAULT_SEASON_TIMING,
  mode: SeasonStorageMode = 'prod',
): InitialSeasonState {
  return {
    version: 1,
    mode,
    seasonNumber,
    phase: 'preseason',
    phaseEndsAt: now + timings.preseasonSeconds * 1000,
    phaseTimer: timings.preseasonSeconds,
    fixtures: [],
    matchStates: {},
    eliminatedTeams: [],
    champion: null,
    previousKnockoutResults: null,
    seasonWinners: [],
    tournamentGen: 0,
    timings,
    updatedAt: now,
  };
}

function writeCachedSeasonSnapshot(snapshot: InitialSeasonState, mode: SeasonStorageMode): void {
  if (mode !== 'prod') return;
  try {
    if (snapshot.phase === 'playing') {
      window.localStorage.setItem(SEASON_CACHE_KEY, JSON.stringify(snapshot));
    } else {
      window.localStorage.removeItem(SEASON_CACHE_KEY);
    }
  } catch {
    // Cache is only used to smooth reloads.
  }
}

function mergeLiveMatchStates(
  current: Record<string, MatchState>,
  incoming: Record<string, MatchState>,
): Record<string, MatchState> {
  const merged = { ...incoming };
  const goalEventCount = (state: MatchState) =>
    (state.events ?? []).filter(event => event.type === 'goal_home' || event.type === 'goal_away').length;

  for (const [fixtureId, currentState] of Object.entries(current)) {
    const incomingState = incoming[fixtureId];
    if (!incomingState) continue;
    const currentEvents = currentState.events?.length ?? 0;
    const incomingEvents = incomingState.events?.length ?? 0;
    if (currentEvents > 0 && incomingEvents === 0) {
      const currentGoalEvents = goalEventCount(currentState);
      const incomingScoreGoals = incomingState.homeScore + incomingState.awayScore;
      if (currentGoalEvents > incomingScoreGoals) {
        merged[fixtureId] = currentState;
        continue;
      }
      merged[fixtureId] = { ...incomingState, events: currentState.events };
      continue;
    }
    const currentFreshness = (currentState.minute * 1000) + currentEvents;
    const incomingFreshness = (incomingState.minute * 1000) + incomingEvents;
    if (
      (currentState.status === 'live' || currentState.status === 'half_time') &&
      incomingState.status !== 'finished' &&
      currentFreshness > incomingFreshness
    ) {
      merged[fixtureId] = currentState;
    }
  }
  return merged;
}

function richerMatchState(primary?: MatchState | null, fallback?: MatchState | null): MatchState | null {
  if (!primary) return fallback ?? null;
  if (!fallback) return primary;
  const primaryEvents = primary.events?.length ?? 0;
  const fallbackEvents = fallback.events?.length ?? 0;
  if (fallbackEvents > primaryEvents && primaryEvents === 0) {
    return { ...primary, events: fallback.events };
  }
  return primary;
}

function replaceRealtimeMatchStates(
  current: Record<string, MatchState>,
  realtimeFixtures: Fixture[],
  incoming: Record<string, MatchState>,
): Record<string, MatchState> {
  const realtimeIds = new Set(realtimeFixtures.map(fixture => fixture.id));
  return {
    ...Object.fromEntries(Object.entries(current).filter(([fixtureId]) => !realtimeIds.has(fixtureId))),
    ...incoming,
  };
}

function fixtureStageLabel(fixture?: Fixture | null, fallbackMatchday = 1): string {
  if (!fixture) return `Matchday ${fallbackMatchday}`;
  if (fixture.round === 'R32') return 'Round of 32';
  if (fixture.round === 'R16') return 'Round of 16';
  if (fixture.round === 'QF') return 'Quarter-finals';
  if (fixture.round === 'SF') return 'Semi-finals';
  if (fixture.round === '3PL') return 'Third-place Playoff';
  if (fixture.round === 'F') return 'Final';
  return `Matchday ${fixture.matchday}`;
}

function fixtureStageCode(fixture?: Fixture | null, fallbackMatchday = 1): string {
  if (!fixture) return `MD${fallbackMatchday}`;
  if (fixture.round === 'R32') return 'R32';
  if (fixture.round === 'R16') return 'R16';
  if (fixture.round === 'QF') return 'QF';
  if (fixture.round === 'SF') return 'SF';
  if (fixture.round === '3PL') return '3P';
  if (fixture.round === 'F') return 'Final';
  return `MD${fixture.matchday}`;
}

function liveStageRank(fixture?: Fixture | null): number {
  if (!fixture) return 0;
  if (fixture.round === 'F') return 6;
  if (fixture.round === '3PL') return 5;
  if (fixture.round === 'SF') return 4;
  if (fixture.round === 'QF') return 3;
  if (fixture.round === 'R16') return 2;
  if (fixture.round === 'R32') return 1;
  return 0;
}

function preseasonArchiveRank(fixture: Fixture): number {
  if (fixture.round === 'F') return 5;
  if (fixture.round === '3PL') return 4;
  if (fixture.round === 'SF') return 3;
  if (fixture.round === 'QF') return 2;
  if (fixture.round === 'R16') return 1;
  return 0;
}

export default function App() {
  const okbUsd = useOkbUsdPrice();
  const [accountValueLabel, setAccountValueLabel] = useState('$0.00');

  useEffect(() => {
    captureReferralFromUrl();
    flushPendingStakeReports().catch(() => {});
    const timer = window.setInterval(() => {
      flushPendingStakeReports().catch(() => {});
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const initialSeasonRef = useRef<InitialSeasonState | null>(null);
  if (!initialSeasonRef.current) initialSeasonRef.current = freshSeasonState(1);
  const initialSeason = initialSeasonRef.current;

  const [dark, setDark] = useState(() => {
    const saved = window.localStorage.getItem('fanvibe-theme');
    if (saved === 'light') return false;
    if (saved === 'dark') return true;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  });
  const [engineOnline, setEngineOnline]         = useState(false);
  const [refereeAddress, setRefereeAddress]     = useState(REFEREE_ADDR);
  const [metabolism, setMetabolism]             = useState<MetabolicState>(defaultMetabolism);
  const [fixtures, setFixtures]                 = useState<Fixture[]>(initialSeason.fixtures);
  const [realtimeFixtures, setRealtimeFixtures] = useState<Fixture[]>([]);
  const [worldCupFeed, setWorldCupFeed]         = useState<WorldCupFeed | null>(null);
  const [pools, setPools]                       = useState<Record<string, Pool>>({});
  const [logs, setLogs]                         = useState<DaemonLog[]>([]);
  const [lastBlock, setLastBlock]               = useState(0);
  const [wsConnected, setWsConnected]           = useState(false);
  const [settlements, setSettlements]           = useState<SettlementResult[]>([]);
  const [stakeClosedNotices, setStakeClosedNotices] = useState<Record<string, string>>({});
  const [logOpen, setLogOpen]                   = useState(false);
  const [proofOpen, setProofOpen]               = useState(false);
  const [roundFilter, setRoundFilter]           = useState<string>('all');
  const [groupFilter, setGroupFilter]           = useState<string>('all');
  const [searchQuery, setSearchQuery]           = useState('');
  const [matchStates, setMatchStates]           = useState<Record<string, MatchState>>(initialSeason.matchStates);
  const [liveUiTick, setLiveUiTick]             = useState(0);
  const [watchingFixtureId, setWatchingId]      = useState<string | null>(null);
  const [viewMode, setViewMode]                 = useState<'simulated' | 'realtime'>('realtime');
  const [homeCupView, setHomeCupView]           = useState<'matches' | 'leaderboard'>('matches');
  const [activeTab, setActiveTab]               = useState<AppTab>(() => readActiveTab());
  const [soundMuted, setSoundMuted]             = useState(false);
  const [seasonMode, setSeasonMode]             = useState<SeasonStorageMode>('prod');
  const [seasonTiming, setSeasonTimingState]    = useState<SeasonTiming>(DEFAULT_SEASON_TIMING);
  const [, setSeasonDurable]                    = useState(false);
  const [seasonAdminOpen, setSeasonAdminOpen]   = useState(false);
  const [seasonHydrated, setSeasonHydrated]     = useState(false);
  const [eliminatedTeams, setEliminatedTeams]   = useState<Set<string>>(() => new Set(initialSeason.eliminatedTeams));
  const [champion, setChampion]                 = useState<Team | null>(initialSeason.champion);
  const [previousKnockoutResults, setPreviousKnockoutResults] = useState(initialSeason.previousKnockoutResults ?? null);
  const [seasonWinners, setSeasonWinners]       = useState(initialSeason.seasonWinners ?? []);
  const [tournamentGen, setTournamentGen]       = useState(initialSeason.tournamentGen);
  const [settlementWalletAddress, setSettlementWalletAddress] = useState<string | null>(() => getRememberedWalletAddress());
  const [settlementNoticeTick, setSettlementNoticeTick] = useState(Date.now());
  const [dismissedSettlementNotices, setDismissedSettlementNotices] = useState<Set<string>>(() => new Set());

  // Season / phase system
  const [seasonNumber, setSeasonNumber]         = useState<number>(() => {
    return Math.max(1, initialSeason.seasonNumber || 1);
  });
  const [phase, setPhase]                       = useState<SeasonPhase>(initialSeason.phase);
  const [phaseTimer, setPhaseTimer]             = useState(initialSeason.phaseTimer);
  const [phaseEndsAt, setPhaseEndsAt]           = useState(initialSeason.phaseEndsAt);
  const [seasonClockTick, setSeasonClockTick]   = useState(0);

  const simulationModeVisible = false;

  const wsRef                  = useRef<WebSocket | null>(null);
  const reconnectRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simCleanupRef          = useRef<Map<string, () => void>>(new Map());
  const bracketProcessedRef    = useRef<Set<string>>(new Set());
  const championTriggeredRef   = useRef(false);
  const watchedStateRef        = useRef<Record<string, MatchState>>({});
  const watchedFixtureRef      = useRef<Record<string, Fixture>>({});
  const themeAudioRef          = useRef<HTMLAudioElement | null>(null);
  const seasonPersistTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seasonSnapshotUpdatedAtRef = useRef(0);
  const seasonHydratedRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    window.localStorage.setItem('fanvibe-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    if (!simulationModeVisible && viewMode !== 'realtime') setViewMode('realtime');
  }, [simulationModeVisible, viewMode]);

  useEffect(() => {
    if (viewMode === 'realtime' && activeTab === 'search' && groupFilter === 'all') setGroupFilter('live');
  }, [activeTab, groupFilter, viewMode]);

  useEffect(() => {
    if (viewMode === 'realtime' && activeTab === 'home' && homeCupView === 'matches' && groupFilter === 'all') {
      setGroupFilter('live');
    }
  }, [activeTab, groupFilter, homeCupView, viewMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
    } catch {
      /* tab memory is a convenience */
    }
  }, [activeTab]);

  useEffect(() => {
    const refreshWallet = () => setSettlementWalletAddress(getRememberedWalletAddress());
    refreshWallet();
    const walletTimer = window.setInterval(refreshWallet, 3000);
    const noticeTimer = window.setInterval(() => setSettlementNoticeTick(Date.now()), 1000);
    return () => {
      window.clearInterval(walletTimer);
      window.clearInterval(noticeTimer);
    };
  }, []);

  useEffect(() => {
    setSeasonTiming(seasonTiming);
  }, [seasonTiming]);

  useEffect(() => {
    seasonHydratedRef.current = seasonHydrated;
  }, [seasonHydrated]);

  useEffect(() => {
    const timer = setInterval(() => setLiveUiTick(tick => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const audio = themeAudioRef.current;
    if (!audio) return;
    audio.volume = 0.34;
    audio.muted = soundMuted;
    if (!soundMuted) audio.play().catch(() => setSoundMuted(true));
  }, [soundMuted]);

  const toggleSound = useCallback(() => {
    const audio = themeAudioRef.current;
    setSoundMuted(prev => {
      const next = !prev;
      if (audio) {
        audio.muted = next;
        if (!next) audio.play().catch(() => {});
      }
      return next;
    });
  }, []);

  const applySeasonSnapshot = useCallback((snapshot: InitialSeasonState, mode: SeasonStorageMode, preserveWatching = false) => {
    const snapshotUpdatedAt = snapshot.updatedAt ?? Date.now();
    if (preserveWatching && snapshotUpdatedAt + 1000 < seasonSnapshotUpdatedAtRef.current) return;
    seasonSnapshotUpdatedAtRef.current = snapshotUpdatedAt;
    if (!preserveWatching) {
      simCleanupRef.current.forEach(c => c());
      simCleanupRef.current.clear();
      bracketProcessedRef.current.clear();
      championTriggeredRef.current = false;
    }
    const timing = snapshot.timings ?? (mode === 'test' ? TEST_SEASON_TIMING : DEFAULT_SEASON_TIMING);
    setSeasonTimingState(timing);
    setSeasonNumber(Math.max(1, snapshot.seasonNumber || 1));
    setPhase(snapshot.phase);
    setPhaseEndsAt(snapshot.phaseEndsAt);
    setPhaseTimer(Math.max(0, Math.ceil((snapshot.phaseEndsAt - Date.now()) / 1000)));
    setFixtures(seasonFixturesFromState(snapshot.fixtures));
    const incomingMatchStates = snapshot.phase === 'preseason' ? {} : snapshot.matchStates ?? {};
    setMatchStates(prev => preserveWatching && snapshot.phase === 'playing' ? mergeLiveMatchStates(prev, incomingMatchStates) : incomingMatchStates);
    setEliminatedTeams(new Set(snapshot.eliminatedTeams ?? []));
    setChampion(snapshot.champion ?? null);
    setPreviousKnockoutResults(snapshot.previousKnockoutResults ?? null);
    setSeasonWinners(snapshot.seasonWinners ?? []);
    setTournamentGen(snapshot.tournamentGen ?? 0);
    writeCachedSeasonSnapshot(snapshot, mode);
    if (!preserveWatching || snapshot.phase !== 'playing') setWatchingId(null);
  }, []);

  const persistSeasonSnapshot = useCallback((mode = seasonMode) => {
    if (mode === 'prod') return;
    const payload: InitialSeasonState = {
      version: 1,
      mode,
      seasonNumber,
      phase,
      phaseEndsAt,
      phaseTimer,
      fixtures,
      matchStates,
      eliminatedTeams: [...eliminatedTeams],
      champion,
      previousKnockoutResults,
      seasonWinners,
      tournamentGen,
      timings: seasonTiming,
      updatedAt: Date.now(),
    };
    fetch(`${BACKEND_HTTP}/season/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, state: payload }),
    }).catch(() => {});
  }, [champion, eliminatedTeams, fixtures, matchStates, phase, phaseEndsAt, phaseTimer, previousKnockoutResults, seasonMode, seasonNumber, seasonTiming, seasonWinners, tournamentGen]);

  const loadSeasonSnapshot = useCallback((preserveWatching = false, showLoading = true) => {
    if (showLoading) setSeasonHydrated(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    const applyFreshSeason = () => {
      const previousSnapshotUpdatedAt = seasonSnapshotUpdatedAtRef.current;
      const fresh = freshSeasonState(1, Date.now(), seasonMode === 'test' ? TEST_SEASON_TIMING : DEFAULT_SEASON_TIMING, seasonMode);
      applySeasonSnapshot(fresh, seasonMode);
      seasonSnapshotUpdatedAtRef.current = previousSnapshotUpdatedAt;
      setSeasonDurable(false);
      setSeasonHydrated(true);
      return fresh;
    };
    fetch(`${BACKEND_HTTP}/season/snapshot?mode=${seasonMode}`, { signal: controller.signal })
      .then(r => r.json())
      .then((res: { state: InitialSeasonState | null; durable?: boolean }) => {
        setSeasonDurable(!!res.durable);
        if (res.state) {
          applySeasonSnapshot(res.state, seasonMode, preserveWatching);
          setSeasonHydrated(true);
          return;
        }
        if (seasonMode === 'prod') {
          if (!seasonHydratedRef.current) setSeasonHydrated(true);
          return;
        }
        const fresh = applyFreshSeason();
        fetch(`${BACKEND_HTTP}/season/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: seasonMode, state: fresh }),
        }).catch(() => {});
      })
      .catch(() => {
        if (seasonMode === 'prod') {
          if (!seasonHydratedRef.current) setSeasonHydrated(true);
          return;
        }
        if (!seasonHydratedRef.current) applyFreshSeason();
      })
      .finally(() => window.clearTimeout(timeout));
  }, [applySeasonSnapshot, seasonMode]);

  useEffect(() => {
    if (!simulationModeVisible) {
      setSeasonHydrated(true);
      return;
    }
    loadSeasonSnapshot();
  }, [loadSeasonSnapshot, simulationModeVisible]);

  useEffect(() => {
    if (!seasonHydrated) return;
    if (seasonPersistTimerRef.current) clearTimeout(seasonPersistTimerRef.current);
    seasonPersistTimerRef.current = setTimeout(() => persistSeasonSnapshot(), 1200);
    return () => {
      if (seasonPersistTimerRef.current) clearTimeout(seasonPersistTimerRef.current);
    };
  }, [persistSeasonSnapshot, seasonHydrated]);

  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(BACKEND_WS);
    wsRef.current = ws;

    ws.onopen = () => { setEngineOnline(true); if (reconnectRef.current) clearTimeout(reconnectRef.current); };

    ws.onmessage = (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; data: unknown };
        if (msg.type === 'state') {
          const s = msg.data as DaemonState;
          setRefereeAddress(s.refereeAddress || REFEREE_ADDR);
          setMetabolism(s.metabolism);
          if (seasonMode !== 'prod' && !seasonHydratedRef.current) {
            setFixtures(prev => prev.length ? prev : seasonFixturesFromState(s.fixtures));
          }
          setPools(s.pools);
          setLogs(s.recentLogs);
          setLastBlock(s.lastBlock);
          setWsConnected(s.wsConnected);
          setSettlements(s.settlements);
        } else if (msg.type === 'log') {
          setLogs(prev => [...prev.slice(-199), msg.data as DaemonLog]);
        } else if (msg.type === 'settlement') {
          const s = msg.data as SettlementResult;
          setSettlements(prev => [...prev, s]);
          setFixtures(prev => prev.map(f => f.id === s.fixtureId ? { ...f, status: 'settled', result: s.outcome } : f));
        } else if (msg.type === 'season-reset') {
          if (!simulationModeVisible) return;
          const data = msg.data as { mode?: SeasonStorageMode };
          if (data.mode === seasonMode) {
            if (seasonMode === 'prod') return;
            applySeasonSnapshot(freshSeasonState(1, Date.now(), seasonMode === 'test' ? TEST_SEASON_TIMING : DEFAULT_SEASON_TIMING, seasonMode), seasonMode);
          }
        } else if (msg.type === 'season') {
          if (!simulationModeVisible) return;
          const snapshot = msg.data as InitialSeasonState;
          if ((snapshot.mode ?? 'prod') === seasonMode) {
            applySeasonSnapshot(snapshot, seasonMode, true);
            setSeasonHydrated(true);
          }
        }
      } catch { /* malformed */ }
    };

    ws.onclose = () => { setEngineOnline(false); reconnectRef.current = setTimeout(connectWS, 5000); };
    ws.onerror = () => ws.close();
  }, [applySeasonSnapshot, seasonMode]);

  useEffect(() => {
    connectWS();
    fetch(`${BACKEND_HTTP}/state`)
      .then(r => r.json())
      .then((s: DaemonState) => {
        setEngineOnline(true);
        setRefereeAddress(s.refereeAddress || REFEREE_ADDR);
        setMetabolism(s.metabolism);
        if (seasonMode !== 'prod' && !seasonHydratedRef.current) {
          setFixtures(prev => prev.length ? prev : seasonFixturesFromState(s.fixtures));
        }
        setPools(s.pools);
        setLogs(s.recentLogs);
        setLastBlock(s.lastBlock);
        setWsConnected(s.wsConnected);
        setSettlements(s.settlements);
      })
      .catch(() => {});

    return () => { wsRef.current?.close(); if (reconnectRef.current) clearTimeout(reconnectRef.current); };
  }, [connectWS]);

  useEffect(() => {
    const resyncLiveSeason = () => {
      if (document.visibilityState === 'hidden') return;
      connectWS();
      if (viewMode === 'simulated') loadSeasonSnapshot(true, false);
    };
    window.addEventListener('focus', resyncLiveSeason);
    document.addEventListener('visibilitychange', resyncLiveSeason);
    return () => {
      window.removeEventListener('focus', resyncLiveSeason);
      document.removeEventListener('visibilitychange', resyncLiveSeason);
    };
  }, [connectWS, loadSeasonSnapshot, viewMode]);

  useEffect(() => {
    if (viewMode !== 'simulated' || !seasonHydrated) return;
    const syncLiveState = () => {
      if (document.visibilityState === 'hidden') return;
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED || wsRef.current.readyState === WebSocket.CLOSING) {
        connectWS();
      }
      loadSeasonSnapshot(true, false);
    };
    const timer = setInterval(syncLiveState, phase === 'playing' || phase === 'champion' ? 1500 : 5000);
    return () => clearInterval(timer);
  }, [connectWS, loadSeasonSnapshot, phase, seasonHydrated, viewMode]);

  useEffect(() => {
    const loadWorldCupFeed = () => {
      fetch(`${BACKEND_HTTP}/worldcup/feed`)
        .then(r => r.json())
        .then((feed: WorldCupFeed) => {
          const feedFixtures = Array.isArray(feed.fixtures) ? feed.fixtures : [];
          setRealtimeFixtures(feedFixtures);
          if (feed.matchStates) {
            setMatchStates(prev => replaceRealtimeMatchStates(prev, feedFixtures, feed.matchStates));
          }
          setWorldCupFeed(feed);
        })
        .catch(() => {
          setRealtimeFixtures([]);
          setMatchStates(prev => ({
            ...Object.fromEntries(Object.entries(prev).filter(([fixtureId]) => !fixtureId.startsWith('wc-') && !fixtureId.startsWith('sm-'))),
          }));
          setWorldCupFeed({
            fixtures: [],
            matchStates: {},
            source: 'sportmonks',
            mode: 'fallback',
            updatedAt: Date.now(),
            freshnessSeconds: 0,
            providerConfigured: false,
            error: 'World Cup feed unavailable',
          });
        });
    };

    loadWorldCupFeed();
    const timer = setInterval(loadWorldCupFeed, 30_000);
    return () => clearInterval(timer);
  }, []);

  // Direct RPC balance when engine offline
  useEffect(() => {
    if (engineOnline || !refereeAddress) return;
    const fetchBal = async () => {
      try {
        const bal = await rpcClient.getBalance({ address: refereeAddress as `0x${string}` });
        const hp  = Math.min(100, Number((bal * 100n) / BigInt(5e17)));
        setMetabolism(prev => ({
          ...prev, okbBalance: bal.toString(),
          okbBalanceFormatted: parseFloat(formatEther(bal)).toFixed(6),
          healthPercent: hp, isRefuelNeeded: bal < BigInt(3e15), checkedAt: Date.now(),
        }));
      } catch { /* RPC down */ }
    };
    fetchBal();
    const t = setInterval(fetchBal, 15_000);
    return () => clearInterval(t);
  }, [engineOnline, refereeAddress]);

  const resetRuntimeTournamentRefs = useCallback(() => {
    simCleanupRef.current.forEach(c => c());
    simCleanupRef.current.clear();
    bracketProcessedRef.current.clear();
    championTriggeredRef.current = false;
  }, []);

  // -- Tournament phase transitions --------------------------------------------
  const startPreseason = useCallback((nextSeasonNumber = seasonNumber) => {
    const archiveFixtures = fixtures
      .filter(fixture => ['R16', 'QF', 'SF', '3PL', 'F'].includes(fixture.round ?? ''))
      .sort((a, b) => preseasonArchiveRank(b) - preseasonArchiveRank(a) || a.id.localeCompare(b.id));
    const nextArchive = champion && archiveFixtures.length > 0
      ? {
        seasonNumber,
        champion,
        fixtures: archiveFixtures,
        matchStates: Object.fromEntries(
          Object.entries(matchStates).filter(([fixtureId]) => archiveFixtures.some(fixture => fixture.id === fixtureId))
        ),
      }
      : previousKnockoutResults;
    const nextWinners = champion
      ? [...seasonWinners.filter(item => item.seasonNumber !== seasonNumber), { seasonNumber, team: champion }].slice(-12)
      : seasonWinners;
    resetRuntimeTournamentRefs();
    const endsAt = Date.now() + seasonTiming.preseasonSeconds * 1000;
    setSeasonNumber(nextSeasonNumber);
    setMatchStates({});
    setFixtures(createSeasonFixtures(nextSeasonNumber));
    setEliminatedTeams(new Set());
    setChampion(null);
    setPreviousKnockoutResults(nextArchive);
    setSeasonWinners(nextWinners);
    setTournamentGen(g => g + 1);
    setRoundFilter('all');
    setWatchingId(null);
    setPhase('preseason');
    setPhaseEndsAt(endsAt);
    setPhaseTimer(seasonTiming.preseasonSeconds);
  }, [champion, fixtures, matchStates, previousKnockoutResults, resetRuntimeTournamentRefs, seasonNumber, seasonTiming, seasonWinners]);

  // -- Phase / season timer -----------------------------------------------------
  useEffect(() => {
    if (phase === 'playing' || seasonMode === 'prod') return;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
      setPhaseTimer(remaining);
      if (remaining > 0) return;

      if (phase === 'preseason') {
        setPhase('playing');
        setPhaseTimer(0);
        return;
      }

      if (phase === 'champion') {
        startPreseason(seasonNumber + 1);
        return;
      }

      if (phase === 'interseason') {
        setPhase('playing');
        setPhaseTimer(0);
      }
    };

    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [phase, phaseEndsAt, seasonMode, seasonNumber, startPreseason]);

  useEffect(() => {
    if (phase !== 'playing' || viewMode !== 'simulated') return;
    const t = setInterval(() => setSeasonClockTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase, viewMode]);

  // -- Client-side simulation ---------------------------------------------------
  useEffect(() => {
    if (seasonMode === 'prod') return;
    if (viewMode !== 'simulated' || phase !== 'playing') return;
    fixtures.forEach(fx => {
      if (fx.status !== 'open' && fx.status !== 'locked') return;
      if (fx.home.code === 'TBD' || fx.away.code === 'TBD') return;
      if (!isSeasonFixtureDue(fixtures, fx, phaseEndsAt, matchStates)) return;
      if (simCleanupRef.current.has(fx.id)) return;
      if (matchStates[fx.id]?.status === 'finished') return;
      setFixtures(prev => prev.map(item => item.id === fx.id ? { ...item, status: 'locked' } : item));
      const tickMs = Math.max(250, Math.round(seasonTiming.matchMs / 90));
      const cleanup = simulateMatch(fx, (state) => {
        setMatchStates(prev => ({ ...prev, [fx.id]: state }));
      }, tickMs, matchStates[fx.id]);
      simCleanupRef.current.set(fx.id, cleanup);
    });
  }, [viewMode, phase, fixtures, matchStates, phaseEndsAt, seasonClockTick, seasonTiming, seasonMode]);

  // Seed knockouts after the 12 World Cup groups complete.
  useEffect(() => {
    if (seasonMode === 'prod') return;
    if (viewMode !== 'simulated' || phase !== 'playing') return;
    if (!allGroupMatchesFinished(fixtures, matchStates)) return;
    if (fixtures.some(f => baseFixtureId(f.id) === 'k32-1' && f.home.code !== 'TBD')) return;
    const qualified = new Set(qualifiedTeams(fixtures, matchStates).map(team => team.code));
    const allTeams = new Set(fixtures.filter(isGroupStageFixture).flatMap(f => [f.home.code, f.away.code]));
    setEliminatedTeams(new Set([...allTeams].filter(code => !qualified.has(code))));
    setFixtures(prev => seedRoundOf32(prev, matchStates));
  }, [fixtures, matchStates, viewMode, phase, seasonMode]);

  // Advance knockout bracket when a match finishes.
  useEffect(() => {
    if (seasonMode === 'prod') return;
    if (viewMode !== 'simulated') return;
    Object.entries(matchStates).forEach(([id, ms]) => {
      if (ms.status !== 'finished') return;
      if (bracketProcessedRef.current.has(id)) return;
      bracketProcessedRef.current.add(id);
      setFixtures(prev => {
        const result = advanceKnockout(prev, id, ms);
        if (result.eliminated) setEliminatedTeams(prevSet => new Set([...prevSet, result.eliminated!.code]));
        return result.fixtures;
      });
    });
  }, [matchStates, viewMode, seasonMode]);

  // Detect Final finish -> champion phase
  useEffect(() => {
    if (seasonMode === 'prod') return;
    if (viewMode !== 'simulated' || phase !== 'playing') return;
    const finalFixture = fixtures.find(f => baseFixtureId(f.id) === 'f-1');
    const ms = finalFixture ? matchStates[finalFixture.id] : undefined;
    if (ms?.status !== 'finished') return;
    if (championTriggeredRef.current) return;
    championTriggeredRef.current = true;
    const fx = finalFixture;
    if (!fx) return;
    const winner = ms.penaltyWinner === 'home' ? fx.home
      : ms.penaltyWinner === 'away' ? fx.away
      : ms.homeScore >= ms.awayScore ? fx.home
      : fx.away;
    if (winner.code === 'TBD' || winner.iso === 'tbd') {
      championTriggeredRef.current = false;
      return;
    }
    setChampion(winner);
    setPhase('champion');
    setPhaseEndsAt(Date.now() + 5 * 1000);
    setPhaseTimer(5);
  }, [matchStates, viewMode, phase, fixtures, seasonMode]);

  const showStakeClosedNotice = useCallback((fixtureId: string, reason?: string) => {
    setStakeClosedNotices(prev => ({
      ...prev,
      [fixtureId]: reason ?? 'Stake on the next available match.',
    }));
    window.setTimeout(() => {
      setStakeClosedNotices(prev => {
        const next = { ...prev };
        delete next[fixtureId];
        return next;
      });
    }, 5200);
  }, []);

  const handleStake    = useCallback((fixtureId: string, outcome: Outcome) => {
    const fixture = viewMode === 'realtime'
      ? realtimeFixtures.find(f => f.id === fixtureId)
      : fixtures.find(f => f.id === fixtureId);
    const matchState = matchStates[fixtureId];
    if (!fixture) return false;
    const isRealtimeMarket = fixture.mode === 'realtime';
    if (fixture.status === 'settled' || (!isRealtimeMarket && fixture.status === 'locked')) {
      showStakeClosedNotice(fixtureId, fixture.status === 'settled' ? 'This match has already settled.' : 'Stake on the next available match.');
      return false;
    }
    if (matchState?.status === 'finished' || (!isRealtimeMarket && (matchState?.status === 'live' || matchState?.status === 'half_time'))) {
      showStakeClosedNotice(fixtureId, matchState?.status === 'finished' ? 'This match has finished.' : 'Stake on the next available match.');
      return false;
    }
    void outcome;
    return true;
  }, [fixtures, matchStates, realtimeFixtures, showStakeClosedNotice, viewMode]);
  const dismissSettlementNotice = useCallback((s: SettlementResult) => {
    setDismissedSettlementNotices(prev => {
      const next = new Set(prev);
      next.add(settlementKey(s));
      return next;
    });
  }, []);
  const handleWatch    = useCallback((fixtureId: string) => {
    setWatchingId(fixtureId);
    const endpoint = viewMode === 'realtime'
      ? `${BACKEND_HTTP}/worldcup/match/${encodeURIComponent(fixtureId)}`
      : `${BACKEND_HTTP}/season/match/${encodeURIComponent(fixtureId)}?mode=${seasonMode}`;
    fetch(endpoint)
      .then(r => r.ok ? r.json() : null)
      .then((res: { fixture?: Fixture; matchState?: MatchState | null } | null) => {
        if (!res) return;
        if (res.fixture) {
          watchedFixtureRef.current[fixtureId] = res.fixture;
          if (viewMode === 'realtime') {
            setRealtimeFixtures(prev => prev.map(fixture => fixture.id === res.fixture!.id ? res.fixture! : fixture));
          } else {
            setFixtures(prev => prev.map(fixture => fixture.id === res.fixture!.id ? res.fixture! : fixture));
          }
        }
        if (res.matchState) {
          watchedStateRef.current[fixtureId] = res.matchState;
          setMatchStates(prev => viewMode === 'realtime'
            ? { ...prev, [fixtureId]: res.matchState! }
            : mergeLiveMatchStates(prev, { ...prev, [fixtureId]: res.matchState! }));
        }
      })
      .catch(() => {});
  }, [seasonMode, viewMode]);
  const resetTestSeason = useCallback(() => {
    if (seasonMode !== 'test') return;
    const fresh = freshSeasonState(1, Date.now(), TEST_SEASON_TIMING, 'test');
    applySeasonSnapshot(fresh, 'test');
    fetch(`${BACKEND_HTTP}/season/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'test', secret: import.meta.env.VITE_ADMIN_TEST_SECRET ?? '' }),
    }).finally(() => {
      fetch(`${BACKEND_HTTP}/season/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'test', state: fresh }),
      }).catch(() => {});
    });
  }, [applySeasonSnapshot, seasonMode]);

  useEffect(() => {
    watchedStateRef.current = { ...watchedStateRef.current, ...matchStates };
  }, [matchStates]);

  const watchingFixture = watchingFixtureId
    ? realtimeFixtures.find(f => f.id === watchingFixtureId) ?? fixtures.find(f => f.id === watchingFixtureId) ?? watchedFixtureRef.current[watchingFixtureId] ?? null
    : null;
  const watchingMatchState = watchingFixtureId
    ? richerMatchState(matchStates[watchingFixtureId], watchedStateRef.current[watchingFixtureId])
    : null;

  useEffect(() => {
    if (!watchingFixtureId || !watchingFixture) return;
    watchedFixtureRef.current[watchingFixtureId] = watchingFixture;
  }, [watchingFixtureId, watchingFixture]);

  useEffect(() => {
    if (!watchingFixtureId || viewMode !== 'simulated') return;
    let cancelled = false;
    const loadWatchedMatch = () => {
      fetch(`${BACKEND_HTTP}/season/match/${encodeURIComponent(watchingFixtureId)}?mode=${seasonMode}`)
        .then(r => r.ok ? r.json() : null)
        .then((res: { fixture?: Fixture; matchState?: MatchState | null } | null) => {
          if (cancelled || !res) return;
          if (res.fixture) {
            watchedFixtureRef.current[watchingFixtureId] = res.fixture;
            setFixtures(prev => prev.map(fixture => fixture.id === res.fixture!.id ? res.fixture! : fixture));
          }
          if (res.matchState) {
            watchedStateRef.current[watchingFixtureId] = res.matchState;
            setMatchStates(prev => ({ ...prev, [watchingFixtureId]: res.matchState! }));
          }
        })
        .catch(() => {});
    };
    loadWatchedMatch();
    const timer = setInterval(loadWatchedMatch, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [seasonMode, viewMode, watchingFixtureId]);

  useEffect(() => {
    if (!watchingFixtureId || viewMode !== 'realtime') return;
    let cancelled = false;
    const loadWatchedMatch = () => {
      fetch(`${BACKEND_HTTP}/worldcup/match/${encodeURIComponent(watchingFixtureId)}`)
        .then(r => r.ok ? r.json() : null)
        .then((res: { fixture?: Fixture; matchState?: MatchState | null } | null) => {
          if (cancelled || !res) return;
          if (res.fixture) {
            watchedFixtureRef.current[watchingFixtureId] = res.fixture;
            setRealtimeFixtures(prev => prev.map(fixture => fixture.id === res.fixture!.id ? res.fixture! : fixture));
          }
          if (res.matchState) {
            watchedStateRef.current[watchingFixtureId] = res.matchState;
            setMatchStates(prev => ({ ...prev, [watchingFixtureId]: res.matchState! }));
          }
        })
        .catch(() => {});
    };
    loadWatchedMatch();
    const timer = setInterval(loadWatchedMatch, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [viewMode, watchingFixtureId]);

  const worldCupFeedReady = viewMode === 'realtime'
    && Array.isArray(realtimeFixtures)
    && realtimeFixtures.length > 0
    && worldCupFeed?.providerConfigured !== false;
  const worldCupLiveDataActive = viewMode === 'realtime' && worldCupFeed?.mode === 'live';
  const simFixtures    = viewMode === 'simulated' ? fixtures : worldCupFeedReady ? realtimeFixtures : [];
  const rtGroups       = Array.from(new Set(simFixtures.filter(f => !f.round).map(f => f.group))).sort();
  const realtimeTabs = [
    { id: 'live', label: 'Live', tone: 'live' },
    ...rtGroups.map(g => ({ id: g, label: g, tone: 'group' })),
    { id: 'knockouts', label: 'Knockouts', tone: 'knockout' },
    { id: 'R32', label: 'R32', tone: 'knockout' },
    { id: 'R16', label: 'R16', tone: 'knockout' },
    { id: 'QF', label: 'QF', tone: 'knockout' },
    { id: 'SF', label: 'SF', tone: 'knockout' },
    { id: '3PL', label: '3rd', tone: 'knockout' },
    { id: 'F', label: 'Final', tone: 'knockout' },
    { id: 'bracket', label: 'Bracket', tone: 'bracket' },
  ];
  const projectMatchState = useCallback((state?: MatchState): MatchState | undefined => {
    if (!state || state.status !== 'live') return state;
    const fixture = fixtures.find(item => item.id === state.fixtureId);
    if (fixture?.mode !== 'simulated') return state;
    const kickoffMs = parseProviderTime(state.simulatedKickoff);
    if (!Number.isFinite(kickoffMs)) return state;
    const minuteMs = Math.max(1000, Math.round(seasonTiming.matchMs / 90));
    const projectedMinute = Math.min(89, Math.max(Math.min(state.minute, 89), Math.floor((Date.now() - kickoffMs) / minuteMs)));
    return projectedMinute === state.minute ? state : { ...state, minute: projectedMinute };
  }, [fixtures, liveUiTick, seasonTiming.matchMs]);
  const displayMatchStates = Object.fromEntries(
    Object.entries(matchStates).map(([id, state]) => [id, projectMatchState(state) ?? state])
  ) as Record<string, MatchState>;

  useEffect(() => {
    let cancelled = false;

    const refreshAccountValue = async () => {
      let address: string | null = null;
      try {
        address = window.localStorage.getItem(LAST_WALLET_KEY);
      } catch {
        address = null;
      }

      if (!address) {
        setAccountValueLabel('$0.00');
        return;
      }

      try {
        const [balanceWei, positionsResponse] = await Promise.all([
          rpcClient.getBalance({ address: address as `0x${string}` }),
          fetch(`${BACKEND_HTTP}/positions/${address}`),
        ]);
        if (!positionsResponse.ok) throw new Error(`positions ${positionsResponse.status}`);
        const data = await positionsResponse.json() as { positions?: UserPosition[] };
        const openExposureWei = (data.positions ?? []).reduce((sum, position) => {
          return sum + positionPortfolioWei(position, fixtures, matchStates);
        }, 0n);
        const nextLabel = stripUsdPrefix(formatOkbUsdFromWei(balanceWei + openExposureWei, okbUsd)) ?? '$0.00';
        if (cancelled) return;
        setAccountValueLabel(nextLabel);
      } catch {
        if (cancelled) return;
        setAccountValueLabel(prev => prev || '$0.00');
      }
    };

    refreshAccountValue();
    const timer = window.setInterval(refreshAccountValue, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fixtures, matchStates, okbUsd]);

  const displayWatchingMatchState = watchingMatchState ? projectMatchState(watchingMatchState) ?? watchingMatchState : null;
  const activeGroupMatchday = currentGroupMatchday(simFixtures, matchStates);
  const fixtureRoundFilter = activeTab === 'search' ? roundFilter : 'all';
  const fixtureGroupFilter = viewMode === 'realtime' && (activeTab === 'search' || (activeTab === 'home' && homeCupView === 'matches'))
    ? groupFilter
    : 'all';
  const archivedPreseasonFixtures = viewMode === 'simulated' && phase === 'preseason' && previousKnockoutResults
    ? previousKnockoutResults.fixtures
      .filter(fixture => ['R16', 'QF', 'SF', '3PL', 'F'].includes(fixture.round ?? ''))
      .sort((a, b) => preseasonArchiveRank(b) - preseasonArchiveRank(a) || a.id.localeCompare(b.id))
    : [];
  const archivedPreseasonMatchStates = viewMode === 'simulated' && phase === 'preseason' && previousKnockoutResults
    ? previousKnockoutResults.matchStates
    : {};
  const visibleMatchStates = activeTab === 'home' && archivedPreseasonFixtures.length > 0
    ? archivedPreseasonMatchStates
    : displayMatchStates;
  const liveOrCurrentRealtimeFixtures = [...simFixtures]
    .filter(fixture => isResolvedFixture(fixture))
    .sort((a, b) => {
      const aTime = parseProviderTime(a.kickoff);
      const bTime = parseProviderTime(b.kickoff);
      return (Number.isFinite(aTime) ? aTime : Number.MAX_SAFE_INTEGER)
        - (Number.isFinite(bTime) ? bTime : Number.MAX_SAFE_INTEGER);
    });
  const realtimeActiveMatchday = viewMode === 'realtime'
    ? liveOrCurrentRealtimeFixtures[0]?.matchday
      ?? Math.max(1, ...simFixtures.map(fixture => fixture.matchday))
    : 1;
  const currentRealtimeFixtures = simFixtures.filter(fixture =>
    isResolvedFixture(fixture)
    && (
      viewMode === 'realtime'
      || fixture.matchday === realtimeActiveMatchday
      || visibleMatchStates[fixture.id]?.status === 'live'
      || visibleMatchStates[fixture.id]?.status === 'half_time'
    )
  );
  const homeSeasonFixtures = simFixtures.filter(f =>
    isResolvedFixture(f) &&
    (isGroupStageFixture(f) || !!f.round)
  );
  const baseVisibleFixtures = viewMode === 'simulated'
    ? (activeTab === 'home'
      ? (phase === 'preseason' && archivedPreseasonFixtures.length > 0 ? archivedPreseasonFixtures : homeSeasonFixtures)
      : fixtureRoundFilter === 'all'
      ? (phase === 'preseason' ? [] : simFixtures.filter(f => isGroupStageFixture(f) && f.matchday === activeGroupMatchday))
      : fixtureRoundFilter.startsWith('md')
        ? simFixtures.filter(f => isGroupStageFixture(f) && f.matchday === Number(fixtureRoundFilter.replace('md', '')))
      : fixtureRoundFilter === 'knockouts'
        ? simFixtures.filter(f => !!f.round)
        : SEASON_GROUPS.includes(fixtureRoundFilter)
          ? simFixtures.filter(f => f.group === fixtureRoundFilter && isGroupStageFixture(f))
          : simFixtures)
    : fixtureGroupFilter === 'live' || (activeTab === 'home' && fixtureGroupFilter === 'all')
      ? currentRealtimeFixtures
      : SEASON_GROUPS.includes(fixtureGroupFilter)
        ? simFixtures.filter(f => f.group === fixtureGroupFilter && !f.round)
        : fixtureGroupFilter === 'knockouts'
          ? []
          : ['R32', 'R16', 'QF', 'SF', '3PL', 'F'].includes(fixtureGroupFilter)
            ? []
            : fixtureGroupFilter === 'bracket'
              ? []
              : simFixtures;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleFixtures = activeTab === 'search' && normalizedSearchQuery
    ? baseVisibleFixtures.filter(fixture => [
        fixture.home.name,
        fixture.home.code,
        fixture.away.name,
        fixture.away.code,
        fixture.group,
        fixture.round ?? '',
        fixture.venue,
      ].some(value => value.toLowerCase().includes(normalizedSearchQuery)))
    : baseVisibleFixtures;
  const realtimeFixtureRank = (fixture: Fixture) => {
    const state = visibleMatchStates[fixture.id];
    if (state?.status === 'live' || state?.status === 'half_time' || fixture.status === 'locked') return 0;
    if (state?.status === 'finished' || fixture.status === 'settled') return 2;
    return 1;
  };
  const realtimeFixtureTime = (fixture: Fixture) => {
    const state = visibleMatchStates[fixture.id];
    const rawTime = state?.status === 'finished' && state.finishedAt ? state.finishedAt : parseProviderTime(fixture.kickoff);
    return Number.isFinite(rawTime) ? rawTime : 0;
  };
  const orderedVisibleFixtures = activeTab === 'home' && viewMode === 'simulated'
    ? [...visibleFixtures].sort((a, b) => {
      const latestEventMinute = (fixture: Fixture) => {
        const events = visibleMatchStates[fixture.id]?.events ?? [];
        return events.length ? Math.max(...events.map(event => event.minute ?? 0)) : visibleMatchStates[fixture.id]?.minute ?? 0;
      };
      const stateRank = (fixture: Fixture) => {
        const state = visibleMatchStates[fixture.id];
        if (state?.status === 'live' || state?.status === 'half_time' || fixture.status === 'locked') return 0;
        if (state?.status === 'finished' || fixture.status === 'settled') return 1;
        if (fixture.status === 'open') return 2;
        return 3;
      };
      const rankDiff = stateRank(a) - stateRank(b);
      if (rankDiff !== 0) return rankDiff;
      const aState = visibleMatchStates[a.id];
      const bState = visibleMatchStates[b.id];
      if ((aState?.status === 'live' || aState?.status === 'half_time' || a.status === 'locked') && (bState?.status === 'live' || bState?.status === 'half_time' || b.status === 'locked')) {
        return latestEventMinute(b) - latestEventMinute(a) || b.matchday - a.matchday || b.id.localeCompare(a.id);
      }
      if ((aState?.status === 'finished' || a.status === 'settled') && (bState?.status === 'finished' || b.status === 'settled')) {
        return b.matchday - a.matchday || b.id.localeCompare(a.id);
      }
      return a.matchday - b.matchday || a.id.localeCompare(b.id);
    })
    : viewMode === 'realtime'
      ? [...visibleFixtures].sort((a, b) => {
        const aRank = realtimeFixtureRank(a);
        const bRank = realtimeFixtureRank(b);
        const rankDiff = aRank - bRank;
        if (rankDiff !== 0) return rankDiff;
        if (aRank === 0) {
          const aMinute = visibleMatchStates[a.id]?.minute ?? 0;
          const bMinute = visibleMatchStates[b.id]?.minute ?? 0;
          return bMinute - aMinute || a.matchday - b.matchday || a.id.localeCompare(b.id);
        }
        if (aRank === 2) {
          return realtimeFixtureTime(b) - realtimeFixtureTime(a) || b.matchday - a.matchday || b.id.localeCompare(a.id);
        }
        return realtimeFixtureTime(a) - realtimeFixtureTime(b) || a.matchday - b.matchday || a.id.localeCompare(b.id);
      })
    : visibleFixtures;
  const selectedGroupFixtures = activeTab === 'search' && viewMode === 'realtime' && SEASON_GROUPS.includes(fixtureGroupFilter)
    ? simFixtures.filter(f => f.group === fixtureGroupFilter)
    : [];
  const selectedGroupResults = selectedGroupFixtures.filter(f => matchStates[f.id]?.status === 'finished');
  const simulatedFixtureSectionLabel = viewMode === 'simulated'
    ? fixtureRoundFilter === 'all'
      ? (phase === 'preseason' && activeTab === 'home' && archivedPreseasonFixtures.length > 0
        ? `Season ${previousKnockoutResults?.seasonNumber ?? Math.max(1, seasonNumber - 1)} Knockout Results`
        : `Matchday ${activeGroupMatchday} Fixtures`)
      : fixtureRoundFilter.startsWith('md')
        ? `Matchday ${fixtureRoundFilter.replace('md', '')} Fixtures`
        : fixtureRoundFilter === 'knockouts'
          ? 'Knockout Fixtures'
          : SEASON_GROUPS.includes(fixtureRoundFilter)
            ? `Group ${fixtureRoundFilter} Fixtures`
            : 'Season Fixtures'
    : '';
  const showPreseasonSearchLiveEmpty = activeTab === 'search'
    && viewMode === 'simulated'
    && phase === 'preseason'
    && fixtureRoundFilter === 'all';

  const healthColor = metabolism.isRefuelNeeded
    ? 'dark:text-red-400 text-red-600'
    : metabolism.healthPercent < 40
    ? 'dark:text-blue-300 text-blue-600'
    : 'dark:text-emerald-400 text-emerald-600';

  const seasonLabel = `World Cup Season ${seasonNumber}`;
  const seasonStartsAt = new Date(Date.now() + phaseTimer * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const seasonStartedAt = phase === 'playing' ? phaseEndsAt : Date.now() + phaseTimer * 1000;
  const liveEntries = viewMode === 'simulated'
    ? Object.entries(matchStates).filter(([id, ms]) => ms.status === 'live' && isResolvedFixture(fixtures.find(f => f.id === id)))
    : [];
  const primaryLiveFixture = liveEntries.length > 0
    ? [...liveEntries]
      .map(([id]) => fixtures.find(f => f.id === id) ?? null)
      .filter((fixture): fixture is Fixture => !!fixture)
      .sort((a, b) => liveStageRank(b) - liveStageRank(a) || b.matchday - a.matchday || b.id.localeCompare(a.id))[0] ?? null
    : [...fixtures]
      .filter(f => (f.status === 'locked' || f.status === 'open') && isResolvedFixture(f))
      .sort((a, b) => liveStageRank(b) - liveStageRank(a) || a.matchday - b.matchday || a.id.localeCompare(b.id))[0] ?? null;
  const liveSeasonStageLabel = fixtureStageLabel(primaryLiveFixture, activeGroupMatchday);
  const liveSeasonStageCode = fixtureStageCode(primaryLiveFixture, activeGroupMatchday);
  const finishedSeasonEntries = viewMode === 'simulated'
    ? Object.entries(matchStates).filter(([id, ms]) => ms.status === 'finished' && isResolvedFixture(fixtures.find(f => f.id === id)))
    : [];
  const finishedSeasonCount = viewMode === 'simulated'
    ? finishedSeasonEntries.length
    : 0;
  const seasonStatusDetail = phase === 'preseason'
    ? `Kick-off in ${fmtDuration(phaseTimer)}`
    : phase === 'interseason'
      ? `Next season in ${fmtDuration(phaseTimer)}`
      : phase === 'champion'
        ? 'Final settled'
        : `${liveSeasonStageLabel} live`;
  const seasonStatusAccent = phase === 'playing'
    ? `${liveEntries.length} live - ${finishedSeasonCount} FT`
    : phase === 'preseason'
      ? 'Staking open'
      : 'Broadcast reset';
  const liveRailEntries = liveEntries.length > 1 ? [...liveEntries, ...liveEntries] : liveEntries;
  const worldCupLiveEntries = worldCupLiveDataActive
    ? Object.entries(matchStates).filter(([, state]) => state.status === 'live' || state.status === 'half_time')
    : [];
  const worldCupLiveRailEntries = worldCupLiveEntries.length > 1
    ? [...worldCupLiveEntries, ...worldCupLiveEntries]
    : worldCupLiveEntries;
  const matchdayPrizeTeams = Array.from(new Map(
    simFixtures
      .filter(fixture => fixture.status !== 'settled')
      .flatMap(fixture => [fixture.home, fixture.away])
      .filter(team => team.code !== 'TBD' && team.iso !== 'tbd')
      .map(team => [team.code, team])
  ).values()).slice(0, 8);
  const settlementNoticeItems = [...settlements]
    .reverse()
    .map((settlement) => {
      const fixture = fixtures.find(f => f.id === settlement.fixtureId)
        ?? null;
      const matchState = matchStates[settlement.fixtureId];
      return { settlement, fixture, matchState };
    })
    .filter(({ settlement, fixture, matchState }) => {
      const isFresh = settlementNoticeTick - settlementTimeMs(settlement) <= SETTLEMENT_NOTICE_MS;
      const wasDismissed = dismissedSettlementNotices.has(settlementKey(settlement));
      const hasSettledFixture = fixture?.status === 'settled';
      const hasFinishedMatch = matchState?.status === 'finished';
      return !!fixture
        && isFresh
        && !wasDismissed
        && settlementHasPayoutForAddress(settlement, settlementWalletAddress)
        && !!settlement.explorerUrl
        && (hasSettledFixture || hasFinishedMatch);
    });
  const activeSettlementNotice = settlementNoticeItems.length > 0
    ? settlementNoticeItems[Math.floor(settlementNoticeTick / 5000) % settlementNoticeItems.length]
    : null;
  const settledFixtureIds = new Set(settlements.map(settlement => settlement.fixtureId));
  const proofPlatformVolumeWei = Object.values(pools).reduce((sum, pool) => {
    try {
      if (settledFixtureIds.has(pool.fixtureId)) return sum;
      return sum + BigInt(pool.home) + BigInt(pool.draw) + BigInt(pool.away) + BigInt(pool.fees);
    } catch {
      return sum;
    }
  }, settlements.reduce((sum, settlement) => {
    try {
      return sum + BigInt(settlement.totalPool);
    } catch {
      return sum;
    }
  }, 0n));
  const proofPoolUsd = formatOkbUsdFromWei(proofPlatformVolumeWei, okbUsd);
  const reserveUsd = formatOkbUsd(metabolism.okbBalanceFormatted, okbUsd);
  const proofStakeTxs = logs
    .filter(log => log.prefix === 'STAKE' && !!log.txHash)
    .slice(-5)
    .reverse();
  const proofPayoutTxs = settlements
    .flatMap(settlement => settlement.payouts.map(payout => ({
      fixtureId: settlement.fixtureId,
      amountWei: payout.amountWei,
      txHash: payout.txHash,
    })))
    .filter(payout => !!payout.txHash)
    .slice(-5)
    .reverse();
  const payoutSettlementCount = settlements.filter(settlement => {
    try {
      return BigInt(settlement.totalPool) > 0n || settlement.payouts.length > 0;
    } catch {
      return settlement.payouts.length > 0;
    }
  }).length;
  const displayedSeasonWinners = seasonWinners;
  const worldCupSourceLabel = worldCupFeed?.mode === 'live'
    ? worldCupFeed.source === 'sportmonks'
      ? 'Sportmonks fixture feed'
      : 'Live fixture feed'
    : worldCupFeedReady
      ? 'Provider-backed fixture board'
      : 'Sportmonks fixture feed';
  const worldCupFreshness = worldCupFeed
    ? worldCupFeed.mode === 'live'
      ? `updated ${worldCupFeed.freshnessSeconds}s ago`
      : worldCupFeedReady
        ? 'fixtures available'
        : 'awaiting provider'
    : 'updating';
  const appTabs: Array<{ id: AppTab; label: string; icon: typeof Home }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'news', label: 'News', icon: Newspaper },
    { id: 'portfolio', label: accountValueLabel || '$0.00', icon: BriefcaseBusiness },
  ];

  return (
    <div className="min-h-screen dark:bg-black bg-zinc-50 dark:text-zinc-100 text-zinc-900 font-sans">
      <audio ref={themeAudioRef} src={FRANCE_26_THEME} autoPlay loop preload="auto" />

      {/* -- Header ----------------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/95 bg-white/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4">

          {/* Brand */}
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={FANVIBE_HERO_LOGO}
              alt="FanVibe"
              className="h-8 w-8 rounded-md object-cover ring-1 ring-black/10 dark:ring-white/10"
            />
            <span className="truncate text-sm sm:text-base font-extrabold tracking-tight">
              <span className="dark:text-zinc-100 text-black">Fan</span>
              <span className="text-blue-600 dark:text-blue-400">
                Vib
                <span className="brand-e-cycle" aria-label="e">
                  <span className="brand-e-letter">e</span>
                  <img src={BRAND_E_IMAGE} alt="" aria-hidden="true" />
                </span>
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleSound}
              aria-label={soundMuted ? 'Unmute theme song' : 'Mute theme song'}
              title={soundMuted ? 'Unmute theme song' : 'Mute theme song'}
              className="relative w-9 h-9 flex items-center justify-center rounded-lg border transition-all duration-200
                dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 dark:hover:border-zinc-600
                border-zinc-300 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 hover:border-zinc-400"
            >
              {soundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <ThemeSwitcher dark={dark} onToggle={() => setDark(d => !d)} />
          </div>
        </div>
      </header>

      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/95 bg-white/95 px-3 py-2 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {appTabs.map(tab => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex h-12 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-bold transition-colors ${
                  selected
                    ? 'dark:bg-blue-500/15 bg-blue-50 dark:text-blue-300 text-blue-700'
                    : 'dark:text-zinc-500 text-zinc-500 dark:hover:text-zinc-200 hover:text-zinc-900'
                }`}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <aside className="fixed left-4 top-20 z-30 hidden w-20 rounded-2xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/95 bg-white/95 p-2 shadow-sm backdrop-blur lg:block">
        <div className="space-y-1">
          {appTabs.map(tab => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
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
          <a
            href="/docs"
            title="Docs"
            className="flex w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-[11px] font-bold transition-colors dark:text-zinc-500 text-zinc-500 dark:hover:bg-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-200 hover:text-zinc-900"
          >
            <BookOpen size={18} />
            <span>Docs</span>
          </a>
        </div>
      </aside>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24 space-y-6 lg:pl-28">

        {/* -- Mode toggle ------------------------------------------------- */}
        {(activeTab === 'home' || activeTab === 'search') && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {simulationModeVisible ? (
            <div className="flex items-center gap-1 p-1 dark:bg-zinc-900 bg-zinc-100 rounded-xl border dark:border-zinc-800 border-zinc-200">
              <button
                onClick={() => setViewMode('simulated')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200
                  ${viewMode === 'simulated'
                    ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200 shadow-sm'
                    : 'dark:text-zinc-400 text-zinc-500 dark:hover:text-zinc-200 hover:text-zinc-700'}`}
              >
                Season Play
              </button>
              <button
                onClick={() => setViewMode('realtime')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200
                  ${viewMode === 'realtime'
                    ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200 shadow-sm'
                    : 'dark:text-zinc-400 text-zinc-500 dark:hover:text-zinc-200 hover:text-zinc-700'}`}
              >
                <Globe size={13} />
                World Cup 2026
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-xl border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-900 bg-zinc-100 p-1 shadow-sm">
              <button
                type="button"
                onClick={() => {
                  setHomeCupView('matches');
                  setViewMode('realtime');
                }}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-200 ${
                  homeCupView === 'matches'
                    ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200 shadow-sm'
                    : 'dark:text-zinc-400 text-zinc-500 dark:hover:text-zinc-200 hover:text-zinc-700'
                }`}
              >
                <Globe size={14} />
                World Cup Matches
              </button>
              <button
                type="button"
                onClick={() => {
                  setHomeCupView('leaderboard');
                  setActiveTab('home');
                  setViewMode('realtime');
                }}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-200 ${
                  homeCupView === 'leaderboard'
                    ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200 shadow-sm'
                    : 'dark:text-zinc-400 text-zinc-500 dark:hover:text-zinc-200 hover:text-zinc-700'
                }`}
              >
                <Trophy size={14} />
                Matchday leaderboard
              </button>
            </div>
          )}

          {viewMode === 'simulated' && simulationModeVisible && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 p-1 dark:bg-zinc-900 bg-zinc-100 rounded-xl border dark:border-zinc-800 border-zinc-200">
                <button
                  onClick={() => setSeasonMode('prod')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    seasonMode === 'prod'
                      ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200'
                      : 'dark:text-zinc-500 text-zinc-500 dark:hover:text-zinc-300 hover:text-zinc-700'
                  }`}
                >
                  Persistent
                </button>
                <button
                  onClick={() => setSeasonMode('test')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    seasonMode === 'test'
                      ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200'
                      : 'dark:text-zinc-500 text-zinc-500 dark:hover:text-zinc-300 hover:text-zinc-700'
                  }`}
                >
                  Test
                </button>
              </div>
              {seasonMode === 'test' && (
                <button
                  onClick={() => setSeasonAdminOpen(v => !v)}
                  className="rounded-lg border dark:border-zinc-800 border-zinc-200 px-3 py-2 text-xs font-bold dark:text-zinc-400 text-zinc-600 dark:hover:text-zinc-200 hover:text-zinc-900 transition-colors"
                >
                  Admin
                </button>
              )}
            </div>
          )}

          <div className="hidden sm:flex items-center gap-2 rounded-full border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950 bg-white px-3 py-1.5 shadow-sm">
            {viewMode === 'simulated' ? (
              seasonHydrated ? (
              <>
                <span className="text-[11px] font-bold tracking-tight dark:text-white text-zinc-950">{seasonLabel}</span>
                <span className="season-status-rotate text-[11px] font-semibold dark:text-zinc-300 text-zinc-600">
                  <span>{seasonStatusDetail}</span>
                  <span>{seasonStatusAccent}</span>
                  <span>{seasonLabel}</span>
                </span>
                <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-300">
                  {phase === 'playing' ? liveSeasonStageCode : fmtDuration(phaseTimer)}
                </span>
                <span className="text-[10px] font-semibold dark:text-zinc-600 text-zinc-400">
                  Live season
                </span>
              </>
              ) : null
            ) : (
              <>
                <span className="text-[11px] font-bold dark:text-white text-zinc-950">{homeCupView === 'leaderboard' ? 'Matchday leaderboard' : 'World Cup Matches'}</span>
                <span className="text-[11px] font-semibold dark:text-zinc-400 text-zinc-500">{worldCupSourceLabel} - {worldCupFreshness}</span>
              </>
            )}
          </div>
        </div>
        )}

        {activeTab === 'home' && homeCupView === 'matches' && (
          <section
            className="fanvibe-live-panel rounded-lg border border-white/10 p-3 shadow-sm sm:p-4"
            style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}
          >
            <div className="relative z-10 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.14em] text-blue-100/95">
                  <Trophy size={15} />
                  FVB Matchday Cup
                </div>
                <div className="mt-2 flex max-w-2xl flex-wrap items-center gap-2">
                  <p className="min-w-[220px] flex-1 text-sm leading-5 text-zinc-200/90">
                    Stake OKB on real World Cup fixtures, hold $FVB with the same wallet, and climb the fan leaderboard. $FVB is FanVibe's World Cup token on X Layer.
                  </p>
                  <a
                    href={FANVIBE_TOKEN_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-white px-2.5 text-[11px] font-bold text-zinc-950 transition-colors hover:bg-zinc-200"
                  >
                    Buy $FVB
                    <ExternalLink size={10} />
                  </a>
                </div>
                <div className="mt-2 inline-flex items-baseline gap-1.5 text-white">
                  <span className="text-2xl font-semibold leading-none">$200</span>
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-zinc-300">Prize Pool</span>
                </div>

                <div className="mt-3 space-y-1.5">
                  {[
                    ['1', 'Stake OKB on live matches'],
                    ['2', 'Hold $FVB in the same wallet'],
                    ['3', 'Win, stay active, climb the board'],
                  ].map(([step, title]) => (
                    <div key={step} className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-blue-500 text-[10px] font-black text-white">{step}</span>
                      <span>{title}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex items-center gap-2 pl-7">
                  <div className="matchday-prize-orb" aria-hidden="true">
                    <img src={FANVIBE_TOKEN_LOGO} alt="" className="matchday-prize-ball" />
                    <div className="matchday-prize-flags">
                      {matchdayPrizeTeams.map(team => {
                        const flag = flagUrl(team.iso);
                        return flag ? <img key={team.code} src={flag} alt="" /> : null;
                      })}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-zinc-300">
                    <div className="leading-none"><span>1st</span><span className="ml-1 text-xs font-bold text-white">$100</span></div>
                    <div className="leading-none"><span>2nd</span><span className="ml-1 text-xs font-bold text-white">$60</span></div>
                    <div className="leading-none"><span>3rd</span><span className="ml-1 text-xs font-bold text-white">$30</span></div>
                    <div className="leading-none"><span>Wildcard</span><span className="ml-1 text-xs font-bold text-white">$10</span></div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'home' && homeCupView === 'matches' && viewMode === 'realtime' && (
          <div className="flex items-center gap-2 overflow-x-auto rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/80 bg-white p-1.5 shadow-sm scrollbar-none">
            {realtimeTabs.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setGroupFilter(t.id)}
                className={`season-filter-tab shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-150
                  ${groupFilter === t.id
                    ? t.tone === 'live'
                      ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200 shadow-sm'
                      : t.tone === 'group'
                        ? 'dark:bg-blue-500 bg-blue-600 text-white shadow-sm'
                        : 'bg-rose-600 text-white shadow-sm'
                    : 'dark:text-zinc-400 text-zinc-500 border dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-300 dark:hover:text-zinc-100 hover:text-zinc-900 dark:bg-zinc-900/35 bg-zinc-50'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'home' && homeCupView === 'leaderboard' && (
          <MatchdayCupLeaderboard
            okbUsd={okbUsd}
            address={settlementWalletAddress}
            onOpenWorldCup={() => {
              setHomeCupView('matches');
              setViewMode('realtime');
            }}
          />
        )}

        {activeTab === 'home' && homeCupView === 'matches' && viewMode === 'realtime' && worldCupLiveEntries.length > 0 && (
          <div
            className="fanvibe-live-panel rounded-lg border border-white/10 p-3 shadow-sm"
            style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}
          >
            <div className="relative z-10 flex items-center justify-between gap-3 pb-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-extrabold tracking-[0.18em] text-blue-100/90">
                  <Radio size={12} />
                  LIVE MATCH STRIP
                </div>
                <div className="mt-0.5 text-sm font-semibold text-white">
                  {worldCupLiveEntries.length} live World Cup {worldCupLiveEntries.length === 1 ? 'match' : 'matches'}
                </div>
              </div>
              <div className="rounded-md border border-white/10 bg-black/35 px-3 py-1.5 text-right backdrop-blur-[2px]">
                <div className="text-[10px] font-bold uppercase text-zinc-300">Feed</div>
                <div className="text-xs font-semibold text-white">{worldCupFreshness}</div>
              </div>
            </div>

            <div className="live-score-mask relative z-10 overflow-hidden">
              <div className={worldCupLiveEntries.length > 2 ? 'live-score-track flex items-center gap-2' : 'flex items-center gap-2'}>
                {worldCupLiveRailEntries.map(([id, ms], index) => {
                  const fx = realtimeFixtures.find(f => f.id === id);
                  if (!fx) return null;
                  return (
                    <button
                      key={`${id}-${index}`}
                      onClick={() => setGroupFilter('live')}
                      className="live-score-card shrink-0 flex items-center gap-2 rounded-lg border border-white/12 px-3 py-2 text-white shadow-sm backdrop-blur-[2px] transition-all hover:border-blue-300/60 active:scale-95"
                      style={{
                        '--home-flag': `url(${flagUrl(fx.home.iso)})`,
                        '--away-flag': `url(${flagUrl(fx.away.iso)})`,
                      } as React.CSSProperties}
                    >
                      <span className="relative z-10 text-sm">{fx.home.flag}</span>
                      <span className="relative z-10 min-w-[2.1rem] text-xs font-extrabold">{fx.home.code}</span>
                      <span className="relative z-10 rounded bg-blue-500/95 px-1.5 py-0.5 text-[11px] font-black tabular-nums text-white shadow-sm">{ms.homeScore}-{ms.awayScore}</span>
                      <span className="relative z-10 min-w-[2.1rem] text-xs font-extrabold">{fx.away.code}</span>
                      <span className="relative z-10 text-sm">{fx.away.flag}</span>
                      <span className="relative z-10 text-[11px] font-bold tabular-nums text-blue-100">{ms.minute}&apos;</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'home' && viewMode === 'simulated' && seasonMode === 'test' && seasonAdminOpen && (
          <div className="rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/60 bg-white px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs font-bold dark:text-zinc-200 text-zinc-800">Admin test season</div>
              <div className="mt-0.5 text-[11px] dark:text-zinc-500 text-zinc-500">
                1 min preseason - 1 min matches - 1 min gaps - isolated from persistent production state.
              </div>
            </div>
            <button
              onClick={resetTestSeason}
              className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-600 dark:text-blue-300 hover:bg-blue-500/15 transition-colors"
            >
              Refresh Test State
            </button>
          </div>
        )}

        {/* -- Season live dashboard --------------------------------------- */}
        {activeTab === 'home' && viewMode === 'simulated' && seasonHydrated && (phase === 'preseason' || phase === 'playing') && (
          <div
            className="fanvibe-live-panel rounded-lg border border-white/10 p-4 shadow-sm"
            style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}
          >
            {phase === 'preseason' ? (
              <div className="relative z-10 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-sm font-semibold text-white mb-0.5 drop-shadow-sm">{seasonLabel} - Staking Open</div>
                  <div className="text-xs text-zinc-200/90">
                    First fixture window begins at {seasonStartsAt}. Open match groups to stake before kick-off.
                  </div>
                  {previousKnockoutResults?.champion && (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 backdrop-blur-[2px]">
                      {flagUrl(previousKnockoutResults.champion.iso) ? (
                        <img src={flagUrl(previousKnockoutResults.champion.iso)} alt="" className="h-6 w-9 rounded-[3px] object-cover ring-1 ring-white/15" />
                      ) : (
                        <span className="text-xl">{previousKnockoutResults.champion.flag}</span>
                      )}
                      <div>
                        <div className="text-xs font-bold text-white">{previousKnockoutResults.champion.name}</div>
                        <div className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-blue-100">World Cup Champions</div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-white/10 bg-black/35 px-4 py-2 text-center backdrop-blur-[2px]">
                  <div className="text-3xl font-semibold text-white tabular-nums leading-none">{fmtDuration(phaseTimer)}</div>
                  <div className="text-[10px] text-zinc-300 uppercase mt-0.5">until kick-off</div>
                </div>
              </div>
            ) : (
              <div className="relative z-10 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[10px] font-extrabold tracking-[0.18em] text-blue-100/90">LIVE SCORES</div>
                    <div className="mt-0.5 text-sm font-semibold text-white">
                      {liveEntries.length > 0 ? `${liveEntries.length} live - ${finishedSeasonCount} FT` : `${liveSeasonStageLabel} broadcast window`}
                    </div>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black/35 px-3 py-1.5 text-right backdrop-blur-[2px]">
                    <div className="text-[10px] font-bold uppercase text-zinc-300">{seasonLabel}</div>
                    <div className="text-lg font-semibold tabular-nums text-white">{liveSeasonStageCode}</div>
                  </div>
                </div>

                <div className="live-score-mask overflow-hidden">
                  {liveEntries.length > 0 ? (
                    <div className={liveEntries.length > 2 ? 'live-score-track flex items-center gap-2' : 'flex items-center gap-2'}>
                      {liveRailEntries.map(([id, ms], index) => {
                        const fx = fixtures.find(f => f.id === id);
                        if (!fx) return null;
                        return (
                          <button
                            key={`${id}-${index}`}
                            onClick={() => setWatchingId(id)}
                            className="live-score-card shrink-0 flex items-center gap-2 rounded-lg border border-white/12 px-3 py-2 text-white shadow-sm backdrop-blur-[2px] transition-all hover:border-blue-300/60 active:scale-95"
                            style={{
                              '--home-flag': `url(${flagUrl(fx.home.iso)})`,
                              '--away-flag': `url(${flagUrl(fx.away.iso)})`,
                            } as React.CSSProperties}
                          >
                            <span className="relative z-10 text-sm">{fx.home.flag}</span>
                            <span className="relative z-10 min-w-[2.1rem] text-xs font-extrabold">{fx.home.code}</span>
                            <span className="relative z-10 rounded bg-blue-500/95 px-1.5 py-0.5 text-[11px] font-black tabular-nums text-white shadow-sm">{ms.homeScore}-{ms.awayScore}</span>
                            <span className="relative z-10 min-w-[2.1rem] text-xs font-extrabold">{fx.away.code}</span>
                            <span className="relative z-10 text-sm">{fx.away.flag}</span>
                            <span className="relative z-10 text-[11px] font-bold tabular-nums text-blue-100">{ms.minute}&apos;</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs font-semibold text-zinc-200">
                      Waiting for the next fixture wave. Completed cards stay marked FT.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* -- Inter-season banner ----------------------------------------- */}
        {activeTab === 'home' && viewMode === 'simulated' && seasonHydrated && phase === 'interseason' && (
          <div className="dark:bg-zinc-900/80 bg-zinc-100 border dark:border-zinc-700 border-zinc-300 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-bold dark:text-zinc-200 text-zinc-700 mb-0.5">
                Season {seasonNumber + 1} - Coming Soon
              </div>
              <div className="text-xs dark:text-zinc-400 text-zinc-600">
                A new tournament is being prepared. Stake positions for the next season.
              </div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-semibold dark:text-zinc-300 text-zinc-600 tabular-nums leading-none">{fmtDuration(phaseTimer)}</div>
              <div className="text-[10px] dark:text-zinc-500 text-zinc-400 uppercase mt-0.5">until next season</div>
            </div>
          </div>
        )}

        {/* Account settlement notice */}
        {activeTab === 'home' && viewMode === 'simulated' && activeSettlementNotice && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <span className="text-xs dark:text-zinc-500 text-zinc-400 shrink-0 font-semibold uppercase tracking-[0.18em]">Settled</span>
            {(() => {
              const { settlement: s, fixture: fix } = activeSettlementNotice;
              const payoutTx = s.payouts.find(p => p.txHash)?.txHash ?? '';
              return (
                <>
                <a key={settlementKey(s)} href={s.explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg border dark:border-zinc-800 border-zinc-300 dark:bg-zinc-950 bg-white dark:hover:border-blue-500/50 hover:border-blue-300 dark:text-zinc-200 text-zinc-700 text-xs font-semibold transition-all duration-300">
                  <span>{fix?.home.flag} {fix?.home.code}</span>
                  <span className="dark:text-zinc-600 text-zinc-400">vs</span>
                  <span>{fix?.away.code} {fix?.away.flag}</span>
                  <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-300 uppercase">{s.outcome}</span>
                  <span className="text-[10px] tabular-nums dark:text-zinc-500 text-zinc-400">Payout {shortAddr(payoutTx)}</span>
                </a>
                <button
                  type="button"
                  onClick={() => dismissSettlementNotice(s)}
                  className="shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-500/10 hover:text-zinc-300"
                  title="Dismiss"
                >
                  <X size={12} />
                </button>
                </>
              );
            })()}
          </div>
        )}

        {/* -- Round / group filter tabs ----------------------------------- */}
        {activeTab === 'search' && (
          <div className="flex flex-col gap-3 rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/80 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <label className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 dark:text-zinc-600 text-zinc-400" />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search teams, groups, venues, or match codes"
                className="h-10 w-full rounded-lg border dark:border-zinc-800 border-zinc-200 dark:bg-black bg-zinc-50 pl-9 pr-3 text-sm font-medium outline-none transition-colors placeholder:dark:text-zinc-700 placeholder:text-zinc-400 dark:text-zinc-100 text-zinc-900"
              />
            </label>
            <div className="flex items-center gap-2 text-[11px] font-semibold dark:text-zinc-500 text-zinc-500">
              <span>{visibleFixtures.length} matches</span>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="rounded-md border dark:border-zinc-800 border-zinc-200 px-2 py-1 dark:text-zinc-400 text-zinc-600 dark:hover:text-zinc-100 hover:text-zinc-900"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'search' && (viewMode === 'simulated' ? (
          <div className="flex items-center gap-2 overflow-x-auto rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/80 bg-white p-1.5 shadow-sm scrollbar-none">
            {[
              { id: 'all', label: `Live ${liveSeasonStageCode}`, tone: 'live' },
              { id: 'md1', label: 'MD1', tone: 'matchday' },
              { id: 'md2', label: '2', tone: 'matchday' },
              { id: 'md3', label: '3', tone: 'matchday' },
              ...SEASON_GROUPS.map(g => ({ id: g, label: g, tone: 'group' })),
              { id: 'knockouts', label: 'Knockouts', tone: 'knockout' },
              { id: 'bracket', label: 'Bracket', tone: 'bracket' },
            ].map(t => (
              <button key={t.id} onClick={() => setRoundFilter(t.id)}
                className={`season-filter-tab shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-150
                  ${roundFilter === t.id
                    ? t.tone === 'live'
                      ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200 shadow-sm'
                      : t.tone === 'group'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : t.tone === 'knockout' || t.tone === 'bracket'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'dark:bg-zinc-100 dark:text-zinc-950 bg-zinc-950 text-white shadow-sm'
                    : 'dark:text-zinc-400 text-zinc-500 border dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-300 dark:hover:text-zinc-100 hover:text-zinc-900 dark:bg-zinc-900/35 bg-zinc-50'}`}>
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/80 bg-white p-1.5 shadow-sm scrollbar-none">
            {realtimeTabs.map(t => (
              <button key={t.id} onClick={() => setGroupFilter(t.id)}
                className={`season-filter-tab shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-150
                  ${groupFilter === t.id
                    ? t.tone === 'live'
                      ? 'dark:bg-blue-500/20 bg-blue-50 dark:text-blue-300 text-blue-700 border dark:border-blue-500/30 border-blue-200 shadow-sm'
                      : t.tone === 'group'
                        ? 'dark:bg-blue-500 bg-blue-600 text-white shadow-sm'
                        : 'bg-rose-600 text-white shadow-sm'
                    : 'dark:text-zinc-400 text-zinc-500 border dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-300 dark:hover:text-zinc-100 hover:text-zinc-900 dark:bg-zinc-900/35 bg-zinc-50'}`}>
                {t.label}
              </button>
            ))}
          </div>
        ))}

        {/* -- Champion prediction market --------------------------------- */}
        {activeTab === 'home' && viewMode === 'simulated' && seasonHydrated && (
          <ChampionPick
            key={tournamentGen}
            fixtures={fixtures}
            matchStates={matchStates}
            eliminatedTeams={eliminatedTeams}
            refereeAddress={refereeAddress}
          />
        )}

        {activeTab === 'portfolio' && (
          <MyPositions
            fixtures={fixtures}
            matchStates={displayMatchStates}
            seasonStartedAt={viewMode === 'simulated' ? seasonStartedAt : undefined}
            onWatch={handleWatch}
          />
        )}

        {activeTab === 'search' && viewMode === 'realtime' && SEASON_GROUPS.includes(groupFilter) && (
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-4 border-b dark:border-zinc-900 border-zinc-200 pb-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                  World Cup Group
                </div>
                <h2 className="mt-1 text-xl font-semibold tracking-tight dark:text-zinc-100 text-zinc-900">
                  Group {groupFilter}
                </h2>
              </div>
              <div className="text-right text-xs dark:text-zinc-500 text-zinc-400">
                {selectedGroupFixtures.length} fixtures
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
              <div className="dark:bg-zinc-950 bg-white border dark:border-zinc-900 border-zinc-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b dark:border-zinc-900 border-zinc-100">
                  <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-400 text-zinc-500">
                    Previously Played
                  </div>
                </div>
                <div className="divide-y dark:divide-zinc-900 divide-zinc-100">
                  {selectedGroupResults.length > 0 ? selectedGroupResults.map(fixture => {
                    const ms = matchStates[fixture.id];
                    return (
                      <div key={fixture.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="font-semibold dark:text-zinc-200 text-zinc-800 truncate">
                            {fixture.home.code} vs {fixture.away.code}
                          </div>
                          <div className="mt-0.5 text-[11px] dark:text-zinc-600 text-zinc-400">
                            {fixture.venue}
                          </div>
                        </div>
                        <div className="shrink-0 text-lg font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">
                          {ms.homeScore} - {ms.awayScore}
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="px-4 py-5 text-sm dark:text-zinc-500 text-zinc-500">
                      No completed matches in Group {groupFilter} yet.
                    </div>
                  )}
                </div>
              </div>

              <GroupTable
                fixtures={simFixtures}
                matchStates={matchStates}
                selectedGroup={fixtureGroupFilter}
              />
            </div>
          </section>
        )}

        {showPreseasonSearchLiveEmpty && (
          <div
            className="relative overflow-hidden rounded-xl border border-white/10 bg-zinc-950 px-5 py-8 text-center shadow-sm"
            style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}
          >
            <div className="absolute inset-0 bg-cover bg-center opacity-35 blur-[1px]" style={{ backgroundImage: `var(--fanvibe-bg)` }} />
            <div className="absolute inset-0 bg-black/55" />
            <div className="relative z-10 mx-auto max-w-md">
              <div className="text-sm font-semibold text-white">Next season kickstarts soon</div>
              <div className="mt-1 text-xs leading-relaxed text-zinc-300">
                Visit match groups to stake on favourites before the first live fixture window opens.
              </div>
            </div>
          </div>
        )}

        {/* -- Bracket view OR fixture grid -------------------------------- */}
        {(activeTab === 'search' || (activeTab === 'home' && homeCupView === 'matches')) && !showPreseasonSearchLiveEmpty && (viewMode !== 'simulated' || seasonHydrated) && ((viewMode === 'simulated' && fixtureRoundFilter === 'bracket') || (viewMode === 'realtime' && (fixtureGroupFilter === 'bracket' || fixtureGroupFilter === 'knockouts' || ['R32', 'R16', 'QF', 'SF', '3PL', 'F'].includes(fixtureGroupFilter))) ? (
          <BracketView
            fixtures={simFixtures}
            matchStates={visibleMatchStates}
            onWatch={handleWatch}
            activeRound={viewMode === 'realtime'
              ? (['R32', 'R16', 'QF', 'SF', '3PL', 'F', 'knockouts', 'bracket'].includes(fixtureGroupFilter)
                ? fixtureGroupFilter as 'R32' | 'R16' | 'QF' | 'SF' | '3PL' | 'F' | 'knockouts' | 'bracket'
                : 'bracket')
              : (fixtureRoundFilter === 'bracket' ? 'bracket' : 'knockouts')}
          />
        ) : (
          <section className="space-y-3">
            {viewMode === 'simulated' && fixtureRoundFilter !== 'bracket' && (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                  {simulatedFixtureSectionLabel}
                </div>
                {phase === 'playing' && (
                  <div className="text-[11px] dark:text-zinc-500 text-zinc-400">
                    MD1 {'->'} MD2 {'->'} MD3 {'->'} Knockouts {'->'} Final
                  </div>
                )}
              </div>
            )}
            {viewMode === 'realtime' && SEASON_GROUPS.includes(fixtureGroupFilter) && (
              <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                Group {fixtureGroupFilter} Fixtures
              </div>
            )}
            {viewMode === 'realtime' && fixtureGroupFilter === 'live' && (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                  Fixture Board
                </div>
                <div className="text-[11px] dark:text-zinc-500 text-zinc-400">
                  Active first, upcoming next, FT last
                </div>
              </div>
            )}
            {viewMode === 'realtime' && fixtureGroupFilter === 'all' && activeTab === 'home' && (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                  Fixture Board
                </div>
                <div className="text-[11px] dark:text-zinc-500 text-zinc-400">
                  Active first, upcoming next, FT last
                </div>
              </div>
            )}
            {viewMode === 'realtime' && (fixtureGroupFilter === 'knockouts' || ['R32', 'R16', 'QF', 'SF', '3PL', 'F'].includes(fixtureGroupFilter)) && (
              <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                {fixtureGroupFilter === 'knockouts' ? 'Knockout Fixtures' : `${fixtureGroupFilter === 'F' ? 'Final' : fixtureGroupFilter} Fixtures`}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {orderedVisibleFixtures.map(fixture => (
                <FixtureCard
                  key={fixture.id}
                  fixture={fixture}
                  pool={pools[fixture.id]}
                  matchState={visibleMatchStates[fixture.id]}
                  seasonPhase={viewMode === 'simulated' ? phase : undefined}
                  seasonTimer={viewMode === 'simulated' ? phaseTimer : undefined}
                  seasonKickoffDelayMs={viewMode === 'simulated' ? seasonFixtureKickoffDelayMs(fixtures, fixture.id) : undefined}
                  seasonStartedAt={viewMode === 'simulated' ? seasonStartedAt : undefined}
                  seasonFixtureStartsAt={viewMode === 'simulated' ? seasonFixtureStartAtMs(fixtures, fixture, seasonStartedAt, matchStates) : undefined}
                  stakeClosedNotice={stakeClosedNotices[fixture.id]}
                  refereeAddress={refereeAddress}
                  onStake={handleStake}
                  onWatch={handleWatch}
                />
              ))}
            </div>
            {orderedVisibleFixtures.length === 0 && (
              <div className="rounded-lg border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white px-4 py-8 text-center text-sm dark:text-zinc-500 text-zinc-500">
                {viewMode === 'realtime' && !worldCupFeedReady
                  ? 'Real World Cup markets open after the live sports data provider is active.'
                  : 'No matches found. Try a team name, code, group, or venue.'}
              </div>
            )}
          </section>
        ))}

        {/* -- Activity feed toggle ---------------------------------------- */}
        {activeTab === 'portfolio' && (
        <div className="border-t dark:border-zinc-900 border-zinc-200">
          <button
            onClick={() => setLogOpen(o => !o)}
            className="w-full flex items-center justify-between gap-4 py-3 text-xs dark:text-zinc-600 text-zinc-500 dark:hover:text-zinc-400 hover:text-zinc-700 transition-colors dark:bg-transparent bg-transparent"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-semibold dark:text-zinc-400 text-zinc-600">Account Activity</span>
              <span className="season-status-rotate hidden sm:inline-flex text-[11px] font-semibold dark:text-zinc-500 text-zinc-400">
                <span>{logs.length} recent updates</span>
                <span>{engineOnline ? 'Live updates active' : 'Updates syncing'}</span>
                <span>Market monitor</span>
              </span>
            </span>
            {logOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {logOpen && <LogStream logs={logs} daemonOnline={engineOnline} />}
        </div>
        )}

        {/* -- Platform steps --------------------------------------------- */}
        {activeTab === 'home' && (
        <div className="dark:border-zinc-900 border-zinc-200 border rounded-xl overflow-hidden">
          <div className="w-full flex items-center justify-between gap-4 px-4 py-3 text-xs dark:text-zinc-600 text-zinc-500 dark:bg-transparent bg-white">
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-semibold dark:text-zinc-400 text-zinc-600">Platform Steps</span>
              <span className="how-it-works-rotate hidden sm:inline-flex text-[11px] font-semibold dark:text-zinc-500 text-zinc-400">
                <span><strong>Step 1</strong> Choose a fixture or champion market</span>
                <span><strong>Step 2</strong> Stake OKB from your connected wallet</span>
                <span><strong>Step 3</strong> Winners split payouts after settlement</span>
              </span>
            </span>
          </div>
        </div>
        )}

        {activeTab === 'home' && (
        <div className="dark:border-zinc-900 border-zinc-200 border rounded-xl overflow-hidden">
          <div className="w-full flex items-center justify-between gap-4 px-4 py-3 text-xs dark:text-zinc-600 text-zinc-500 dark:bg-transparent bg-white">
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-semibold dark:text-zinc-400 text-zinc-600">Season Winners</span>
              <span className="season-winners-mask block">
                <span className="season-winners-track text-[11px] font-semibold dark:text-zinc-500 text-zinc-400">
                {displayedSeasonWinners.length > 0 ? (
                  [...displayedSeasonWinners, ...displayedSeasonWinners].map((winner, index) => (
                    <span key={`${winner.seasonNumber}-${winner.team.code}-${index}`} className="inline-flex items-center gap-1.5">
                      {flagUrl(winner.team.iso) ? (
                        <img src={flagUrl(winner.team.iso)} alt="" className="h-3.5 w-5 rounded-[2px] object-cover ring-1 ring-black/10 dark:ring-white/10" />
                      ) : (
                        <span>{winner.team.flag}</span>
                      )}
                      <strong>S{String(winner.seasonNumber).padStart(2, '0')} winner</strong> - {winner.team.name}
                    </span>
                  ))
                ) : (
                  <>
                    <span><strong>Season archive</strong> - champions append automatically</span>
                  </>
                )}
                </span>
              </span>
            </span>
          </div>
        </div>
        )}

        {/* -- Proof panel ------------------------------------------------- */}
        {activeTab === 'portfolio' && (
        <div className="border-t dark:border-zinc-900 border-zinc-200">
          <button
            onClick={() => setProofOpen(o => !o)}
            className="w-full flex items-center justify-between gap-4 py-3 text-xs dark:text-zinc-600 text-zinc-500 dark:hover:text-zinc-400 hover:text-zinc-700 transition-colors dark:bg-transparent bg-transparent"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-semibold dark:text-zinc-400 text-zinc-600">Why X Layer</span>
              <span className="hidden sm:inline-flex min-w-0 text-[11px] font-semibold dark:text-zinc-500 text-zinc-400">
                Fast OKB staking, explorer-linked records, autonomous payouts
              </span>
            </span>
            {proofOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {proofOpen && (
            <div className="border-t dark:border-zinc-900 border-zinc-100 py-4">
              <div className="mb-4 max-w-3xl">
                <div className="text-sm font-semibold dark:text-zinc-100 text-zinc-900">
                  X Layer keeps FanVibe fast, auditable, and payout-ready.
                </div>
                <div className="mt-1 text-xs leading-relaxed dark:text-zinc-500 text-zinc-500">
                  Fans stake with OKB, every position links to explorer records, and completed matches trigger automated payouts or refunds from the referee wallet.
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Network</div>
                  <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">X Layer Mainnet</div>
                  <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">OKB-powered predictions</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Payout Account</div>
                  {refereeAddress ? (
                    <a href={explorerAddr(refereeAddress)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900 hover:text-blue-500">
                      {shortAddr(refereeAddress)}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <div className="mt-1 text-sm font-semibold dark:text-zinc-500 text-zinc-500">Not connected</div>
                  )}
                  <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">Account used for verified payouts</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Latest Block</div>
                  {lastBlock > 0 ? (
                    <a href={explorerBlock(lastBlock)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900 hover:text-blue-500">
                      {lastBlock.toLocaleString()}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <div className="mt-1 text-sm font-semibold dark:text-zinc-500 text-zinc-500">Syncing</div>
                  )}
                  <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">Most recent verified update</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Payout Float</div>
                  <div className={`mt-1 text-sm font-semibold tabular-nums ${healthColor}`}>{metabolism.okbBalanceFormatted} OKB</div>
                  {reserveUsd && <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">{reserveUsd}</div>}
                  <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">{metabolism.healthPercent}% ready</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Status</div>
                  <div className={`mt-1 text-sm font-semibold ${wsConnected || engineOnline ? 'dark:text-emerald-300 text-emerald-600' : 'dark:text-zinc-500 text-zinc-500'}`}>
                    {wsConnected || engineOnline ? 'Online' : 'Offline'}
                  </div>
                  <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">{wsConnected || engineOnline ? 'Live updates active' : 'Updates syncing'}</div>
                </div>
              </div>

              <div className="mt-4 border-t dark:border-zinc-900 border-zinc-100 pt-3 text-xs leading-relaxed dark:text-zinc-400 text-zinc-600">
                FanVibe keeps every stake, result, and payout easy to review. Completed payouts link to public records so users can confirm market outcomes.
              </div>

              <div className="mt-4 border-t dark:border-zinc-900 border-zinc-100 pt-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Experimental v4 Hook</div>
                    <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">WOKB/USDT matchday liquidity</div>
                    <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">Open 0.05% - Live 0.30% - Settled 0.10%</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <a href={explorerAddr(FANVIBE_V4_HOOK)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2 py-1 font-semibold dark:text-zinc-300 text-zinc-700 hover:text-blue-500">
                      Hook {shortAddr(FANVIBE_V4_HOOK)}
                      <ExternalLink size={11} />
                    </a>
                    <a href={explorerTx(FANVIBE_V4_DEPLOY_TX)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2 py-1 font-semibold dark:text-zinc-300 text-zinc-700 hover:text-blue-500">
                      Deploy
                      <ExternalLink size={11} />
                    </a>
                    <a href={explorerTx(FANVIBE_V4_INIT_TX)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2 py-1 font-semibold dark:text-zinc-300 text-zinc-700 hover:text-blue-500">
                      Pool init
                      <ExternalLink size={11} />
                    </a>
                    <a href={explorerTx(FANVIBE_V4_APPROVE_TX)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2 py-1 font-semibold dark:text-zinc-300 text-zinc-700 hover:text-blue-500">
                      Approval
                      <ExternalLink size={11} />
                    </a>
                    <a href={explorerTx(FANVIBE_V4_SWAP_PROOF_TX)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2 py-1 font-semibold dark:text-zinc-300 text-zinc-700 hover:text-blue-500">
                      Swap proof
                      <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
                <div className="mt-3 truncate text-[10px] font-semibold dark:text-zinc-600 text-zinc-400">
                  Pool {FANVIBE_V4_POOL_ID}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 divide-x divide-y dark:divide-zinc-900 divide-zinc-100 border-t border-b dark:border-zinc-900 border-zinc-100 md:grid-cols-4 md:divide-y-0">
                <div className="px-3 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Platform Volume</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">{fmtOKBWei(proofPlatformVolumeWei)}</div>
                  {proofPoolUsd && <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">{proofPoolUsd}</div>}
                </div>
                <div className="px-3 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Open Markets</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">{fixtures.filter(f => f.status === 'open').length}</div>
                </div>
                <div className="px-3 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Payouts</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">{payoutSettlementCount}</div>
                </div>
                <div className="px-3 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Season</div>
                  <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">{seasonLabel}</div>
                  <div className="mt-0.5 truncate text-[10px] dark:text-zinc-600 text-zinc-400">{liveSeasonStageCode}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Recent Stakes</div>
                  <div className="divide-y dark:divide-zinc-900 divide-zinc-100 border-y dark:border-zinc-900 border-zinc-100">
                    {proofStakeTxs.length > 0 ? proofStakeTxs.map(log => (
                      <a key={`${log.id}-${log.txHash}`} href={explorerTx(log.txHash!)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 py-2 text-xs transition-colors hover:text-blue-500">
                        <span className="min-w-0 truncate dark:text-zinc-300 text-zinc-700">{log.message}</span>
                        <span className="shrink-0 font-semibold tabular-nums dark:text-zinc-500 text-zinc-500">{shortAddr(log.txHash!)}</span>
                      </a>
                    )) : (
                      <div className="py-2 text-xs dark:text-zinc-500 text-zinc-500">No stake transactions indexed yet.</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Recent Payouts</div>
                  <div className="divide-y dark:divide-zinc-900 divide-zinc-100 border-y dark:border-zinc-900 border-zinc-100">
                    {proofPayoutTxs.length > 0 ? proofPayoutTxs.map(payout => (
                      <a key={`${payout.fixtureId}-${payout.txHash}`} href={explorerTx(payout.txHash)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 py-2 text-xs transition-colors hover:text-blue-500">
                        <span className="min-w-0 truncate dark:text-zinc-300 text-zinc-700">{payout.fixtureId} payout</span>
                        <span className="shrink-0 font-semibold tabular-nums dark:text-zinc-500 text-zinc-500">
                          {fmtOKBWei(payout.amountWei)}{formatOkbUsdFromWei(payout.amountWei, okbUsd) ? ` (${formatOkbUsdFromWei(payout.amountWei, okbUsd)})` : ''} - {shortAddr(payout.txHash)}
                        </span>
                      </a>
                    )) : (
                      <div className="py-2 text-xs dark:text-zinc-500 text-zinc-500">Payout links appear after a settled match has winners.</div>
                    )}
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

        {/* Footer */}
        <div className="border-t dark:border-zinc-900 border-zinc-100 pt-4 pb-4 text-center space-y-2">
          <div className="flex items-center justify-center gap-4">
            <a
              href="https://x.com/FanVibeOnX"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs dark:text-zinc-600 text-zinc-400 underline decoration-transparent underline-offset-4 transition-colors hover:text-zinc-600 hover:decoration-zinc-400 dark:hover:text-zinc-300 dark:hover:decoration-zinc-500"
            >
              X/Twitter
            </a>
          </div>
          <a
            href={explorerAddr(refereeAddress)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-[11px] dark:text-zinc-600 text-zinc-400 underline decoration-transparent underline-offset-4 transition-colors hover:text-zinc-600 hover:decoration-zinc-400 dark:hover:text-zinc-300 dark:hover:decoration-zinc-500"
          >
            Built on OKX X Layer
          </a>
        </div>
      </main>

      {watchingFixture && displayWatchingMatchState && (
        <MatchViewer
          fixture={watchingFixture}
          fixtures={viewMode === 'realtime' ? realtimeFixtures : fixtures}
          matchState={displayWatchingMatchState}
          onClose={() => setWatchingId(null)}
        />
      )}

      {(activeTab === 'home' || activeTab === 'search') && viewMode === 'simulated' && !seasonHydrated && (
        <div
          className="fixed inset-0 z-[80] bg-zinc-950"
          style={{ animation: 'overlayIn 0.18s ease both' }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(148,163,184,0.16),transparent_34%),linear-gradient(180deg,#09090b,#18181b)]" />
          <div className="absolute left-1/2 top-1/2 flex w-full max-w-xs -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-5 px-6 text-center">
            <div
              className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-zinc-800/80 shadow-2xl shadow-black/25 sm:h-28 sm:w-28"
              style={{
                animation: 'fanvibeLoadPulse 2.8s ease-in-out infinite',
              }}
            >
              <div className="absolute inset-3 rounded-full border border-white/10 bg-zinc-700/45" />
              <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-white/95 p-3 shadow-sm shadow-black/20 sm:h-24 sm:w-24 sm:p-4">
                <img src={BRAND_E_IMAGE} alt="" className="h-full w-full object-contain fanvibe-loader-logo" />
              </div>
            </div>
            <div className="relative text-sm font-semibold tracking-tight text-white/90">
              Loading FanVibe
            </div>
          </div>
        </div>
      )}

      {/* -- Champion overlay ----------------------------------------------- */}
      {champion && phase === 'champion' && viewMode === 'simulated' && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 backdrop-blur-md"
          style={{ animation: 'overlayIn 0.4s ease both' }}
        >
          <div className="text-center px-8 py-10 max-w-xs">
            <div
              className="text-8xl mb-5 select-none"
              style={{ animation: 'flagBounce 0.7s cubic-bezier(0.34,1.56,0.64,1) both' }}
            >
              {champion.flag}
            </div>
            <div className="text-3xl font-semibold text-white tracking-tight mb-1">
              {champion.name}
            </div>
            <div className="text-base font-bold text-emerald-400 mb-5 tracking-widest uppercase">
              {seasonLabel} Champions
            </div>

            {/* Countdown bar */}
            <div className="w-full h-1 dark:bg-zinc-800 bg-zinc-700 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-emerald-400 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${(phaseTimer / 5) * 100}%` }}
              />
            </div>
            <p className="text-xs dark:text-zinc-400 text-zinc-400 mb-5">
              Next season in <span className="font-bold text-white tabular-nums">{phaseTimer}s</span>
            </p>

          </div>
        </div>
      )}
    </div>
  );
}

