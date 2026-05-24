import { useState, useEffect, useCallback, useRef } from 'react';
import { createPublicClient, http, formatEther } from 'viem';
import { Globe, Zap } from 'lucide-react';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { AgentVitals } from './components/AgentVitals';
import { FixtureCard } from './components/FixtureCard';
import { LogStream } from './components/LogStream';
import { StakeModal } from './components/StakeModal';
import { SettlementToast } from './components/SettlementToast';
import type { DaemonState, DaemonLog, Fixture, Pool, Outcome, SettlementResult, MetabolicState } from './types';
import { STATIC_FIXTURES } from './types';
import { xLayerMainnet } from './lib/chain';

const BACKEND_WS   = import.meta.env.VITE_BACKEND_WS   ?? 'ws://localhost:3001';
const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP  ?? 'http://localhost:3001';
const REFEREE_ADDR = (import.meta.env.VITE_REFEREE_ADDRESS ?? '') as string;

const rpcClient = createPublicClient({ chain: xLayerMainnet, transport: http('https://rpc.xlayer.tech') });

function buildDefaultMetabolism(): MetabolicState {
  return { okbBalance: '0', okbBalanceFormatted: '0.000000', healthPercent: 0, isRefuelNeeded: false, checkedAt: Date.now() };
}

export default function App() {
  const [dark, setDark] = useState(true);
  const [daemonOnline, setDaemonOnline] = useState(false);

  // Daemon state (from WebSocket)
  const [refereeAddress, setRefereeAddress]  = useState(REFEREE_ADDR);
  const [metabolism, setMetabolism]          = useState<MetabolicState>(buildDefaultMetabolism);
  const [fixtures, setFixtures]              = useState<Fixture[]>(STATIC_FIXTURES);
  const [pools, setPools]                    = useState<Record<string, Pool>>({});
  const [logs, setLogs]                      = useState<DaemonLog[]>([]);
  const [lastBlock, setLastBlock]            = useState(0);
  const [wsConnected, setWsConnected]        = useState(false);
  const [settlements, setSettlements]        = useState<SettlementResult[]>([]);
  const [pendingToasts, setPendingToasts]    = useState<SettlementResult[]>([]);

  // UI modal state
  const [stakeTarget, setStakeTarget] = useState<{ fixtureId: string; outcome: Outcome } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Theme toggle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // ── WebSocket connection ──────────────────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(BACKEND_WS);
    wsRef.current = ws;

    ws.onopen = () => {
      setDaemonOnline(true);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as { type: string; data: unknown };

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
        } else if (msg.type === 'log') {
          setLogs((prev) => [...prev.slice(-199), msg.data as DaemonLog]);
        } else if (msg.type === 'settlement') {
          const s = msg.data as SettlementResult;
          setSettlements((prev) => [...prev, s]);
          setPendingToasts((prev) => [...prev, s]);
          setFixtures((prev) =>
            prev.map((f) => f.id === s.fixtureId ? { ...f, status: 'settled', result: s.outcome } : f)
          );
        }
      } catch {
        // malformed frame
      }
    };

    ws.onclose = () => {
      setDaemonOnline(false);
      // Reconnect with back-off
      reconnectTimerRef.current = setTimeout(connectWS, 5_000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connectWS();

    // Also try REST for initial state
    fetch(`${BACKEND_HTTP}/state`)
      .then((r) => r.json())
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
      })
      .catch(() => {}); // backend offline — static fixtures shown

    return () => {
      wsRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connectWS]);

  // ── Fallback: direct RPC balance if daemon is offline ────────────────────────
  useEffect(() => {
    if (daemonOnline || !refereeAddress) return;

    const fetchBalance = async () => {
      try {
        const bal = await rpcClient.getBalance({ address: refereeAddress as `0x${string}` });
        const formatted = parseFloat(formatEther(bal)).toFixed(6);
        const hp = Math.min(100, Number((bal * 100n) / BigInt(5e17))); // 0.5 OKB = 100%
        setMetabolism((prev) => ({
          ...prev,
          okbBalance: bal.toString(),
          okbBalanceFormatted: formatted,
          healthPercent: hp,
          isRefuelNeeded: bal < BigInt(2e16),
          checkedAt: Date.now(),
        }));
      } catch {
        // RPC unreachable
      }
    };

    fetchBalance();
    const t = setInterval(fetchBalance, 15_000);
    return () => clearInterval(t);
  }, [daemonOnline, refereeAddress]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleStake = useCallback((fixtureId: string, outcome: Outcome) => {
    setStakeTarget({ fixtureId, outcome });
  }, []);

  const dismissToast = useCallback((settlement: SettlementResult) => {
    setPendingToasts((prev) => prev.filter((s) => s !== settlement));
  }, []);

  const activeFixture = stakeTarget
    ? fixtures.find((f) => f.id === stakeTarget.fixtureId) ?? null
    : null;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black dark:bg-black bg-white text-zinc-100 dark:text-zinc-100 font-sans transition-colors duration-300">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-zinc-900 dark:border-zinc-900 bg-black/95 dark:bg-black/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚽</span>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-bold text-white tracking-tight">X Cup FanVibe</span>
              <span className="hidden sm:block text-xs text-zinc-600">Autonomous Prediction Market</span>
            </div>

            {/* Live indicator */}
            <span className="hidden sm:flex badge-live">
              <span className="dot-live" />
              X Layer Mainnet
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-600">
              <Globe size={11} />
              <span className="font-mono">Chain 196</span>
            </div>

            {lastBlock > 0 && (
              <span className="hidden sm:flex items-center gap-1 font-mono text-xs text-zinc-700">
                <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                #{lastBlock.toLocaleString()}
              </span>
            )}

            <ThemeSwitcher dark={dark} onToggle={() => setDark((d) => !d)} />
          </div>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Offline notice */}
        {!daemonOnline && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-500">
            <Zap size={13} className="text-amber-500 shrink-0" />
            <span>Daemon offline — showing static fixtures. Start the backend server to enable live staking and metabolism.</span>
          </div>
        )}

        {/* ── Top grid: Vitals + Log ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
          <AgentVitals
            refereeAddress={refereeAddress}
            metabolism={metabolism}
            lastBlock={lastBlock}
            wsConnected={wsConnected}
            daemonOnline={daemonOnline}
          />
          <LogStream logs={logs} daemonOnline={daemonOnline} />
        </div>

        {/* ── Settlement history strip ──────────────────────────────────────── */}
        {settlements.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-500 uppercase tracking-widest font-semibold">
              <span className="w-4 h-px bg-zinc-800" />
              Recent Settlements
              <span className="flex-1 h-px bg-zinc-800" />
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {[...settlements].reverse().slice(0, 6).map((s) => {
                const fix = fixtures.find((f) => f.id === s.fixtureId);
                return (
                  <a
                    key={`${s.fixtureId}-${s.blockNumber}`}
                    href={s.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 text-xs transition-colors"
                  >
                    <span>{fix ? `${fix.home.flag} vs ${fix.away.flag}` : s.fixtureId}</span>
                    <span className="capitalize text-emerald-400 font-medium">{s.outcome}</span>
                    <span className="text-zinc-600">↗</span>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Fixtures grid ─────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-zinc-500 uppercase tracking-widest font-semibold">
            <span className="w-4 h-px bg-zinc-800" />
            World Cup 2026 — Group Stage
            <span className="flex-1 h-px bg-zinc-800" />
            <span className="text-zinc-700 normal-case font-normal tracking-normal">{fixtures.length} fixtures</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {fixtures.map((fixture) => (
              <FixtureCard
                key={fixture.id}
                fixture={fixture}
                pool={pools[fixture.id]}
                onStake={handleStake}
              />
            ))}
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <footer className="border-t border-zinc-900 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-700">
          <div className="flex items-center gap-3">
            <span>⚽ X Cup FanVibe</span>
            <span>·</span>
            <span>OKX X Layer "Build X" Hackathon 2026</span>
          </div>
          <div className="flex items-center gap-3 font-mono">
            <span>Chain 196</span>
            <span>·</span>
            <span>O2 Autonomous Metabolism</span>
            {refereeAddress && (
              <>
                <span>·</span>
                <a
                  href={`https://www.okx.com/web3/explorer/xlayer/address/${refereeAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-zinc-400 transition-colors"
                >
                  Explorer ↗
                </a>
              </>
            )}
          </div>
        </footer>
      </main>

      {/* ── Stake modal ───────────────────────────────────────────────────────── */}
      {stakeTarget && activeFixture && (
        <StakeModal
          fixture={activeFixture}
          defaultOutcome={stakeTarget.outcome}
          refereeAddress={refereeAddress}
          onClose={() => setStakeTarget(null)}
        />
      )}

      {/* ── Settlement toasts ─────────────────────────────────────────────────── */}
      {pendingToasts.map((s) => (
        <SettlementToast
          key={`${s.fixtureId}-${s.blockNumber}`}
          settlement={s}
          onDismiss={() => dismissToast(s)}
        />
      ))}
    </div>
  );
}
