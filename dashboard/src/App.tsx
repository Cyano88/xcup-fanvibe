import { useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, http, formatEther } from 'viem';
import { ChevronDown, ChevronUp, Zap, Globe, BookOpen } from 'lucide-react';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { FixtureCard } from './components/FixtureCard';
import { LogStream } from './components/LogStream';
import { StakeModal } from './components/StakeModal';
import { SettlementToast } from './components/SettlementToast';
import { FuelBar } from './components/FuelBar';
import { MatchViewer } from './components/MatchViewer';
import type { DaemonState, DaemonLog, Fixture, Pool, Outcome, SettlementResult, MetabolicState, MatchState } from './types';
import { STATIC_FIXTURES } from './types';
import { xLayerMainnet, explorerAddr } from './lib/chain';
import { shortAddr } from './lib/encode';

const BACKEND_WS   = import.meta.env.VITE_BACKEND_WS   ?? 'ws://localhost:3001';
const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP  ?? 'http://localhost:3001';
const REFEREE_ADDR = (import.meta.env.VITE_REFEREE_ADDRESS ?? '') as string;

const rpcClient = createPublicClient({ chain: xLayerMainnet, transport: http('https://rpc.xlayer.tech') });

function defaultMetabolism(): MetabolicState {
  return { okbBalance: '0', okbBalanceFormatted: '0.000000', healthPercent: 0, isRefuelNeeded: false, checkedAt: Date.now() };
}

export default function App() {
  const [dark, setDark] = useState(true);
  const [daemonOnline, setDaemonOnline]       = useState(false);
  const [refereeAddress, setRefereeAddress]   = useState(REFEREE_ADDR);
  const [metabolism, setMetabolism]           = useState<MetabolicState>(defaultMetabolism);
  const [fixtures, setFixtures]               = useState<Fixture[]>(STATIC_FIXTURES);
  const [pools, setPools]                     = useState<Record<string, Pool>>({});
  const [logs, setLogs]                       = useState<DaemonLog[]>([]);
  const [lastBlock, setLastBlock]             = useState(0);
  const [wsConnected, setWsConnected]         = useState(false);
  const [settlements, setSettlements]         = useState<SettlementResult[]>([]);
  const [pendingToasts, setPendingToasts]     = useState<SettlementResult[]>([]);
  const [stakeTarget, setStakeTarget]         = useState<{ fixtureId: string; outcome: Outcome } | null>(null);
  const [logOpen, setLogOpen]                 = useState(false);
  const [groupFilter, setGroupFilter]         = useState<string>('all');
  const [matchStates, setMatchStates]         = useState<Record<string, MatchState>>({});
  const [watchingFixtureId, setWatchingId]    = useState<string | null>(null);
  const [viewMode, setViewMode]               = useState<'simulated' | 'realtime'>('simulated');

  const wsRef             = useRef<WebSocket | null>(null);
  const reconnectRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(BACKEND_WS);
    wsRef.current = ws;

    ws.onopen = () => { setDaemonOnline(true); if (reconnectRef.current) clearTimeout(reconnectRef.current); };

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

    ws.onclose = () => { setDaemonOnline(false); reconnectRef.current = setTimeout(connectWS, 5000); };
    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connectWS();
    fetch(`${BACKEND_HTTP}/state`)
      .then(r => r.json())
      .then((s: DaemonState) => {
        setDaemonOnline(true);
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

  // Direct RPC balance when daemon offline
  useEffect(() => {
    if (daemonOnline || !refereeAddress) return;
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
  }, [daemonOnline, refereeAddress]);

  const handleStake    = useCallback((fixtureId: string, outcome: Outcome) => setStakeTarget({ fixtureId, outcome }), []);
  const dismissToast   = useCallback((s: SettlementResult) => setPendingToasts(prev => prev.filter(x => x !== s)), []);
  const handleWatch    = useCallback((fixtureId: string) => setWatchingId(fixtureId), []);
  const activeFixture  = stakeTarget ? fixtures.find(f => f.id === stakeTarget.fixtureId) ?? null : null;
  const watchingFixture = watchingFixtureId ? fixtures.find(f => f.id === watchingFixtureId) ?? null : null;

  const groups = ['all', ...Array.from(new Set(fixtures.map(f => f.group))).sort()];
  const visibleFixtures = groupFilter === 'all' ? fixtures : fixtures.filter(f => f.group === groupFilter);

  const healthColor = metabolism.isRefuelNeeded
    ? 'dark:text-red-400 text-red-600'
    : metabolism.healthPercent < 40
    ? 'dark:text-amber-400 text-amber-600'
    : 'dark:text-emerald-400 text-emerald-600';

  return (
    <div className="min-h-screen dark:bg-black bg-zinc-50 dark:text-zinc-100 text-zinc-900 font-sans">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b dark:border-zinc-900 border-zinc-200 dark:bg-black/98 bg-white/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <span className="text-base font-bold tracking-tight dark:text-white text-zinc-900">X Cup FanVibe</span>
            <span className="hidden sm:flex badge-live text-[10px]">
              <span className="dot-live" /> X Layer · 196
            </span>
          </div>

          {/* Status strip */}
          <div className="hidden md:flex items-center gap-4 text-xs font-mono dark:text-zinc-500 text-zinc-600">
            {lastBlock > 0 && (
              <span className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${wsConnected || daemonOnline ? 'bg-emerald-400 animate-pulse' : 'dark:bg-zinc-600 bg-zinc-400'}`} />
                #{lastBlock.toLocaleString()}
              </span>
            )}
            {refereeAddress && (
              <a href={explorerAddr(refereeAddress)} target="_blank" rel="noopener noreferrer"
                className="dark:hover:text-zinc-200 hover:text-zinc-900 transition-colors">
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
              ${daemonOnline ? 'dark:text-emerald-400 text-emerald-600' : 'dark:text-zinc-600 text-zinc-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${daemonOnline ? 'bg-emerald-400 animate-pulse' : 'dark:bg-zinc-700 bg-zinc-300'}`} />
              {daemonOnline ? 'LIVE' : 'OFFLINE'}
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
                  ? 'bg-emerald-500 text-black shadow-sm'
                  : 'dark:text-zinc-400 text-zinc-500 dark:hover:text-zinc-200 hover:text-zinc-700'}`}
            >
              <Zap size={13} className={viewMode === 'simulated' ? 'text-black' : ''} />
              Simulated
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
              <>
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                Simulated matches · stake &amp; watch live now
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                Real WC · staking open · first kick-off Jun 11 2026
              </>
            )}
          </div>
        </div>

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

        {/* ── Group filter pills ────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {groups.map(g => (
            <button
              key={g}
              onClick={() => setGroupFilter(g)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-mono font-semibold transition-all duration-150
                ${groupFilter === g
                  ? 'dark:bg-zinc-100 dark:text-zinc-900 bg-zinc-900 text-white'
                  : 'dark:text-zinc-500 text-zinc-500 border dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-700'}`}
            >
              {g === 'all' ? 'All' : `Grp ${g}`}
            </button>
          ))}
        </div>

        {/* ── Realtime mode notice ──────────────────────────────────────── */}
        {viewMode === 'realtime' && (
          <div className="dark:bg-blue-500/8 bg-blue-50 border dark:border-blue-500/20 border-blue-200 rounded-xl p-4 flex items-start gap-3">
            <Globe size={18} className="dark:text-blue-400 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold dark:text-blue-300 text-blue-700 mb-1">World Cup 2026 — Realtime Mode</div>
              <div className="text-xs dark:text-zinc-400 text-zinc-600 leading-relaxed">
                Real FIFA World Cup 2026 Group Stage fixtures. Staking is open now — matches settle
                automatically when the tournament starts. First kick-off is
                <span className="font-semibold dark:text-zinc-200 text-zinc-800"> June 11, 2026</span>.
                Switch to Simulated to watch live matches running now.
              </div>
            </div>
          </div>
        )}

        {/* ── Fixtures grid ─────────────────────────────────────────────── */}
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

        {/* ── Log toggle ────────────────────────────────────────────────── */}
        <div className="dark:border-zinc-900 border-zinc-200 border rounded-xl overflow-hidden">
          <button
            onClick={() => setLogOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-mono dark:text-zinc-600 text-zinc-500 dark:hover:text-zinc-400 hover:text-zinc-700 transition-colors dark:bg-transparent bg-white"
          >
            <span className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${daemonOnline ? 'bg-emerald-400 animate-pulse' : 'dark:bg-zinc-700 bg-zinc-300'}`} />
              Daemon Log · {logs.length} entries
            </span>
            {logOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {logOpen && <LogStream logs={logs} daemonOnline={daemonOnline} />}
        </div>

        {/* Footer */}
        <div className="border-t dark:border-zinc-900 border-zinc-100 pt-4 pb-4 space-y-3">
          {/* Support row */}
          <div className="flex items-center gap-6">
            <span className="text-[11px] font-mono font-semibold dark:text-zinc-600 text-zinc-400 uppercase tracking-widest">Support</span>
            <a
              href="https://x.com/xcupfanvibe"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                dark:text-zinc-500 text-zinc-500 dark:hover:text-zinc-100 hover:text-zinc-900
                dark:hover:bg-zinc-900 hover:bg-zinc-100 border border-transparent
                dark:hover:border-zinc-800 hover:border-zinc-200 transition-all duration-150"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.846L1.254 2.25H8.08l4.26 5.636zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>X</span>
            </a>
            <a
              href="#docs"
              className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                dark:text-zinc-500 text-zinc-500 dark:hover:text-zinc-100 hover:text-zinc-900
                dark:hover:bg-zinc-900 hover:bg-zinc-100 border border-transparent
                dark:hover:border-zinc-800 hover:border-zinc-200 transition-all duration-150"
            >
              <BookOpen size={13} className="shrink-0" />
              <span>Docs</span>
            </a>
          </div>

          {/* Built on row */}
          <div className="text-[11px] font-mono dark:text-zinc-600 text-zinc-400">
            Built on OKX XLayer · O2 Autonomous Metabolism
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
    </div>
  );
}
