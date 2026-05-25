import { useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, http, formatEther } from 'viem';
import { ChevronDown, ChevronUp, Globe, Info } from 'lucide-react';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { FixtureCard } from './components/FixtureCard';
import { LogStream } from './components/LogStream';
import { StakeModal } from './components/StakeModal';
import { SettlementToast } from './components/SettlementToast';
import { FuelBar } from './components/FuelBar';
import { MatchViewer } from './components/MatchViewer';
import { GroupTable } from './components/GroupTable';
import type { DaemonState, DaemonLog, Fixture, Pool, Outcome, SettlementResult, MetabolicState, MatchState, Team } from './types';
import { REALTIME_FIXTURES } from './types';
import { BracketView } from './components/BracketView';
import { ChampionPick } from './components/ChampionPick';
import { simulateMatch } from './lib/clientSim';
import { xLayerMainnet, explorerAddr } from './lib/chain';
import { shortAddr } from './lib/encode';
import {
  SEASON_GROUPS,
  SEASON_INTERMISSION_SECONDS,
  SEASON_PRESTART_SECONDS,
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
} from './lib/seasonTournament';

const BACKEND_WS   = import.meta.env.VITE_BACKEND_WS   ?? 'ws://localhost:3001';
const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP  ?? 'http://localhost:3001';
const REFEREE_ADDR = (import.meta.env.VITE_REFEREE_ADDRESS ?? '') as string;
const FANVIBE_SEASON_BG = '/assets/fanvibe-season-bg.jpeg';
const FANVIBE_HERO_LOGO = '/assets/fanvibe-hero-logo.jpeg';

const rpcClient = createPublicClient({ chain: xLayerMainnet, transport: http('https://rpc.xlayer.tech') });

type SeasonPhase = 'preseason' | 'playing' | 'champion' | 'interseason';

interface StoredSeasonState {
  seasonNumber: number;
  phase: SeasonPhase;
  phaseEndsAt: number;
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  eliminatedTeams: string[];
  champion: Team | null;
  tournamentGen: number;
}

interface InitialSeasonState extends StoredSeasonState {
  phaseTimer: number;
}

function defaultMetabolism(): MetabolicState {
  return { okbBalance: '0', okbBalanceFormatted: '0.000000', healthPercent: 0, isRefuelNeeded: false, checkedAt: Date.now() };
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function seasonFixturesFromState(incoming: Fixture[]): Fixture[] {
  if (!incoming.length) return createSeasonFixtures(1);
  if (incoming.some(f => f.id.startsWith('r32-'))) return createSeasonFixtures(1);
  return incoming;
}

function freshSeasonState(seasonNumber = 1, now = Date.now()): InitialSeasonState {
  return {
    seasonNumber,
    phase: 'preseason',
    phaseEndsAt: now + SEASON_PRESTART_SECONDS * 1000,
    phaseTimer: SEASON_PRESTART_SECONDS,
    fixtures: createSeasonFixtures(seasonNumber),
    matchStates: {},
    eliminatedTeams: [],
    champion: null,
    tournamentGen: 0,
  };
}

function resolveSeasonState(parsed: Partial<StoredSeasonState> | null | undefined): InitialSeasonState {
  const fallback = freshSeasonState(1);
  if (!parsed?.fixtures?.length || parsed.fixtures.some(f => f.id?.startsWith('r32-'))) return fallback;

  try {
    const now = Date.now();
    let phase = parsed.phase ?? 'preseason';
    let phaseEndsAt = Number(parsed.phaseEndsAt || 0);
    let seasonNumber = Math.max(1, Number(parsed.seasonNumber || 1));
    let fixtures = parsed.fixtures ?? fallback.fixtures;
    let matchStates = parsed.matchStates ?? {};
    let champion = parsed.champion ?? null;
    let tournamentGen = Number(parsed.tournamentGen || 0);
    let eliminatedTeams = parsed.eliminatedTeams ?? [];

    if (!['preseason', 'playing', 'champion', 'interseason'].includes(phase) || phaseEndsAt <= 0) {
      return fallback;
    }

    if (phase !== 'playing' && now >= phaseEndsAt) {
      if (phase === 'preseason') {
        phase = 'playing';
      } else if (phase === 'champion') {
        phase = 'interseason';
        phaseEndsAt = now + SEASON_INTERMISSION_SECONDS * 1000;
        champion = null;
      } else if (phase === 'interseason') {
        seasonNumber += 1;
        phase = 'preseason';
        phaseEndsAt = now + SEASON_PRESTART_SECONDS * 1000;
        fixtures = createSeasonFixtures(seasonNumber);
        matchStates = {};
        eliminatedTeams = [];
        champion = null;
        tournamentGen += 1;
      }
    }

    return {
      seasonNumber,
      phase,
      phaseEndsAt,
      phaseTimer: phase === 'playing' ? 0 : Math.max(0, Math.ceil((phaseEndsAt - now) / 1000)),
      fixtures,
      matchStates,
      eliminatedTeams,
      champion,
      tournamentGen,
    };
  } catch {
    return fallback;
  }
}

export default function App() {
  const initialSeasonRef = useRef<InitialSeasonState | null>(null);
  if (!initialSeasonRef.current) initialSeasonRef.current = freshSeasonState(1);
  const initialSeason = initialSeasonRef.current;

  const [dark, setDark] = useState(true);
  const [engineOnline, setEngineOnline]         = useState(false);
  const [refereeAddress, setRefereeAddress]     = useState(REFEREE_ADDR);
  const [metabolism, setMetabolism]             = useState<MetabolicState>(defaultMetabolism);
  const [fixtures, setFixtures]                 = useState<Fixture[]>(initialSeason.fixtures);
  const [pools, setPools]                       = useState<Record<string, Pool>>({});
  const [logs, setLogs]                         = useState<DaemonLog[]>([]);
  const [lastBlock, setLastBlock]               = useState(0);
  const [wsConnected, setWsConnected]           = useState(false);
  const [settlements, setSettlements]           = useState<SettlementResult[]>([]);
  const [pendingToasts, setPendingToasts]       = useState<SettlementResult[]>([]);
  const [stakeTarget, setStakeTarget]           = useState<{ fixtureId: string; outcome: Outcome } | null>(null);
  const [logOpen, setLogOpen]                   = useState(false);
  const [howOpen, setHowOpen]                   = useState(false);
  const [roundFilter, setRoundFilter]           = useState<string>('all');
  const [groupFilter, setGroupFilter]           = useState<string>('all');
  const [matchStates, setMatchStates]           = useState<Record<string, MatchState>>(initialSeason.matchStates);
  const [watchingFixtureId, setWatchingId]      = useState<string | null>(null);
  const [viewMode, setViewMode]                 = useState<'simulated' | 'realtime'>('simulated');
  const [eliminatedTeams, setEliminatedTeams]   = useState<Set<string>>(() => new Set(initialSeason.eliminatedTeams));
  const [champion, setChampion]                 = useState<Team | null>(initialSeason.champion);
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
  const seasonHydratedRef      = useRef(false);
  const seasonSaveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  const applySeasonState = useCallback((state: InitialSeasonState) => {
    setSeasonNumber(state.seasonNumber);
    setPhase(state.phase);
    setPhaseEndsAt(state.phaseEndsAt);
    setPhaseTimer(state.phaseTimer);
    setFixtures(state.fixtures);
    setMatchStates(state.matchStates);
    setEliminatedTeams(new Set(state.eliminatedTeams));
    setChampion(state.champion);
    setTournamentGen(state.tournamentGen);
    setRoundFilter('all');
    setWatchingId(null);
    bracketProcessedRef.current.clear();
    championTriggeredRef.current = state.phase === 'champion';
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_HTTP}/season-state`)
      .then(async r => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('season state unavailable');
        return await r.json();
      })
      .then((raw: Partial<StoredSeasonState> | { state: null } | null) => {
        if (cancelled) return;
        if (raw && !('state' in raw)) applySeasonState(resolveSeasonState(raw));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) seasonHydratedRef.current = true;
      });
    return () => { cancelled = true; };
  }, [applySeasonState]);

  useEffect(() => {
    if (!seasonHydratedRef.current) return;
    if (seasonSaveTimerRef.current) clearTimeout(seasonSaveTimerRef.current);
    const snapshot: StoredSeasonState = {
      seasonNumber,
      phase,
      phaseEndsAt,
      fixtures,
      matchStates,
      eliminatedTeams: [...eliminatedTeams],
      champion,
      tournamentGen,
    };
    seasonSaveTimerRef.current = setTimeout(() => {
      fetch(`${BACKEND_HTTP}/season-state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      }).catch(() => {});
    }, 400);
    return () => {
      if (seasonSaveTimerRef.current) clearTimeout(seasonSaveTimerRef.current);
    };
  }, [seasonNumber, phase, phaseEndsAt, fixtures, matchStates, eliminatedTeams, champion, tournamentGen]);

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
          setMatchStates(prev => {
            const incoming = s.matchStates ?? {};
            return Object.keys(incoming).length ? { ...prev, ...incoming } : prev;
          });
        } else if (msg.type === 'log') {
          setLogs(prev => [...prev.slice(-199), msg.data as DaemonLog]);
        } else if (msg.type === 'settlement') {
          const s = msg.data as SettlementResult;
          setSettlements(prev => [...prev, s]);
          setPendingToasts(prev => [...prev, s]);
          setFixtures(prev => prev.map(f => f.id === s.fixtureId ? { ...f, status: 'settled', result: s.outcome } : f));
        } else if (msg.type === 'season-state') {
          applySeasonState(resolveSeasonState(msg.data as Partial<StoredSeasonState>));
        } else if (msg.type === 'season-state-reset') {
          applySeasonState(freshSeasonState(1));
        }
      } catch { /* malformed */ }
    };

    ws.onclose = () => { setEngineOnline(false); reconnectRef.current = setTimeout(connectWS, 5000); };
    ws.onerror = () => ws.close();
  }, []);

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
        setMatchStates(prev => {
          const incoming = s.matchStates ?? {};
          return Object.keys(incoming).length ? { ...prev, ...incoming } : prev;
        });
      })
      .catch(() => {});

    return () => { wsRef.current?.close(); if (reconnectRef.current) clearTimeout(reconnectRef.current); };
  }, [connectWS]);

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
  }, [applySeasonState]);

  // -- Tournament phase transitions --------------------------------------------
  const startPreseason = useCallback((nextSeasonNumber = seasonNumber) => {
    resetRuntimeTournamentRefs();
    const endsAt = Date.now() + SEASON_PRESTART_SECONDS * 1000;
    setSeasonNumber(nextSeasonNumber);
    setMatchStates({});
    setFixtures(createSeasonFixtures(nextSeasonNumber));
    setEliminatedTeams(new Set());
    setChampion(null);
    setTournamentGen(g => g + 1);
    setRoundFilter('all');
    setWatchingId(null);
    setPhase('preseason');
    setPhaseEndsAt(endsAt);
    setPhaseTimer(SEASON_PRESTART_SECONDS);
  }, [resetRuntimeTournamentRefs, seasonNumber]);

  const startInterseason = useCallback(() => {
    resetRuntimeTournamentRefs();
    const endsAt = Date.now() + SEASON_INTERMISSION_SECONDS * 1000;
    setChampion(null);
    setWatchingId(null);
    setPhase('interseason');
    setPhaseEndsAt(endsAt);
    setPhaseTimer(SEASON_INTERMISSION_SECONDS);
  }, [resetRuntimeTournamentRefs]);

  // -- Phase / season timer -----------------------------------------------------
  useEffect(() => {
    if (phase === 'playing') return;

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
        startInterseason();
        return;
      }

      if (phase === 'interseason') {
        startPreseason(seasonNumber + 1);
      }
    };

    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [phase, phaseEndsAt, seasonNumber, startInterseason, startPreseason]);

  useEffect(() => {
    if (phase !== 'playing' || viewMode !== 'simulated') return;
    const t = setInterval(() => setSeasonClockTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase, viewMode]);

  // -- Client-side simulation ---------------------------------------------------
  useEffect(() => {
    if (viewMode !== 'simulated' || phase !== 'playing') return;
    fixtures.forEach(fx => {
      if (fx.status !== 'open' && fx.status !== 'locked') return;
      if (fx.home.code === 'TBD' || fx.away.code === 'TBD') return;
      if (!isSeasonFixtureDue(fixtures, fx, phaseEndsAt, matchStates)) return;
      if (simCleanupRef.current.has(fx.id)) return;
      if (matchStates[fx.id]?.status === 'finished') return;
      setFixtures(prev => prev.map(item => item.id === fx.id ? { ...item, status: 'locked' } : item));
      const cleanup = simulateMatch(fx, (state) => {
        setMatchStates(prev => ({ ...prev, [fx.id]: state }));
      }, undefined, matchStates[fx.id]);
      simCleanupRef.current.set(fx.id, cleanup);
    });
  }, [viewMode, phase, fixtures, matchStates, phaseEndsAt, seasonClockTick]);

  // Seed knockouts after the 12 World Cup groups complete.
  useEffect(() => {
    if (viewMode !== 'simulated' || phase !== 'playing') return;
    if (!allGroupMatchesFinished(fixtures, matchStates)) return;
    if (fixtures.some(f => f.id === 'k32-1' && f.home.code !== 'TBD')) return;
    const qualified = new Set(qualifiedTeams(fixtures, matchStates).map(team => team.code));
    const allTeams = new Set(fixtures.filter(isGroupStageFixture).flatMap(f => [f.home.code, f.away.code]));
    setEliminatedTeams(new Set([...allTeams].filter(code => !qualified.has(code))));
    setFixtures(prev => seedRoundOf32(prev, matchStates));
  }, [fixtures, matchStates, viewMode, phase]);

  // Advance knockout bracket when a match finishes.
  useEffect(() => {
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
  }, [matchStates, viewMode]);

  // Detect Final finish -> champion phase
  useEffect(() => {
    if (viewMode !== 'simulated' || phase !== 'playing') return;
    const ms = matchStates['f-1'];
    if (ms?.status !== 'finished') return;
    if (championTriggeredRef.current) return;
    championTriggeredRef.current = true;
    const fx = fixtures.find(f => f.id === 'f-1');
    if (!fx) return;
    const winner = ms.homeScore >= ms.awayScore ? fx.home : fx.away;
    setChampion(winner);
    setPhase('champion');
    setPhaseEndsAt(Date.now() + 10 * 1000);
    setPhaseTimer(10);
  }, [matchStates, viewMode, phase, fixtures]);

  const handleStake    = useCallback((fixtureId: string, outcome: Outcome) => setStakeTarget({ fixtureId, outcome }), []);
  const dismissToast   = useCallback((s: SettlementResult) => setPendingToasts(prev => prev.filter(x => x !== s)), []);
  const handleWatch    = useCallback((fixtureId: string) => setWatchingId(fixtureId), []);

  useEffect(() => {
    watchedStateRef.current = { ...watchedStateRef.current, ...matchStates };
  }, [matchStates]);

  const activeFixture  = stakeTarget ? fixtures.find(f => f.id === stakeTarget.fixtureId) ?? null : null;
  const watchingFixture = watchingFixtureId ? fixtures.find(f => f.id === watchingFixtureId) ?? null : null;
  const watchingMatchState = watchingFixtureId
    ? matchStates[watchingFixtureId] ?? watchedStateRef.current[watchingFixtureId] ?? null
    : null;

  const simFixtures    = viewMode === 'simulated' ? fixtures : REALTIME_FIXTURES;
  const rtGroups       = ['all', ...Array.from(new Set(REALTIME_FIXTURES.map(f => f.group))).sort()];
  const activeGroupMatchday = currentGroupMatchday(simFixtures, matchStates);
  const visibleFixtures = viewMode === 'simulated'
    ? (roundFilter === 'all'
      ? simFixtures.filter(f => isGroupStageFixture(f) && f.matchday === activeGroupMatchday)
      : roundFilter.startsWith('md')
        ? simFixtures.filter(f => isGroupStageFixture(f) && f.matchday === Number(roundFilter.replace('md', '')))
      : roundFilter === 'knockouts'
        ? simFixtures.filter(f => !!f.round)
        : SEASON_GROUPS.includes(roundFilter)
          ? simFixtures.filter(f => f.group === roundFilter && isGroupStageFixture(f))
          : simFixtures)
    : (groupFilter === 'all' ? REALTIME_FIXTURES : REALTIME_FIXTURES.filter(f => f.group === groupFilter));
  const selectedGroupFixtures = viewMode === 'realtime' && groupFilter !== 'all'
    ? REALTIME_FIXTURES.filter(f => f.group === groupFilter)
    : [];
  const selectedGroupResults = selectedGroupFixtures.filter(f => matchStates[f.id]?.status === 'finished');
  const simulatedFixtureSectionLabel = viewMode === 'simulated'
    ? roundFilter === 'all'
      ? `Matchday ${activeGroupMatchday} Fixtures`
      : roundFilter.startsWith('md')
        ? `Matchday ${roundFilter.replace('md', '')} Fixtures`
        : roundFilter === 'knockouts'
          ? 'Knockout Fixtures'
          : SEASON_GROUPS.includes(roundFilter)
            ? `Group ${roundFilter} Fixtures`
            : 'Season Fixtures'
    : '';

  const healthColor = metabolism.isRefuelNeeded
    ? 'dark:text-red-400 text-red-600'
    : metabolism.healthPercent < 40
    ? 'dark:text-blue-300 text-blue-600'
    : 'dark:text-emerald-400 text-emerald-600';

  const seasonLabel = `FanVibe Season ${seasonNumber}`;
  const seasonStartsAt = new Date(Date.now() + phaseTimer * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const seasonStartedAt = phase === 'playing' ? phaseEndsAt : Date.now() + phaseTimer * 1000;
  const liveEntries = viewMode === 'simulated'
    ? Object.entries(matchStates).filter(([, ms]) => ms.status === 'live')
    : [];
  const finishedSeasonCount = viewMode === 'simulated'
    ? Object.values(matchStates).filter(ms => ms.status === 'finished').length
    : 0;
  const seasonStatusDetail = phase === 'preseason'
    ? `Kick-off in ${fmtDuration(phaseTimer)}`
    : phase === 'interseason'
      ? `Next season in ${fmtDuration(phaseTimer)}`
      : phase === 'champion'
        ? 'Final settled'
        : `Matchday ${activeGroupMatchday} live`;
  const seasonStatusAccent = phase === 'playing'
    ? `${liveEntries.length} live - ${finishedSeasonCount} FT`
    : phase === 'preseason'
      ? 'Staking open'
      : 'Broadcast reset';

  return (
    <div className="min-h-screen dark:bg-black bg-zinc-50 dark:text-zinc-100 text-zinc-900 font-sans">

      {/* -- Header ----------------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/95 bg-white/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4">

          {/* Brand */}
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={FANVIBE_HERO_LOGO}
              alt="X Cup FanVibe"
              className="h-8 w-8 rounded-md object-cover ring-1 ring-black/10 dark:ring-white/10"
            />
            <span className="truncate text-sm sm:text-base font-semibold tracking-tight dark:text-white text-zinc-950">X Cup FanVibe</span>
            {viewMode === 'simulated' && (
              <span className="hidden sm:inline text-[11px] font-medium dark:text-zinc-500 text-zinc-500">
                {seasonLabel}
              </span>
            )}
            <span className="hidden lg:inline text-[11px] font-medium dark:text-zinc-600 text-zinc-400">
              X Layer 196
            </span>
          </div>

          {/* Status strip */}
          <div className="hidden lg:flex items-center gap-5 text-[11px] dark:text-zinc-500 text-zinc-500">
            {lastBlock > 0 && (
              <span className="whitespace-nowrap">
                <span className="mr-1 dark:text-zinc-700 text-zinc-400">Block</span>
                <span className="font-medium tabular-nums dark:text-zinc-300 text-zinc-700">{lastBlock.toLocaleString()}</span>
              </span>
            )}
            {refereeAddress && (
              <a href={explorerAddr(refereeAddress)} target="_blank" rel="noopener noreferrer"
                className="whitespace-nowrap transition-colors dark:hover:text-white hover:text-zinc-950">
                <span className="mr-1 dark:text-zinc-700 text-zinc-400">Wallet</span>
                <span className="font-medium dark:text-zinc-300 text-zinc-700">{shortAddr(refereeAddress)}</span>
              </a>
            )}
            <span className="whitespace-nowrap">
              <span className="mr-1 dark:text-zinc-700 text-zinc-400">Balance</span>
              <span className={`font-medium tabular-nums ${healthColor}`}>{metabolism.okbBalanceFormatted} OKB</span>
            </span>
            <div className="w-16 opacity-80">
              <FuelBar percent={metabolism.healthPercent} okbFormatted="" isRefuelNeeded={metabolism.isRefuelNeeded} compact />
            </div>
            <span className="whitespace-nowrap">
              <span className="mr-1 dark:text-zinc-700 text-zinc-400">Engine</span>
              <span className={`font-medium ${wsConnected || engineOnline ? 'dark:text-zinc-300 text-zinc-700' : 'dark:text-zinc-600 text-zinc-400'}`}>
                {wsConnected || engineOnline ? 'Online' : 'Offline'}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline lg:hidden text-[11px] font-medium dark:text-zinc-500 text-zinc-500">
              {wsConnected || engineOnline ? 'Online' : 'Offline'}
            </span>
            <ThemeSwitcher dark={dark} onToggle={() => setDark(d => !d)} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* -- Mode toggle ------------------------------------------------- */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1 p-1 dark:bg-zinc-900 bg-zinc-100 rounded-xl border dark:border-zinc-800 border-zinc-200">
            <button
              onClick={() => setViewMode('simulated')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200
                ${viewMode === 'simulated'
                  ? 'bg-emerald-500 text-black shadow-sm'
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

          <div className="hidden sm:flex items-center gap-2 rounded-full border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950 bg-white px-3 py-1.5 shadow-sm">
            {viewMode === 'simulated' ? (
              <>
                <span className="text-[11px] font-bold tracking-tight dark:text-white text-zinc-950">World Cup Season</span>
                <span className="season-status-rotate text-[11px] font-semibold dark:text-zinc-300 text-zinc-600">
                  <span>{seasonStatusDetail}</span>
                  <span>{seasonStatusAccent}</span>
                  <span>{seasonLabel}</span>
                </span>
                <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-300">
                  {phase === 'playing' ? `MD${activeGroupMatchday}` : fmtDuration(phaseTimer)}
                </span>
              </>
            ) : (
              <>
                <span className="text-[11px] font-bold dark:text-white text-zinc-950">World Cup 2026</span>
                <span className="text-[11px] font-semibold dark:text-zinc-400 text-zinc-500">Staking open - first kick-off Jun 11 2026</span>
              </>
            )}
          </div>
        </div>

        {/* -- Pre-season banner ------------------------------------------- */}
        {viewMode === 'simulated' && phase === 'preseason' && (
          <div
            className="fanvibe-live-panel rounded-lg border border-white/10 p-4 flex items-center justify-between gap-4 flex-wrap shadow-sm"
            style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}
          >
            <div className="relative z-10">
              <div className="text-sm font-semibold text-white mb-0.5 drop-shadow-sm">World Cup Season - Staking Open</div>
              <div className="text-xs text-zinc-200/90">
                First fixture window begins at {seasonStartsAt}. More group matches follow in shared broadcast waves.
              </div>
            </div>
            <div className="relative z-10 rounded-md border border-white/10 bg-black/35 px-4 py-2 text-center backdrop-blur-[2px]">
              <div className="text-3xl font-semibold text-white tabular-nums leading-none">{fmtDuration(phaseTimer)}</div>
              <div className="text-[10px] font-mono text-zinc-300 uppercase mt-0.5">until kick-off</div>
            </div>
          </div>
        )}

        {/* -- Inter-season banner ----------------------------------------- */}
        {viewMode === 'simulated' && phase === 'interseason' && (
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
              <div className="text-[10px] font-mono dark:text-zinc-500 text-zinc-400 uppercase mt-0.5">until next season</div>
            </div>
          </div>
        )}

        {/* Recent settlements strip */}
        {settlements.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <span className="text-xs dark:text-zinc-500 text-zinc-400 shrink-0 font-mono font-semibold uppercase tracking-wider">Settled</span>
            {[...settlements].reverse().slice(0, 5).map((s) => {
              const fix = fixtures.find(f => f.id === s.fixtureId);
              return (
                <a key={`${s.fixtureId}-${s.blockNumber}`} href={s.explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border dark:border-zinc-800 border-zinc-300 dark:hover:border-zinc-700 hover:border-zinc-400 dark:text-zinc-200 text-zinc-700 text-xs font-medium transition-colors">
                  <span>{fix ? `${fix.home.flag} vs ${fix.away.flag}` : s.fixtureId}</span>
                  <span className="text-emerald-500 font-mono font-semibold capitalize">{s.outcome}</span>
                </a>
              );
            })}
          </div>
        )}

        {/* -- Round / group filter tabs ----------------------------------- */}
        {viewMode === 'simulated' ? (
          <div className="flex items-center gap-2 overflow-x-auto rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950/80 bg-white p-1.5 shadow-sm scrollbar-none">
            {[
              { id: 'all', label: `Live MD${activeGroupMatchday}`, tone: 'live' },
              { id: 'md1', label: 'Matchday 1', tone: 'matchday' },
              { id: 'md2', label: 'Matchday 2', tone: 'matchday' },
              { id: 'md3', label: 'Matchday 3', tone: 'matchday' },
              ...SEASON_GROUPS.map(g => ({ id: g, label: `Group ${g}`, tone: 'group' })),
              { id: 'knockouts', label: 'Knockouts', tone: 'knockout' },
              { id: 'bracket', label: 'Bracket', tone: 'bracket' },
            ].map(t => (
              <button key={t.id} onClick={() => setRoundFilter(t.id)}
                className={`season-filter-tab shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-150
                  ${roundFilter === t.id
                    ? t.tone === 'live'
                      ? 'bg-emerald-500 text-black shadow-sm'
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
                className={`season-filter-tab shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-150
                  ${groupFilter === g
                    ? 'dark:bg-blue-500 dark:text-white bg-blue-600 text-white'
                    : 'dark:text-zinc-400 text-zinc-500 border dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-300 dark:hover:text-zinc-100 hover:text-zinc-900 dark:bg-zinc-900/35 bg-zinc-50'}`}>
                {g === 'all' ? 'All Groups' : `Group ${g}`}
              </button>
            ))}
          </div>
        )}

        {/* -- Simulation running indicator -------------------------------- */}
        {viewMode === 'simulated' && phase === 'playing' && (() => {
          const railEntries = liveEntries.length > 1 ? [...liveEntries, ...liveEntries] : liveEntries;
          return (
            <div className="live-score-rail flex items-center gap-3 rounded-xl border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950 bg-white px-3 py-2 shadow-sm">
              <div className="shrink-0">
                <div className="text-[10px] font-extrabold tracking-[0.18em] dark:text-zinc-400 text-zinc-500">LIVE SCORES</div>
                {liveEntries.length > 0 ? (
                  <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-300">{liveEntries.length} live - {finishedSeasonCount} FT</div>
                ) : (
                  <div className="text-[11px] font-bold text-blue-600 dark:text-blue-300">MD{activeGroupMatchday} broadcast window</div>
                )}
              </div>
              <div className="live-score-mask min-w-0 flex-1 overflow-hidden">
                {liveEntries.length > 0 ? (
                  <div className={liveEntries.length > 2 ? 'live-score-track flex items-center gap-2' : 'flex items-center gap-2'}>
                    {railEntries.map(([id, ms], index) => {
                      const fx = fixtures.find(f => f.id === id);
                      if (!fx) return null;
                      return (
                        <button
                          key={`${id}-${index}`}
                          onClick={() => setWatchingId(id)}
                          className="shrink-0 flex items-center gap-2 rounded-lg border dark:border-zinc-700 border-zinc-200 dark:bg-zinc-900 bg-zinc-50 px-3 py-1.5 transition-all hover:border-emerald-400/60 active:scale-95"
                        >
                          <span className="text-xs font-extrabold dark:text-white text-zinc-950">{fx.home.code}</span>
                          <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[11px] font-black tabular-nums text-black">{ms.homeScore}-{ms.awayScore}</span>
                          <span className="text-xs font-extrabold dark:text-white text-zinc-950">{fx.away.code}</span>
                          <span className="text-[11px] font-bold tabular-nums text-blue-600 dark:text-blue-300">{ms.minute}&apos;</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs font-semibold dark:text-zinc-300 text-zinc-600">
                    Waiting for the next fixture wave. Completed cards stay marked FT.
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* -- Realtime mode notice ---------------------------------------- */}
        {viewMode === 'realtime' && (
          <div
            className="fanvibe-live-panel rounded-xl border border-white/10 p-4 flex items-start gap-3 shadow-sm"
            style={{ '--fanvibe-bg': `url(${FANVIBE_SEASON_BG})` } as Record<string, string>}
          >
            <Globe size={18} className="relative z-10 text-blue-200 shrink-0 mt-0.5" />
            <div className="relative z-10">
              <div className="text-sm font-bold text-white mb-1 drop-shadow-sm">FIFA World Cup 2026 - All 12 Groups</div>
              <div className="text-xs text-zinc-200/90 leading-relaxed">
                Official WC 2026 group stage fixtures (MD1 + MD2). Staking is open now for all 48 matches.
                First kick-off <span className="font-semibold text-white">June 11, 2026</span>.
                Switch to Season Play to watch live simulated matches running right now.
              </div>
            </div>
          </div>
        )}

        {/* -- Champion prediction market --------------------------------- */}
        {viewMode === 'simulated' && (
          <ChampionPick
            key={tournamentGen}
            fixtures={fixtures}
            matchStates={matchStates}
            eliminatedTeams={eliminatedTeams}
            refereeAddress={refereeAddress}
          />
        )}

        {viewMode === 'realtime' && groupFilter !== 'all' && (
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-4 border-b dark:border-zinc-900 border-zinc-200 pb-3">
              <div>
                <div className="text-[11px] font-mono font-semibold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                  World Cup Group
                </div>
                <h2 className="mt-1 text-xl font-semibold tracking-tight dark:text-zinc-100 text-zinc-900">
                  Group {groupFilter}
                </h2>
              </div>
              <div className="text-right text-xs font-mono dark:text-zinc-500 text-zinc-400">
                {selectedGroupFixtures.length} fixtures
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
              <div className="dark:bg-zinc-950 bg-white border dark:border-zinc-900 border-zinc-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b dark:border-zinc-900 border-zinc-100">
                  <div className="text-xs font-mono font-bold uppercase tracking-widest dark:text-zinc-400 text-zinc-500">
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
                          <div className="mt-0.5 text-[11px] font-mono dark:text-zinc-600 text-zinc-400">
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
                fixtures={REALTIME_FIXTURES}
                matchStates={matchStates}
                selectedGroup={groupFilter}
              />
            </div>
          </section>
        )}

        {/* -- Bracket view OR fixture grid -------------------------------- */}
        {viewMode === 'simulated' && roundFilter === 'bracket' ? (
          <BracketView
            fixtures={fixtures}
            matchStates={matchStates}
            onWatch={handleWatch}
          />
        ) : (
          <section className="space-y-3">
            {viewMode === 'simulated' && roundFilter !== 'bracket' && (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-mono font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                  {simulatedFixtureSectionLabel}
                </div>
                {phase === 'playing' && (
                  <div className="text-[11px] font-mono dark:text-zinc-500 text-zinc-400">
                    MD1 {'->'} MD2 {'->'} MD3 {'->'} Knockouts {'->'} Final
                  </div>
                )}
              </div>
            )}
            {viewMode === 'realtime' && groupFilter !== 'all' && (
              <div className="text-xs font-mono font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                Group {groupFilter} Fixtures
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleFixtures.map(fixture => (
                <FixtureCard
                  key={fixture.id}
                  fixture={fixture}
                  pool={pools[fixture.id]}
                  matchState={viewMode === 'simulated' ? matchStates[fixture.id] : undefined}
                  seasonPhase={viewMode === 'simulated' ? phase : undefined}
                  seasonTimer={viewMode === 'simulated' ? phaseTimer : undefined}
                  seasonKickoffDelayMs={viewMode === 'simulated' ? seasonFixtureKickoffDelayMs(fixtures, fixture.id) : undefined}
                  seasonStartedAt={viewMode === 'simulated' ? seasonStartedAt : undefined}
                  seasonFixtureStartsAt={viewMode === 'simulated' ? seasonFixtureStartAtMs(fixtures, fixture, seasonStartedAt, matchStates) : undefined}
                  onStake={handleStake}
                  onWatch={viewMode === 'simulated' ? handleWatch : () => {}}
                />
              ))}
            </div>
          </section>
        )}

        {/* -- Activity feed toggle ---------------------------------------- */}
        <div className="dark:border-zinc-900 border-zinc-200 border rounded-xl overflow-hidden">
          <button
            onClick={() => setLogOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-mono dark:text-zinc-600 text-zinc-500 dark:hover:text-zinc-400 hover:text-zinc-700 transition-colors dark:bg-transparent bg-white"
          >
            <span className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${engineOnline ? 'bg-emerald-400 animate-pulse' : 'dark:bg-zinc-700 bg-zinc-300'}`} />
              Activity Feed - {logs.length} entries
            </span>
            {logOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {logOpen && <LogStream logs={logs} daemonOnline={engineOnline} />}
        </div>

        {/* -- How it works ----------------------------------------------- */}
        <div className="dark:border-zinc-900 border-zinc-200 border rounded-xl overflow-hidden">
          <button
            onClick={() => setHowOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-mono dark:text-zinc-600 text-zinc-500 dark:hover:text-zinc-400 hover:text-zinc-700 transition-colors dark:bg-transparent bg-white"
          >
            <span className="flex items-center gap-2">
              <Info size={13} />
              How it works
            </span>
            {howOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {howOpen && (
            <div className="px-4 pb-4 pt-1 space-y-2 text-xs dark:text-zinc-400 text-zinc-600 border-t dark:border-zinc-800 border-zinc-100">
              <p>- Send OKB to the Settlement Wallet with ABI-encoded calldata specifying your fixture and outcome.</p>
              <p>- When the match settles, the winning pool is distributed pro-rata to all backers of the correct outcome.</p>
              <p>- The Champion market pays out proportionally to all stakers who backed the tournament winner after the Final.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t dark:border-zinc-900 border-zinc-100 pt-4 pb-4 text-center space-y-2">
          <div className="flex items-center justify-center gap-4">
            <a
              href="https://x.com/xcupfanvibe"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono dark:text-zinc-600 text-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-600 transition-colors"
            >
              X / Twitter
            </a>
          </div>
          <div className="text-[11px] font-mono dark:text-zinc-600 text-zinc-400">
            Built on OKX X Layer - Settlement Wallet - O2 Autonomous Metabolism
          </div>
        </div>
      </main>

      {stakeTarget && activeFixture && (
        <StakeModal fixture={activeFixture} defaultOutcome={stakeTarget.outcome}
          refereeAddress={refereeAddress} onClose={() => setStakeTarget(null)} />
      )}

      {pendingToasts.map(s => (
        <SettlementToast key={`${s.fixtureId}-${s.blockNumber}`} settlement={s} onDismiss={() => dismissToast(s)} />
      ))}

      {watchingFixture && watchingMatchState && (
        <MatchViewer
          fixture={watchingFixture}
          matchState={watchingMatchState}
          onClose={() => setWatchingId(null)}
        />
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
            <p className="text-xs font-mono dark:text-zinc-400 text-zinc-400 mb-5">
              Next season in <span className="font-bold text-white tabular-nums">{phaseTimer}s</span>
            </p>

          </div>
        </div>
      )}
    </div>
  );
}

