import { useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, http, formatEther } from 'viem';
import { ChevronDown, ChevronUp } from 'lucide-react';
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

  const healthColor = metabolism.isRefuelNeeded ? 'text-red-400' : metabolism.healthPercent < 40 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="min-h-screen dark:bg-black bg-zinc-50 dark:text-zinc-100 text-zinc-900 font-sans">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b dark:border-zinc-900 border-zinc-200 dark:bg-black/98 bg-white/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-4">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <span className="text-base font-bold tracking-tight dark:text-white text-zinc-900">⚽ X Cup FanVibe</span>
            <span className="hidden sm:flex badge-live text-[10px]">
              <span className="dot-live" /> X Layer · 196
            </span>
          </div>

          {/* Status strip */}
          <div className="hidden md:flex items-center gap-4 text-xs font-mono text-zinc-500">
            {lastBlock > 0 && (
              <span className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${wsConnected || daemonOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                #{lastBlock.toLocaleString()}
              </span>
            )}
            {refereeAddress && (
              <a href={explorerAddr(refereeAddress)} target="_blank" rel="noopener noreferrer"
                className="hover:text-zinc-300 transition-colors">
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
            <span className={`hidden sm:flex items-center gap-1.5 text-xs font-mono ${daemonOnline ? 'text-emerald-400' : 'text-zinc-600'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${daemonOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-700'}`} />
              {daemonOnline ? 'LIVE' : 'OFFLINE'}
            </span>
            <ThemeSwitcher dark={dark} onToggle={() => setDark(d => !d)} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Recent settlements strip */}
        {settlements.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-xs dark:text-zinc-500 text-zinc-400 shrink-0 font-mono uppercase">Settled</span>
            {[...settlements].reverse().slice(0, 5).map((s) => {
              const fix = fixtures.find(f => f.id === s.fixtureId);
              return (
                <a key={`${s.fixtureId}-${s.blockNumber}`} href={s.explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full border dark:border-zinc-800 border-zinc-300 dark:hover:border-zinc-700 hover:border-zinc-400 dark:text-zinc-300 text-zinc-600 text-xs transition-colors">
                  <span>{fix ? `${fix.home.flag} vs ${fix.away.flag}` : s.fixtureId}</span>
                  <span className="text-emerald-500 font-mono font-medium capitalize">{s.outcome}</span>
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
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-mono font-medium transition-all duration-150
                ${groupFilter === g
                  ? 'dark:bg-white dark:text-black bg-zinc-900 text-white'
                  : 'dark:text-zinc-500 text-zinc-500 border dark:border-zinc-800 border-zinc-300 dark:hover:border-zinc-700 hover:border-zinc-500 dark:hover:text-zinc-300 hover:text-zinc-700'}`}
            >
              {g === 'all' ? 'All' : `Group ${g}`}
            </button>
          ))}
        </div>

        {/* ── Fixtures grid ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleFixtures.map(fixture => (
            <FixtureCard key={fixture.id} fixture={fixture} pool={pools[fixture.id]}
              matchState={matchStates[fixture.id]} onStake={handleStake} onWatch={handleWatch} />
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
        <div className="flex items-center justify-between text-xs dark:text-zinc-600 text-zinc-400 font-mono pb-2">
          <span>X Cup FanVibe · OKX Build X Hackathon 2026</span>
          <span>O2 Autonomous Metabolism · Chain 196</span>
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
