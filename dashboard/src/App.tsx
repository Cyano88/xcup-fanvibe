import { useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, http, formatEther } from 'viem';
import { BriefcaseBusiness, ChevronDown, ChevronUp, ExternalLink, Globe, Home, Newspaper, Search, Volume2, VolumeX } from 'lucide-react';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { FixtureCard } from './components/FixtureCard';
import { LogStream } from './components/LogStream';
import { StakeModal } from './components/StakeModal';
import { SettlementToast } from './components/SettlementToast';
import { MyPositions } from './components/MyPositions';
import { MatchViewer } from './components/MatchViewer';
import { GroupTable } from './components/GroupTable';
import { WorldCupNews } from './components/WorldCupNews';
import type { DaemonState, DaemonLog, Fixture, Pool, Outcome, SettlementResult, MetabolicState, MatchState, Team } from './types';
import { REALTIME_FIXTURES } from './types';
import { BracketView } from './components/BracketView';
import { ChampionPick } from './components/ChampionPick';
import { simulateMatch } from './lib/clientSim';
import { xLayerMainnet, explorerAddr, explorerTx } from './lib/chain';
import { shortAddr } from './lib/encode';
import {
  SEASON_GROUPS,
  DEFAULT_SEASON_TIMING,
  TEST_SEASON_TIMING,
  allGroupMatchesFinished,
  advanceKnockout,
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
const flagUrl = (iso: string) =>
  iso === 'un' || iso === 'tbd' ? '' : `https://flagcdn.com/w640/${iso.toLowerCase()}.png`;
const isResolvedFixture = (fixture?: Fixture | null) =>
  !!fixture
  && fixture.home.code !== 'TBD'
  && fixture.away.code !== 'TBD'
  && fixture.home.iso !== 'tbd'
  && fixture.away.iso !== 'tbd';
const explorerBlock = (blockNumber: number) =>
  `https://www.okx.com/web3/explorer/xlayer/block/${blockNumber}`;

const rpcClient = createPublicClient({ chain: xLayerMainnet, transport: http('https://rpc.xlayer.tech') });

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
  source: 'wc2026api' | 'balldontlie' | 'zafronix' | 'static';
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

function seasonFixturesFromState(incoming: Fixture[]): Fixture[] {
  if (!incoming.length) return createSeasonFixtures(1);
  if (incoming.some(f => f.id.startsWith('r32-'))) return createSeasonFixtures(1);
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
    fixtures: createSeasonFixtures(seasonNumber),
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

function mergeLiveMatchStates(
  current: Record<string, MatchState>,
  incoming: Record<string, MatchState>,
): Record<string, MatchState> {
  const merged = { ...incoming };
  for (const [fixtureId, currentState] of Object.entries(current)) {
    const incomingState = incoming[fixtureId];
    if (!incomingState) continue;
    const currentEvents = currentState.events?.length ?? 0;
    const incomingEvents = incomingState.events?.length ?? 0;
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
  const [realtimeFixtures, setRealtimeFixtures] = useState<Fixture[]>(REALTIME_FIXTURES);
  const [worldCupFeed, setWorldCupFeed]         = useState<WorldCupFeed | null>(null);
  const [pools, setPools]                       = useState<Record<string, Pool>>({});
  const [logs, setLogs]                         = useState<DaemonLog[]>([]);
  const [lastBlock, setLastBlock]               = useState(0);
  const [wsConnected, setWsConnected]           = useState(false);
  const [settlements, setSettlements]           = useState<SettlementResult[]>([]);
  const [pendingToasts, setPendingToasts]       = useState<SettlementResult[]>([]);
  const [stakeTarget, setStakeTarget]           = useState<{ fixtureId: string; outcome: Outcome } | null>(null);
  const [stakeClosedNotices, setStakeClosedNotices] = useState<Record<string, string>>({});
  const [logOpen, setLogOpen]                   = useState(false);
  const [proofOpen, setProofOpen]               = useState(false);
  const [roundFilter, setRoundFilter]           = useState<string>('all');
  const [groupFilter, setGroupFilter]           = useState<string>('all');
  const [searchQuery, setSearchQuery]           = useState('');
  const [matchStates, setMatchStates]           = useState<Record<string, MatchState>>(initialSeason.matchStates);
  const [liveUiTick, setLiveUiTick]             = useState(0);
  const [watchingFixtureId, setWatchingId]      = useState<string | null>(null);
  const [viewMode, setViewMode]                 = useState<'simulated' | 'realtime'>('simulated');
  const [activeTab, setActiveTab]               = useState<AppTab>('home');
  const [soundMuted, setSoundMuted]             = useState(false);
  const [seasonMode, setSeasonMode]             = useState<SeasonStorageMode>('prod');
  const [seasonTiming, setSeasonTimingState]    = useState<SeasonTiming>(DEFAULT_SEASON_TIMING);
  const [seasonDurable, setSeasonDurable]       = useState(false);
  const [seasonAdminOpen, setSeasonAdminOpen]   = useState(false);
  const [seasonHydrated, setSeasonHydrated]     = useState(false);
  const [eliminatedTeams, setEliminatedTeams]   = useState<Set<string>>(() => new Set(initialSeason.eliminatedTeams));
  const [champion, setChampion]                 = useState<Team | null>(initialSeason.champion);
  const [previousKnockoutResults, setPreviousKnockoutResults] = useState(initialSeason.previousKnockoutResults ?? null);
  const [seasonWinners, setSeasonWinners]       = useState(initialSeason.seasonWinners ?? []);
  const [tournamentGen, setTournamentGen]       = useState(initialSeason.tournamentGen);

  // Season / phase system
  const [seasonNumber, setSeasonNumber]         = useState<number>(() => {
    return Math.max(1, initialSeason.seasonNumber || 1);
  });
  const [phase, setPhase]                       = useState<SeasonPhase>(initialSeason.phase);
  const [phaseTimer, setPhaseTimer]             = useState(initialSeason.phaseTimer);
  const [phaseEndsAt, setPhaseEndsAt]           = useState(initialSeason.phaseEndsAt);
  const [seasonClockTick, setSeasonClockTick]   = useState(0);

  const wsRef                  = useRef<WebSocket | null>(null);
  const reconnectRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simCleanupRef          = useRef<Map<string, () => void>>(new Map());
  const bracketProcessedRef    = useRef<Set<string>>(new Set());
  const championTriggeredRef   = useRef(false);
  const watchedStateRef        = useRef<Record<string, MatchState>>({});
  const watchedFixtureRef      = useRef<Record<string, Fixture>>({});
  const themeAudioRef          = useRef<HTMLAudioElement | null>(null);
  const seasonPersistTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    window.localStorage.setItem('fanvibe-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    setSeasonTiming(seasonTiming);
  }, [seasonTiming]);

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
    setMatchStates(prev => preserveWatching ? mergeLiveMatchStates(prev, snapshot.matchStates ?? {}) : snapshot.matchStates ?? {});
    setEliminatedTeams(new Set(snapshot.eliminatedTeams ?? []));
    setChampion(snapshot.champion ?? null);
    setPreviousKnockoutResults(snapshot.previousKnockoutResults ?? null);
    setSeasonWinners(snapshot.seasonWinners ?? []);
    setTournamentGen(snapshot.tournamentGen ?? 0);
    if (!preserveWatching) setWatchingId(null);
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
    fetch(`${BACKEND_HTTP}/season/snapshot?mode=${seasonMode}`)
      .then(r => r.json())
      .then((res: { state: InitialSeasonState | null; durable?: boolean }) => {
        setSeasonDurable(!!res.durable);
        if (res.state) {
          applySeasonSnapshot(res.state, seasonMode, preserveWatching);
          setSeasonHydrated(true);
          return;
        }
        const fresh = freshSeasonState(1, Date.now(), seasonMode === 'test' ? TEST_SEASON_TIMING : DEFAULT_SEASON_TIMING, seasonMode);
        applySeasonSnapshot(fresh, seasonMode);
        setSeasonHydrated(true);
        if (seasonMode === 'prod') return;
        fetch(`${BACKEND_HTTP}/season/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: seasonMode, state: fresh }),
        }).catch(() => {});
      })
      .catch(() => {});
  }, [applySeasonSnapshot, seasonMode]);

  useEffect(() => {
    loadSeasonSnapshot();
  }, [loadSeasonSnapshot]);

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
          setFixtures(prev => prev.length ? prev : seasonFixturesFromState(s.fixtures));
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
          if (s.payouts.some(p => !!p.txHash)) {
            setPendingToasts(prev => prev.some(existing => existing.fixtureId === s.fixtureId && existing.blockNumber === s.blockNumber)
              ? prev
              : [...prev, s]);
          }
          setFixtures(prev => prev.map(f => f.id === s.fixtureId ? { ...f, status: 'settled', result: s.outcome } : f));
        } else if (msg.type === 'season-reset') {
          const data = msg.data as { mode?: SeasonStorageMode };
          if (data.mode === seasonMode) {
            applySeasonSnapshot(freshSeasonState(1, Date.now(), seasonMode === 'test' ? TEST_SEASON_TIMING : DEFAULT_SEASON_TIMING, seasonMode), seasonMode);
          }
        } else if (msg.type === 'season') {
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
        setFixtures(prev => prev.length ? prev : seasonFixturesFromState(s.fixtures));
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
    const timer = setInterval(syncLiveState, 5000);
    return () => clearInterval(timer);
  }, [connectWS, loadSeasonSnapshot, seasonHydrated, viewMode]);

  useEffect(() => {
    const loadWorldCupFeed = () => {
      fetch(`${BACKEND_HTTP}/worldcup/feed`)
        .then(r => r.json())
        .then((feed: WorldCupFeed) => {
          if (Array.isArray(feed.fixtures) && feed.fixtures.length) setRealtimeFixtures(feed.fixtures);
          if (feed.matchStates) setMatchStates(prev => ({ ...prev, ...feed.matchStates }));
          setWorldCupFeed(feed);
        })
        .catch(() => {
          setWorldCupFeed({
            fixtures: REALTIME_FIXTURES,
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
    const timer = setInterval(loadWorldCupFeed, 120_000);
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
    if (phase === 'playing') return;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
      setPhaseTimer(remaining);
      if (seasonMode === 'prod') return;
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
    if (fixtures.some(f => f.id === 'k32-1' && f.home.code !== 'TBD')) return;
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
    const ms = matchStates['f-1'];
    if (ms?.status !== 'finished') return;
    if (championTriggeredRef.current) return;
    championTriggeredRef.current = true;
    const fx = fixtures.find(f => f.id === 'f-1');
    if (!fx) return;
    const winner = ms.penaltyWinner === 'home' ? fx.home
      : ms.penaltyWinner === 'away' ? fx.away
      : ms.homeScore >= ms.awayScore ? fx.home
      : fx.away;
    setChampion(winner);
    setPhase('champion');
    setPhaseEndsAt(Date.now() + 10 * 1000);
    setPhaseTimer(10);
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
    const fixture = fixtures.find(f => f.id === fixtureId);
    const matchState = matchStates[fixtureId];
    if (!fixture) return;
    if (fixture.status === 'locked' || fixture.status === 'settled') {
      showStakeClosedNotice(fixtureId, fixture.status === 'settled' ? 'This match has already settled.' : 'Stake on the next available match.');
      return;
    }
    if (matchState?.status === 'live' || matchState?.status === 'half_time' || matchState?.status === 'finished') {
      showStakeClosedNotice(fixtureId, 'Stake on the next available match.');
      return;
    }
    setStakeTarget({ fixtureId, outcome });
  }, [fixtures, matchStates, showStakeClosedNotice]);
  const dismissToast   = useCallback((s: SettlementResult) => setPendingToasts(prev => prev.filter(x => x !== s)), []);
  const handleWatch    = useCallback((fixtureId: string) => setWatchingId(fixtureId), []);
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

  const activeFixture  = stakeTarget ? fixtures.find(f => f.id === stakeTarget.fixtureId) ?? null : null;
  const watchingFixture = watchingFixtureId
    ? fixtures.find(f => f.id === watchingFixtureId) ?? watchedFixtureRef.current[watchingFixtureId] ?? null
    : null;
  const watchingMatchState = watchingFixtureId
    ? matchStates[watchingFixtureId] ?? watchedStateRef.current[watchingFixtureId] ?? null
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
            setMatchStates(prev => mergeLiveMatchStates(prev, { ...prev, [watchingFixtureId]: res.matchState! }));
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

  const simFixtures    = viewMode === 'simulated' ? fixtures : realtimeFixtures;
  const rtGroups       = ['all', ...Array.from(new Set(realtimeFixtures.map(f => f.group))).sort()];
  const projectMatchState = useCallback((state?: MatchState): MatchState | undefined => {
    if (!state || state.status !== 'live') return state;
    const kickoffMs = Date.parse(state.simulatedKickoff);
    if (!Number.isFinite(kickoffMs)) return state;
    const minuteMs = Math.max(1000, Math.round(seasonTiming.matchMs / 90));
    const projectedMinute = Math.min(89, Math.max(state.minute, Math.floor((Date.now() - kickoffMs) / minuteMs)));
    return projectedMinute === state.minute ? state : { ...state, minute: projectedMinute };
  }, [liveUiTick, seasonTiming.matchMs]);
  const displayMatchStates = Object.fromEntries(
    Object.entries(matchStates).map(([id, state]) => [id, projectMatchState(state) ?? state])
  ) as Record<string, MatchState>;
  const displayWatchingMatchState = watchingMatchState ? projectMatchState(watchingMatchState) ?? watchingMatchState : null;
  const activeGroupMatchday = currentGroupMatchday(simFixtures, matchStates);
  const fixtureRoundFilter = activeTab === 'search' ? roundFilter : 'all';
  const fixtureGroupFilter = activeTab === 'search' ? groupFilter : 'all';
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
  const homeSeasonFixtures = simFixtures.filter(f =>
    f.home.code !== 'TBD' &&
    f.away.code !== 'TBD' &&
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
    : (fixtureGroupFilter === 'all' ? realtimeFixtures : realtimeFixtures.filter(f => f.group === fixtureGroupFilter));
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
    : visibleFixtures;
  const selectedGroupFixtures = activeTab === 'search' && viewMode === 'realtime' && fixtureGroupFilter !== 'all'
    ? realtimeFixtures.filter(f => f.group === fixtureGroupFilter)
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
  const settledRailItems = [...settlements]
    .reverse()
    .map((settlement) => {
      const fixture = fixtures.find(f => f.id === settlement.fixtureId)
        ?? realtimeFixtures.find(f => f.id === settlement.fixtureId)
        ?? null;
      const matchState = matchStates[settlement.fixtureId];
      return { settlement, fixture, matchState };
    })
    .filter(({ settlement, fixture, matchState }) => {
      const hasPayoutTx = settlement.payouts.some(p => !!p.txHash);
      const hasSettledFixture = fixture?.status === 'settled';
      const hasFinishedMatch = matchState?.status === 'finished';
      return !!fixture && hasPayoutTx && !!settlement.explorerUrl && (hasSettledFixture || hasFinishedMatch);
    })
    .slice(0, 5);
  const proofPoolWei = Object.values(pools).reduce((sum, pool) => {
    try {
      return sum + BigInt(pool.home) + BigInt(pool.draw) + BigInt(pool.away) + BigInt(pool.fees);
    } catch {
      return sum;
    }
  }, 0n);
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
  const worldCupSourceLabel = worldCupFeed?.source === 'zafronix'
    ? 'Zafronix'
    : worldCupFeed?.source === 'balldontlie'
      ? 'BallDontLie'
      : worldCupFeed?.source === 'wc2026api'
        ? 'WC2026 API'
        : worldCupFeed?.providerConfigured
          ? 'Static fallback'
          : 'Static schedule';
  const worldCupFreshness = worldCupFeed
    ? worldCupFeed.mode === 'live'
      ? `synced ${worldCupFeed.freshnessSeconds}s ago`
      : worldCupFeed.error ?? 'provider not configured'
    : 'sync pending';
  const appTabs: Array<{ id: AppTab; label: string; icon: typeof Home }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'news', label: 'News', icon: Newspaper },
    { id: 'portfolio', label: 'Portfolio', icon: BriefcaseBusiness },
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
        </div>
      </aside>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24 space-y-6 lg:pl-28">

        {/* -- Mode toggle ------------------------------------------------- */}
        {(activeTab === 'home' || activeTab === 'search') && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
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

          {viewMode === 'simulated' && (import.meta.env.VITE_ENABLE_ADMIN_TEST_MODE === 'true' || new URLSearchParams(window.location.search).get('admin') === '1') && (
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
                  {seasonDurable ? 'Durable' : 'Local fallback'}
                </span>
              </>
              ) : null
            ) : (
              <>
                <span className="text-[11px] font-bold dark:text-white text-zinc-950">World Cup 2026</span>
                <span className="text-[11px] font-semibold dark:text-zinc-400 text-zinc-500">{worldCupSourceLabel} - {worldCupFreshness}</span>
              </>
            )}
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

        {/* Recent settlements strip */}
        {(activeTab === 'home' || activeTab === 'portfolio') && settledRailItems.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <span className="text-xs dark:text-zinc-500 text-zinc-400 shrink-0 font-semibold uppercase tracking-[0.18em]">Settled</span>
            {settledRailItems.map(({ settlement: s, fixture: fix }) => {
              const payoutTx = s.payouts.find(p => p.txHash)?.txHash ?? '';
              return (
                <a key={`${s.fixtureId}-${s.blockNumber}`} href={s.explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg border dark:border-zinc-800 border-zinc-300 dark:bg-zinc-950 bg-white dark:hover:border-blue-500/50 hover:border-blue-300 dark:text-zinc-200 text-zinc-700 text-xs font-semibold transition-colors">
                  <span>{fix?.home.flag} {fix?.home.code}</span>
                  <span className="dark:text-zinc-600 text-zinc-400">vs</span>
                  <span>{fix?.away.code} {fix?.away.flag}</span>
                  <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-300 uppercase">{s.outcome}</span>
                  <span className="text-[10px] tabular-nums dark:text-zinc-500 text-zinc-400">Payout {shortAddr(payoutTx)}</span>
                </a>
              );
            })}
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
                className="h-10 w-full rounded-lg border dark:border-zinc-800 border-zinc-200 dark:bg-black bg-zinc-50 pl-9 pr-3 text-sm font-medium outline-none transition-colors placeholder:dark:text-zinc-700 placeholder:text-zinc-400 focus:border-blue-500/60 dark:text-zinc-100 text-zinc-900"
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
            {rtGroups.map(g => (
              <button key={g} onClick={() => setGroupFilter(g)}
                className={`season-filter-tab shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-150
                  ${groupFilter === g
                    ? 'dark:bg-blue-500 dark:text-white bg-blue-600 text-white'
                    : 'dark:text-zinc-400 text-zinc-500 border dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-300 dark:hover:text-zinc-100 hover:text-zinc-900 dark:bg-zinc-900/35 bg-zinc-50'}`}>
                {g === 'all' ? 'All' : g}
              </button>
            ))}
          </div>
        ))}

        {/* -- Realtime mode notice ---------------------------------------- */}
        {activeTab === 'home' && viewMode === 'realtime' && (
          <div
            className="fanvibe-live-panel rounded-xl border border-white/10 p-4 flex items-start gap-3 shadow-sm"
            style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}
          >
            <Globe size={18} className="relative z-10 text-blue-200 shrink-0 mt-0.5" />
            <div className="relative z-10">
              <div className="text-sm font-bold text-white mb-1 drop-shadow-sm">FIFA World Cup 2026 - All 12 Groups</div>
              <div className="text-xs text-zinc-200/90 leading-relaxed">
                Official WC 2026 group stage fixtures (MD1 + MD2). Staking is open now for all {realtimeFixtures.length} listed matches.
                First kick-off <span className="font-semibold text-white">June 11, 2026</span>.
                Data source: <span className="font-semibold text-white">{worldCupSourceLabel}</span> ({worldCupFreshness}).
              </div>
            </div>
          </div>
        )}

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

        {activeTab === 'portfolio' && <MyPositions />}

        {activeTab === 'search' && viewMode === 'realtime' && groupFilter !== 'all' && (
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
                fixtures={realtimeFixtures}
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
        {(activeTab === 'home' || activeTab === 'search') && !showPreseasonSearchLiveEmpty && (viewMode !== 'simulated' || seasonHydrated) && (viewMode === 'simulated' && fixtureRoundFilter === 'bracket' ? (
          <BracketView
            fixtures={fixtures}
            matchStates={matchStates}
            onWatch={handleWatch}
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
            {viewMode === 'realtime' && fixtureGroupFilter !== 'all' && (
              <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                Group {fixtureGroupFilter} Fixtures
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
                  onStake={handleStake}
                  onWatch={viewMode === 'simulated' ? handleWatch : () => {}}
                />
              ))}
            </div>
            {orderedVisibleFixtures.length === 0 && (
              <div className="rounded-lg border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white px-4 py-8 text-center text-sm dark:text-zinc-500 text-zinc-500">
                No matches found. Try a team name, code, group, or venue.
              </div>
            )}
          </section>
        ))}

        {/* -- Activity feed toggle ---------------------------------------- */}
        {activeTab === 'portfolio' && (
        <div className="dark:border-zinc-900 border-zinc-200 border rounded-xl overflow-hidden">
          <button
            onClick={() => setLogOpen(o => !o)}
            className="w-full flex items-center justify-between gap-4 px-4 py-3 text-xs dark:text-zinc-600 text-zinc-500 dark:hover:text-zinc-400 hover:text-zinc-700 transition-colors dark:bg-transparent bg-white"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-semibold dark:text-zinc-400 text-zinc-600">Agent Self Maintenance History</span>
              <span className="season-status-rotate hidden sm:inline-flex text-[11px] font-semibold dark:text-zinc-500 text-zinc-400">
                <span>{logs.length} maintenance entries</span>
                <span>{engineOnline ? 'Engine online' : 'Engine offline'}</span>
                <span>{logs[logs.length - 1]?.prefix ?? 'SYSTEM'} monitor</span>
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
                {seasonWinners.length > 0 ? (
                  [...seasonWinners, ...seasonWinners].map((winner, index) => (
                    <span key={`${winner.seasonNumber}-${winner.team.code}-${index}`}>
                      <strong>S{String(winner.seasonNumber).padStart(2, '0')} winner</strong> - {winner.team.name}
                    </span>
                  ))
                ) : (
                  <>
                    <span><strong>S01 winner</strong> - RSA</span>
                    <span><strong>S01 winner</strong> - RSA</span>
                    <span><strong>S01 winner</strong> - RSA</span>
                    <span><strong>S01 winner</strong> - RSA</span>
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
        <div className="dark:border-zinc-900 border-zinc-200 border rounded-xl overflow-hidden">
          <button
            onClick={() => setProofOpen(o => !o)}
            className="w-full flex items-center justify-between gap-4 px-4 py-3 text-xs dark:text-zinc-600 text-zinc-500 dark:hover:text-zinc-400 hover:text-zinc-700 transition-colors dark:bg-transparent bg-white"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-semibold dark:text-zinc-400 text-zinc-600">X Layer Proof</span>
              <span className="hidden sm:inline-flex min-w-0 text-[11px] font-semibold dark:text-zinc-500 text-zinc-400">
                Chain 196 - {lastBlock > 0 ? `block ${lastBlock.toLocaleString()}` : 'indexing pending'} - {wsConnected || engineOnline ? 'engine online' : 'engine offline'}
              </span>
            </span>
            {proofOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {proofOpen && (
            <div className="border-t dark:border-zinc-900 border-zinc-100 dark:bg-zinc-950/80 bg-white px-4 py-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Network</div>
                  <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">X Layer Mainnet</div>
                  <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">Chain ID 196, OKB gas</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Wallet</div>
                  {refereeAddress ? (
                    <a href={explorerAddr(refereeAddress)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900 hover:text-blue-500">
                      {shortAddr(refereeAddress)}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <div className="mt-1 text-sm font-semibold dark:text-zinc-500 text-zinc-500">Not connected</div>
                  )}
                  <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">Settlement account controlled by the referee engine</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Block</div>
                  {lastBlock > 0 ? (
                    <a href={explorerBlock(lastBlock)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900 hover:text-blue-500">
                      {lastBlock.toLocaleString()}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <div className="mt-1 text-sm font-semibold dark:text-zinc-500 text-zinc-500">Waiting for RPC</div>
                  )}
                  <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">Latest indexed X Layer block</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Balance</div>
                  <div className={`mt-1 text-sm font-semibold tabular-nums ${healthColor}`}>{metabolism.okbBalanceFormatted} OKB</div>
                  <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">{metabolism.healthPercent}% gas health</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Engine</div>
                  <div className={`mt-1 text-sm font-semibold ${wsConnected || engineOnline ? 'dark:text-emerald-300 text-emerald-600' : 'dark:text-zinc-500 text-zinc-500'}`}>
                    {wsConnected || engineOnline ? 'Online' : 'Offline'}
                  </div>
                  <div className="mt-0.5 text-xs dark:text-zinc-500 text-zinc-500">{wsConnected ? 'WebSocket connected' : 'HTTP state checks active'}</div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border dark:border-zinc-900 border-zinc-100 px-3 py-3 text-xs leading-relaxed dark:text-zinc-400 text-zinc-600">
                FanVibe keeps the game readable for users and verifiable for judges: fixtures and stakes are tracked by the app, settlement actions are sent from the referee wallet, and every payout transaction links back to X Layer explorer records. Redis persistence keeps season state durable across Railway restarts.
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-lg border dark:border-zinc-900 border-zinc-100 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Tracked Pool</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">{fmtOKBWei(proofPoolWei)}</div>
                </div>
                <div className="rounded-lg border dark:border-zinc-900 border-zinc-100 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Open Fixtures</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">{fixtures.filter(f => f.status === 'open').length}</div>
                </div>
                <div className="rounded-lg border dark:border-zinc-900 border-zinc-100 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Settlements</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">{settlements.length}</div>
                </div>
                <div className="rounded-lg border dark:border-zinc-900 border-zinc-100 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Persistence</div>
                  <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">{seasonDurable ? 'Redis active' : 'Local fallback'}</div>
                  <div className="mt-0.5 truncate text-[10px] dark:text-zinc-600 text-zinc-400">{worldCupSourceLabel} - {worldCupFreshness}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Recent Stake Transactions</div>
                  <div className="space-y-2">
                    {proofStakeTxs.length > 0 ? proofStakeTxs.map(log => (
                      <a key={`${log.id}-${log.txHash}`} href={explorerTx(log.txHash!)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 rounded-lg border dark:border-zinc-900 border-zinc-100 px-3 py-2 text-xs transition-colors dark:hover:border-blue-500/40 hover:border-blue-300">
                        <span className="min-w-0 truncate dark:text-zinc-300 text-zinc-700">{log.message}</span>
                        <span className="shrink-0 font-semibold tabular-nums dark:text-zinc-500 text-zinc-500">{shortAddr(log.txHash!)}</span>
                      </a>
                    )) : (
                      <div className="rounded-lg border dark:border-zinc-900 border-zinc-100 px-3 py-2 text-xs dark:text-zinc-500 text-zinc-500">No stake transactions indexed yet.</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Recent Payout Transactions</div>
                  <div className="space-y-2">
                    {proofPayoutTxs.length > 0 ? proofPayoutTxs.map(payout => (
                      <a key={`${payout.fixtureId}-${payout.txHash}`} href={explorerTx(payout.txHash)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 rounded-lg border dark:border-zinc-900 border-zinc-100 px-3 py-2 text-xs transition-colors dark:hover:border-blue-500/40 hover:border-blue-300">
                        <span className="min-w-0 truncate dark:text-zinc-300 text-zinc-700">{payout.fixtureId} payout</span>
                        <span className="shrink-0 font-semibold tabular-nums dark:text-zinc-500 text-zinc-500">{fmtOKBWei(payout.amountWei)} - {shortAddr(payout.txHash)}</span>
                      </a>
                    )) : (
                      <div className="rounded-lg border dark:border-zinc-900 border-zinc-100 px-3 py-2 text-xs dark:text-zinc-500 text-zinc-500">Payout links appear after a settled match has winners.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {activeTab === 'news' && <WorldCupNews />}

        {/* Footer */}
        <div className="border-t dark:border-zinc-900 border-zinc-100 pt-4 pb-4 text-center space-y-2">
          <div className="flex items-center justify-center gap-4">
            <a
              href="https://x.com/xcupfanvibe"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs dark:text-zinc-600 text-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-600 transition-colors"
            >
              X/Twitter
            </a>
          </div>
          <div className="text-[11px] dark:text-zinc-600 text-zinc-400">
            Built on OKX Xlayer . 02
          </div>
        </div>
      </main>

      {stakeTarget && activeFixture && (
        <StakeModal fixture={activeFixture} defaultOutcome={stakeTarget.outcome}
          refereeAddress={refereeAddress} onClose={() => setStakeTarget(null)}
          onStakeClosed={showStakeClosedNotice} />
      )}

      {pendingToasts.map(s => (
        <SettlementToast key={`${s.fixtureId}-${s.blockNumber}`} settlement={s} onDismiss={() => dismissToast(s)} />
      ))}

      {watchingFixture && displayWatchingMatchState && (
        <MatchViewer
          fixture={watchingFixture}
          fixtures={fixtures}
          matchState={displayWatchingMatchState}
          onClose={() => setWatchingId(null)}
        />
      )}

      {(activeTab === 'home' || activeTab === 'search') && viewMode === 'simulated' && !seasonHydrated && (
        <div
          className="fixed inset-0 z-[80] bg-black/90"
          style={{ animation: 'overlayIn 0.25s ease both' }}
        >
          <div className="absolute left-1/2 top-1/2 flex w-full max-w-xs -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-5 px-6 text-center">
            <div
              className="relative flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border border-white/10 shadow-2xl sm:h-36 sm:w-36"
              style={{
                animation: 'fanvibeLoadPulse 1.65s ease-in-out infinite',
                backgroundImage: `linear-gradient(180deg, rgba(2, 6, 23, 0.24), rgba(2, 6, 23, 0.72)), url(${FANVIBE_SEASON_BG})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              <div className="absolute inset-3 rounded-full border border-white/10 bg-black/18" />
              <div className="relative z-10 h-16 w-16 overflow-hidden rounded-full ring-1 ring-white/20 sm:h-20 sm:w-20">
                <img src={FANVIBE_HERO_LOGO} alt="" className="h-full w-full object-cover" />
              </div>
            </div>
            <div className="text-base font-semibold tracking-tight text-white">
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
                style={{ width: `${(phaseTimer / 10) * 100}%` }}
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

