import { useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, http, formatEther } from 'viem';
import { ChevronDown, ChevronUp, Zap, Globe, Info } from 'lucide-react';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { FixtureCard } from './components/FixtureCard';
import { LogStream } from './components/LogStream';
import { StakeModal } from './components/StakeModal';
import { SettlementToast } from './components/SettlementToast';
import { FuelBar } from './components/FuelBar';
import { MatchViewer } from './components/MatchViewer';
import { GroupTable } from './components/GroupTable';
import type { DaemonState, DaemonLog, Fixture, Pool, Outcome, SettlementResult, MetabolicState, MatchState, Team } from './types';
import { STATIC_FIXTURES, REALTIME_FIXTURES } from './types';
import { BracketView } from './components/BracketView';
import { ChampionPick } from './components/ChampionPick';
import { simulateMatch } from './lib/clientSim';
import { xLayerMainnet, explorerAddr } from './lib/chain';
import { shortAddr } from './lib/encode';

const BACKEND_WS   = import.meta.env.VITE_BACKEND_WS   ?? 'ws://localhost:3001';
const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP  ?? 'http://localhost:3001';
const REFEREE_ADDR = (import.meta.env.VITE_REFEREE_ADDRESS ?? '') as string;

const rpcClient = createPublicClient({ chain: xLayerMainnet, transport: http('https://rpc.xlayer.tech') });

// ── Bracket progression map ───────────────────────────────────────────────────
const BRACKET: Record<string, {
  winner: { matchId: string; slot: 'home' | 'away' };
  loser?: { matchId: string; slot: 'home' | 'away' };
}> = {
  'r32-1':  { winner: { matchId: 'r16-1', slot: 'home' } },
  'r32-2':  { winner: { matchId: 'r16-1', slot: 'away' } },
  'r32-3':  { winner: { matchId: 'r16-2', slot: 'home' } },
  'r32-4':  { winner: { matchId: 'r16-2', slot: 'away' } },
  'r32-5':  { winner: { matchId: 'r16-3', slot: 'home' } },
  'r32-6':  { winner: { matchId: 'r16-3', slot: 'away' } },
  'r32-7':  { winner: { matchId: 'r16-4', slot: 'home' } },
  'r32-8':  { winner: { matchId: 'r16-4', slot: 'away' } },
  'r32-9':  { winner: { matchId: 'r16-5', slot: 'home' } },
  'r32-10': { winner: { matchId: 'r16-5', slot: 'away' } },
  'r32-11': { winner: { matchId: 'r16-6', slot: 'home' } },
  'r32-12': { winner: { matchId: 'r16-6', slot: 'away' } },
  'r32-13': { winner: { matchId: 'r16-7', slot: 'home' } },
  'r32-14': { winner: { matchId: 'r16-7', slot: 'away' } },
  'r32-15': { winner: { matchId: 'r16-8', slot: 'home' } },
  'r32-16': { winner: { matchId: 'r16-8', slot: 'away' } },
  'r16-1':  { winner: { matchId: 'qf-1', slot: 'home' } },
  'r16-2':  { winner: { matchId: 'qf-1', slot: 'away' } },
  'r16-3':  { winner: { matchId: 'qf-2', slot: 'home' } },
  'r16-4':  { winner: { matchId: 'qf-2', slot: 'away' } },
  'r16-5':  { winner: { matchId: 'qf-3', slot: 'home' } },
  'r16-6':  { winner: { matchId: 'qf-3', slot: 'away' } },
  'r16-7':  { winner: { matchId: 'qf-4', slot: 'home' } },
  'r16-8':  { winner: { matchId: 'qf-4', slot: 'away' } },
  'qf-1':   { winner: { matchId: 'sf-1', slot: 'home' } },
  'qf-2':   { winner: { matchId: 'sf-1', slot: 'away' } },
  'qf-3':   { winner: { matchId: 'sf-2', slot: 'home' } },
  'qf-4':   { winner: { matchId: 'sf-2', slot: 'away' } },
  'sf-1':   { winner: { matchId: 'f-1',   slot: 'home' }, loser: { matchId: '3pl-1', slot: 'home' } },
  'sf-2':   { winner: { matchId: 'f-1',   slot: 'away' }, loser: { matchId: '3pl-1', slot: 'away' } },
};

type SeasonPhase = 'preseason' | 'playing' | 'champion' | 'interseason';

function defaultMetabolism(): MetabolicState {
  return { okbBalance: '0', okbBalanceFormatted: '0.000000', healthPercent: 0, isRefuelNeeded: false, checkedAt: Date.now() };
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const [dark, setDark] = useState(true);
  const [engineOnline, setEngineOnline]         = useState(false);
  const [refereeAddress, setRefereeAddress]     = useState(REFEREE_ADDR);
  const [metabolism, setMetabolism]             = useState<MetabolicState>(defaultMetabolism);
  const [fixtures, setFixtures]                 = useState<Fixture[]>(STATIC_FIXTURES);
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
  const [matchStates, setMatchStates]           = useState<Record<string, MatchState>>({});
  const [watchingFixtureId, setWatchingId]      = useState<string | null>(null);
  const [viewMode, setViewMode]                 = useState<'simulated' | 'realtime'>('simulated');
  const [eliminatedTeams, setEliminatedTeams]   = useState<Set<string>>(new Set());
  const [champion, setChampion]                 = useState<Team | null>(null);
  const [tournamentGen, setTournamentGen]       = useState(0);

  // Season / phase system
  const [seasonNumber, setSeasonNumber]         = useState<number>(() => {
    try { return Math.max(1, parseInt(localStorage.getItem('xcup_season') ?? '1') || 1); } catch { return 1; }
  });
  const [phase, setPhase]                       = useState<SeasonPhase>('preseason');
  const [phaseTimer, setPhaseTimer]             = useState(5 * 60); // 5-min pre-season

  const wsRef                  = useRef<WebSocket | null>(null);
  const reconnectRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simCleanupRef          = useRef<Map<string, () => void>>(new Map());
  const bracketProcessedRef    = useRef<Set<string>>(new Set());
  const championTriggeredRef   = useRef(false);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  // Persist season number
  useEffect(() => {
    try { localStorage.setItem('xcup_season', String(seasonNumber)); } catch { /* private browsing */ }
  }, [seasonNumber]);

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
          setFixtures(s.fixtures.length ? s.fixtures : STATIC_FIXTURES);
          setPools(s.pools);
          setLogs(s.recentLogs);
          setLastBlock(s.lastBlock);
          setWsConnected(s.wsConnected);
          setSettlements(s.settlements);
          setMatchStates(s.matchStates ?? {});
        } else if (msg.type === 'log') {
          setLogs(prev => [...prev.slice(-199), msg.data as DaemonLog]);
        } else if (msg.type === 'settlement') {
          const s = msg.data as SettlementResult;
          setSettlements(prev => [...prev, s]);
          setPendingToasts(prev => [...prev, s]);
          setFixtures(prev => prev.map(f => f.id === s.fixtureId ? { ...f, status: 'settled', result: s.outcome } : f));
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
        setFixtures(s.fixtures.length ? s.fixtures : STATIC_FIXTURES);
        setPools(s.pools);
        setLogs(s.recentLogs);
        setLastBlock(s.lastBlock);
        setWsConnected(s.wsConnected);
        setSettlements(s.settlements);
        setMatchStates(s.matchStates ?? {});
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

  // ── Tournament restart ───────────────────────────────────────────────────────
  const doRestart = useCallback(() => {
    simCleanupRef.current.forEach(c => c());
    simCleanupRef.current.clear();
    bracketProcessedRef.current.clear();
    championTriggeredRef.current = false;
    setMatchStates({});
    setFixtures(STATIC_FIXTURES);
    setEliminatedTeams(new Set());
    setChampion(null);
    setTournamentGen(g => g + 1);
  }, []);

  // ── Phase / season timer ─────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'playing') return;
    if (phaseTimer <= 0) {
      if (phase === 'champion') {
        setChampion(null);
        setPhase('interseason');
        setPhaseTimer(20 * 60);
      } else if (phase === 'interseason') {
        setSeasonNumber(n => n + 1);
        doRestart();
        setPhase('preseason');
        setPhaseTimer(5 * 60);
      } else if (phase === 'preseason') {
        setPhase('playing');
      }
      return;
    }
    const t = setTimeout(() => setPhaseTimer(n => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, phaseTimer, doRestart]);

  // ── Client-side simulation ───────────────────────────────────────────────────
  useEffect(() => {
    if (engineOnline || viewMode !== 'simulated' || phase !== 'playing') return;
    fixtures.forEach(fx => {
      if (fx.status !== 'open' && fx.status !== 'locked') return;
      if (fx.home.code === 'TBD' || fx.away.code === 'TBD') return;
      if (simCleanupRef.current.has(fx.id)) return;
      const cleanup = simulateMatch(fx, (state) => {
        setMatchStates(prev => ({ ...prev, [fx.id]: state }));
      });
      simCleanupRef.current.set(fx.id, cleanup);
    });
  }, [engineOnline, viewMode, phase, fixtures]);

  // Advance bracket when a match finishes
  useEffect(() => {
    if (engineOnline || viewMode !== 'simulated') return;
    Object.entries(matchStates).forEach(([id, ms]) => {
      if (ms.status !== 'finished') return;
      if (bracketProcessedRef.current.has(id)) return;
      bracketProcessedRef.current.add(id);
      const entry = BRACKET[id];
      if (!entry) return;
      setFixtures(prev => {
        const fx = prev.find(f => f.id === id);
        if (!fx) return prev;
        const winner: Team = ms.homeScore > ms.awayScore ? fx.home
          : ms.awayScore > ms.homeScore ? fx.away
          : Math.random() > 0.5 ? fx.home : fx.away;
        const loser: Team = winner.code === fx.home.code ? fx.away : fx.home;
        setEliminatedTeams(prev => new Set([...prev, loser.code]));
        return prev.map(f => {
          if (f.id === entry.winner.matchId) {
            const updated = { ...f, [entry.winner.slot]: winner };
            const other: Team = entry.winner.slot === 'home' ? updated.away : updated.home;
            if (other.code !== 'TBD') updated.status = 'open';
            return updated;
          }
          if (entry.loser && f.id === entry.loser.matchId) {
            const updated = { ...f, [entry.loser.slot]: loser };
            const other: Team = entry.loser.slot === 'home' ? updated.away : updated.home;
            if (other.code !== 'TBD') updated.status = 'open';
            return updated;
          }
          return f;
        });
      });
    });
  }, [matchStates, engineOnline, viewMode]);

  // Detect Final finish → champion phase
  useEffect(() => {
    if (engineOnline || viewMode !== 'simulated' || phase !== 'playing') return;
    const ms = matchStates['f-1'];
    if (ms?.status !== 'finished') return;
    if (championTriggeredRef.current) return;
    championTriggeredRef.current = true;
    const fx = fixtures.find(f => f.id === 'f-1');
    if (!fx) return;
    const winner = ms.homeScore >= ms.awayScore ? fx.home : fx.away;
    setChampion(winner);
    setPhase('champion');
    setPhaseTimer(10);
  }, [matchStates, engineOnline, viewMode, phase, fixtures]);

  const handleStake    = useCallback((fixtureId: string, outcome: Outcome) => setStakeTarget({ fixtureId, outcome }), []);
  const dismissToast   = useCallback((s: SettlementResult) => setPendingToasts(prev => prev.filter(x => x !== s)), []);
  const handleWatch    = useCallback((fixtureId: string) => setWatchingId(fixtureId), []);
  const activeFixture  = stakeTarget ? fixtures.find(f => f.id === stakeTarget.fixtureId) ?? null : null;
  const watchingFixture = watchingFixtureId ? fixtures.find(f => f.id === watchingFixtureId) ?? null : null;

  const simFixtures    = viewMode === 'simulated' ? fixtures : REALTIME_FIXTURES;
  const rtGroups       = ['all', ...Array.from(new Set(REALTIME_FIXTURES.map(f => f.group))).sort()];
  const visibleFixtures = viewMode === 'simulated'
    ? (roundFilter === 'all' ? simFixtures : simFixtures.filter(f => f.round === roundFilter))
    : (groupFilter === 'all' ? REALTIME_FIXTURES : REALTIME_FIXTURES.filter(f => f.group === groupFilter));

  const healthColor = metabolism.isRefuelNeeded
    ? 'dark:text-red-400 text-red-600'
    : metabolism.healthPercent < 40
    ? 'dark:text-amber-400 text-amber-600'
    : 'dark:text-emerald-400 text-emerald-600';

  const seasonLabel = `FanVibe Season ${seasonNumber}`;

  return (
    <div className="min-h-screen dark:bg-black bg-zinc-50 dark:text-zinc-100 text-zinc-900 font-sans">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b dark:border-zinc-900 border-zinc-200 dark:bg-black/98 bg-white/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <span className="text-base font-bold tracking-tight dark:text-white text-zinc-900">X Cup FanVibe</span>
            {viewMode === 'simulated' && (
              <span className="hidden sm:inline text-[11px] font-mono dark:text-zinc-500 text-zinc-400">
                {seasonLabel}
              </span>
            )}
            <span className="hidden sm:flex badge-live text-[10px]">
              <span className="dot-live" /> X Layer · 196
            </span>
          </div>

          {/* Status strip */}
          <div className="hidden md:flex items-center gap-4 text-xs font-mono dark:text-zinc-300 text-zinc-600">
            {lastBlock > 0 && (
              <span className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${wsConnected || engineOnline ? 'bg-emerald-400 animate-pulse' : 'dark:bg-zinc-600 bg-zinc-400'}`} />
                #{lastBlock.toLocaleString()}
              </span>
            )}
            {refereeAddress && (
              <a href={explorerAddr(refereeAddress)} target="_blank" rel="noopener noreferrer"
                className="dark:hover:text-white hover:text-zinc-900 transition-colors">
                {shortAddr(refereeAddress)}
              </a>
            )}
            <span className={`font-semibold ${healthColor}`}>
              {metabolism.okbBalanceFormatted} OKB
            </span>
            <div className="w-20">
              <FuelBar percent={metabolism.healthPercent} okbFormatted="" isRefuelNeeded={metabolism.isRefuelNeeded} compact />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`hidden sm:flex items-center gap-1.5 text-xs font-mono font-semibold
              ${engineOnline ? 'dark:text-emerald-400 text-emerald-600' : 'dark:text-zinc-600 text-zinc-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${engineOnline ? 'bg-emerald-400 animate-pulse' : 'dark:bg-zinc-700 bg-zinc-300'}`} />
              {engineOnline ? 'Connected' : 'Standby'}
            </span>
            <ThemeSwitcher dark={dark} onToggle={() => setDark(d => !d)} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Mode toggle ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1 p-1 dark:bg-zinc-900 bg-zinc-100 rounded-xl border dark:border-zinc-800 border-zinc-200">
            <button
              onClick={() => setViewMode('simulated')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200
                ${viewMode === 'simulated'
                  ? 'bg-amber-500 text-black shadow-sm'
                  : 'dark:text-zinc-400 text-zinc-500 dark:hover:text-zinc-200 hover:text-zinc-700'}`}
            >
              <Zap size={13} className={viewMode === 'simulated' ? 'text-black' : ''} />
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

          <div className="text-xs font-mono dark:text-zinc-500 text-zinc-400 flex items-center gap-1.5">
            {viewMode === 'simulated' ? (
              phase === 'preseason' ? (
                <>
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                  {seasonLabel} starts in {fmtDuration(phaseTimer)} · staking open
                </>
              ) : phase === 'interseason' ? (
                <>
                  <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                  Season {seasonNumber + 1} starts in {fmtDuration(phaseTimer)}
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                  {seasonLabel} · matches live now
                </>
              )
            ) : (
              <>
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                Real WC · staking open · first kick-off Jun 11 2026
              </>
            )}
          </div>
        </div>

        {/* ── Pre-season banner ─────────────────────────────────────────── */}
        {viewMode === 'simulated' && phase === 'preseason' && (
          <div className="dark:bg-amber-500/8 bg-amber-50 border dark:border-amber-500/20 border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-bold dark:text-amber-300 text-amber-700 mb-0.5">{seasonLabel} — Staking Open</div>
              <div className="text-xs dark:text-zinc-400 text-zinc-600">
                Predict the champion and stake on opening fixtures before kick-off.
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="font-serif text-3xl dark:text-amber-300 text-amber-600 tabular-nums leading-none">{fmtDuration(phaseTimer)}</div>
                <div className="text-[10px] font-mono dark:text-zinc-500 text-zinc-400 uppercase mt-0.5">until kick-off</div>
              </div>
              <button
                onClick={() => setPhase('playing')}
                className="px-4 py-2 rounded-lg text-xs font-mono font-bold bg-amber-500 text-black hover:bg-amber-400 active:scale-95 transition-all"
              >
                Start Now →
              </button>
            </div>
          </div>
        )}

        {/* ── Inter-season banner ───────────────────────────────────────── */}
        {viewMode === 'simulated' && phase === 'interseason' && (
          <div className="dark:bg-zinc-900/80 bg-zinc-100 border dark:border-zinc-700 border-zinc-300 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-bold dark:text-zinc-200 text-zinc-700 mb-0.5">
                Season {seasonNumber + 1} — Coming Soon
              </div>
              <div className="text-xs dark:text-zinc-400 text-zinc-600">
                A new tournament is being prepared. Stake positions for the next season.
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="font-serif text-3xl dark:text-zinc-300 text-zinc-600 tabular-nums leading-none">{fmtDuration(phaseTimer)}</div>
                <div className="text-[10px] font-mono dark:text-zinc-500 text-zinc-400 uppercase mt-0.5">until next season</div>
              </div>
              <button
                onClick={() => {
                  setSeasonNumber(n => n + 1);
                  doRestart();
                  setPhase('preseason');
                  setPhaseTimer(5 * 60);
                }}
                className="px-4 py-2 rounded-lg text-xs font-mono font-bold dark:bg-zinc-700 bg-zinc-200 dark:text-zinc-100 text-zinc-800 dark:hover:bg-zinc-600 hover:bg-zinc-300 active:scale-95 transition-all"
              >
                Start Early →
              </button>
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

        {/* ── Round / group filter tabs ─────────────────────────────────── */}
        {viewMode === 'simulated' ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {[
              { id: 'all',     label: 'All' },
              { id: 'R32',     label: 'R32' },
              { id: 'R16',     label: 'R16' },
              { id: 'QF',      label: 'QF' },
              { id: 'SF',      label: 'SF' },
              { id: '3PL',     label: '3rd Place' },
              { id: 'F',       label: 'Final' },
              { id: 'bracket', label: '🏆 Bracket' },
            ].map(t => (
              <button key={t.id} onClick={() => setRoundFilter(t.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-mono font-semibold transition-all duration-150
                  ${roundFilter === t.id
                    ? 'dark:bg-zinc-100 dark:text-zinc-900 bg-zinc-900 text-white'
                    : 'dark:text-zinc-500 text-zinc-500 border dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {rtGroups.map(g => (
              <button key={g} onClick={() => setGroupFilter(g)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-mono font-semibold transition-all duration-150
                  ${groupFilter === g
                    ? 'dark:bg-blue-500 dark:text-white bg-blue-600 text-white'
                    : 'dark:text-zinc-500 text-zinc-500 border dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-700'}`}>
                {g === 'all' ? 'All Groups' : `Group ${g}`}
              </button>
            ))}
          </div>
        )}

        {/* ── Simulation running indicator ──────────────────────────────── */}
        {viewMode === 'simulated' && phase === 'playing' && !engineOnline && Object.keys(matchStates).length > 0 && (() => {
          const liveEntries   = Object.entries(matchStates).filter(([, ms]) => ms.status === 'live');
          const finishedCount = Object.values(matchStates).filter(ms => ms.status === 'finished').length;
          return (
            <div className="flex items-center gap-2.5 overflow-x-auto pb-0.5 scrollbar-none">
              <div className="shrink-0 flex items-center gap-1.5 text-xs font-mono font-semibold">
                {liveEntries.length > 0 ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="dark:text-amber-400 text-amber-600">{liveEntries.length} LIVE</span>
                  </>
                ) : (
                  <span className="dark:text-zinc-500 text-zinc-400">Season complete</span>
                )}
                {finishedCount > 0 && (
                  <span className="dark:text-zinc-600 text-zinc-400">· {finishedCount} done</span>
                )}
              </div>
              {liveEntries.map(([id, ms]) => {
                const fx = fixtures.find(f => f.id === id);
                if (!fx) return null;
                return (
                  <button
                    key={id}
                    onClick={() => setWatchingId(id)}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full border dark:border-amber-500/30 border-amber-200
                      dark:bg-amber-500/8 bg-amber-50 dark:hover:border-amber-400/50 hover:border-amber-300
                      transition-all active:scale-95 text-[11px] font-mono font-semibold"
                  >
                    <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    <span className="dark:text-zinc-200 text-zinc-700">{fx.home.flag} {ms.homeScore}</span>
                    <span className="dark:text-zinc-600 text-zinc-400">–</span>
                    <span className="dark:text-zinc-200 text-zinc-700">{ms.awayScore} {fx.away.flag}</span>
                    <span className="dark:text-zinc-500 text-zinc-400">{ms.minute}&apos;</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* ── Realtime mode notice ──────────────────────────────────────── */}
        {viewMode === 'realtime' && (
          <div className="dark:bg-blue-500/8 bg-blue-50 border dark:border-blue-500/20 border-blue-200 rounded-xl p-4 flex items-start gap-3">
            <Globe size={18} className="dark:text-blue-400 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold dark:text-blue-300 text-blue-700 mb-1">FIFA World Cup 2026 — All 12 Groups</div>
              <div className="text-xs dark:text-zinc-400 text-zinc-600 leading-relaxed">
                Official WC 2026 group stage fixtures (MD1 + MD2). Staking is open now for all 48 matches.
                First kick-off <span className="font-semibold dark:text-zinc-200 text-zinc-800">June 11, 2026</span>.
                Switch to Season Play to watch live simulated matches running right now.
              </div>
            </div>
          </div>
        )}

        {/* ── Champion prediction market ───────────────────────────────── */}
        {viewMode === 'simulated' && (
          <ChampionPick
            key={tournamentGen}
            fixtures={fixtures}
            matchStates={matchStates}
            eliminatedTeams={eliminatedTeams}
            refereeAddress={refereeAddress}
          />
        )}

        {/* ── Bracket view OR fixture grid ──────────────────────────────── */}
        {viewMode === 'simulated' && roundFilter === 'bracket' ? (
          <BracketView
            fixtures={fixtures}
            matchStates={matchStates}
            onWatch={handleWatch}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleFixtures.map(fixture => (
              <FixtureCard
                key={fixture.id}
                fixture={fixture}
                pool={pools[fixture.id]}
                matchState={viewMode === 'simulated' ? matchStates[fixture.id] : undefined}
                onStake={handleStake}
                onWatch={viewMode === 'simulated' ? handleWatch : () => {}}
              />
            ))}
          </div>
        )}

        {/* ── Group standings (realtime mode) ───────────────────────────── */}
        {viewMode === 'realtime' && (
          <GroupTable fixtures={REALTIME_FIXTURES} matchStates={matchStates} />
        )}

        {/* ── Activity feed toggle ──────────────────────────────────────── */}
        <div className="dark:border-zinc-900 border-zinc-200 border rounded-xl overflow-hidden">
          <button
            onClick={() => setLogOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-mono dark:text-zinc-600 text-zinc-500 dark:hover:text-zinc-400 hover:text-zinc-700 transition-colors dark:bg-transparent bg-white"
          >
            <span className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${engineOnline ? 'bg-emerald-400 animate-pulse' : 'dark:bg-zinc-700 bg-zinc-300'}`} />
              Activity Feed · {logs.length} entries
            </span>
            {logOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {logOpen && <LogStream logs={logs} daemonOnline={engineOnline} />}
        </div>

        {/* ── How it works ─────────────────────────────────────────────── */}
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
              <p>· Send OKB to the Settlement Wallet with ABI-encoded calldata specifying your fixture and outcome.</p>
              <p>· When the match settles, the winning pool is distributed pro-rata to all backers of the correct outcome.</p>
              <p>· The Champion market pays out proportionally to all stakers who backed the tournament winner after the Final.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t dark:border-zinc-900 border-zinc-100 pt-4 pb-4 text-center space-y-2">
          <div className="text-[11px] font-mono dark:text-zinc-600 text-zinc-400">
            Built on OKX X Layer · Settlement Wallet · O2 Autonomous Metabolism
          </div>
          <div className="flex items-center justify-center gap-4">
            <a
              href="https://x.com/xcupfanvibe"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono dark:text-zinc-600 text-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-600 transition-colors"
            >
              𝕏 / Twitter
            </a>
            <span className="dark:text-zinc-800 text-zinc-200">·</span>
            <button
              onClick={() => setHowOpen(true)}
              className="text-xs font-mono dark:text-zinc-600 text-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-600 transition-colors"
            >
              How it works
            </button>
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

      {watchingFixture && matchStates[watchingFixture.id] && (
        <MatchViewer
          fixture={watchingFixture}
          matchState={matchStates[watchingFixture.id]}
          onClose={() => setWatchingId(null)}
        />
      )}

      {/* ── Champion overlay ─────────────────────────────────────────────── */}
      {champion && phase === 'champion' && viewMode === 'simulated' && !engineOnline && (
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
            <div className="font-serif text-3xl text-white tracking-tight mb-1">
              {champion.name}
            </div>
            <div className="text-base font-bold text-amber-400 mb-5 tracking-widest uppercase">
              🏆 {seasonLabel} Champions
            </div>

            {/* Countdown bar */}
            <div className="w-full h-1 dark:bg-zinc-800 bg-zinc-700 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${(phaseTimer / 10) * 100}%` }}
              />
            </div>
            <p className="text-xs font-mono dark:text-zinc-400 text-zinc-400 mb-5">
              Next season in <span className="font-bold text-white tabular-nums">{phaseTimer}s</span>
            </p>

            <button
              onClick={() => { setChampion(null); setPhase('interseason'); setPhaseTimer(20 * 60); }}
              className="px-6 py-2.5 rounded-xl bg-amber-500 text-black font-bold text-sm
                hover:bg-amber-400 active:scale-95 transition-all"
            >
              Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
