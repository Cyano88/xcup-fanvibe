import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { useCreateWallet, usePrivy, useWallets } from '@privy-io/react-auth';
import type { Fixture, MatchState, UserPosition } from '../types';
import { explorerTx } from '../lib/chain';
import { seasonFixtureStartAtMs } from '../lib/seasonTournament';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const PRIVY_ENABLED = Boolean(import.meta.env.VITE_PRIVY_APP_ID);

function shortHash(hash?: string): string {
  if (!hash) return '-';
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function formatOKB(wei: string): string {
  try {
    const whole = BigInt(wei);
    const value = Number(whole) / 1e18;
    return `${value.toFixed(value >= 1 ? 3 : 4)} OKB`;
  } catch {
    return '0 OKB';
  }
}

function formatTime(ts?: number | string): string {
  if (!ts) return '-';
  const ms = typeof ts === 'number' ? (ts > 10_000_000_000 ? ts : ts * 1000) : Date.parse(ts);
  if (!Number.isFinite(ms)) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function statusTone(status: string): string {
  if (['paid', 'refunded', 'settled_winner'].includes(status)) return 'text-emerald-600 dark:text-emerald-300 bg-emerald-500/10';
  if (['lost', 'settled_lost', 'failed'].includes(status)) return 'text-rose-600 dark:text-rose-300 bg-rose-500/10';
  if (status.includes('pending') || status === 'queued') return 'text-blue-600 dark:text-blue-300 bg-blue-500/10';
  return 'text-zinc-600 dark:text-zinc-300 bg-zinc-500/10';
}

function statusLabel(position: UserPosition): string {
  if (position.type === 'refund') {
    if (position.status === 'refunded') return 'Refund sent';
    if (position.status === 'failed') return 'Refund failed';
    return 'Refund queued';
  }
  if (position.type === 'champion') {
    if (position.status === 'settled_winner') return 'Champion win';
    if (position.status === 'settled_lost') return 'Champion lost';
    return 'Champion active';
  }
  if (position.status === 'paid') return 'Payout sent';
  if (position.status === 'won_pending_payout') return 'Won - payout pending';
  if (position.status === 'lost') return 'Lost';
  return 'Active';
}

function pickLabel(position: UserPosition): string {
  if (position.type === 'refund') return position.refund.outcome.toUpperCase();
  if (position.type === 'champion') return position.stake.teamCode;
  return position.stake.outcome.toUpperCase();
}

function pickTone(pick: string): string {
  if (pick === 'HOME') return 'bg-blue-500/10 text-blue-600 dark:text-blue-300';
  if (pick === 'AWAY') return 'bg-blue-500/10 text-blue-600 dark:text-blue-300';
  if (pick === 'DRAW') return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300';
  return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300';
}

interface Props {
  fixtures?: Fixture[];
  matchStates?: Record<string, MatchState>;
  seasonStartedAt?: number;
  onWatch?: (fixtureId: string) => void;
}

function PrivyPositionsConnect({
  address,
  onAddress,
  onError,
}: {
  address: string | null;
  onAddress: (address: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { wallets } = useWallets();
  const activeWallet = wallets[0];
  const creatingWalletRef = useRef(false);

  useEffect(() => {
    if (activeWallet?.address) {
      onAddress(activeWallet.address);
      onError(null);
    }
  }, [activeWallet?.address, onAddress, onError]);

  useEffect(() => {
    if (!ready || !authenticated || activeWallet || creatingWalletRef.current) return;
    creatingWalletRef.current = true;
    createWallet()
      .then(wallet => {
        onAddress(wallet.address);
        onError(null);
      })
      .catch(err => onError(err instanceof Error ? err.message : 'Unable to create FanVibe wallet'))
      .finally(() => {
        creatingWalletRef.current = false;
      });
  }, [activeWallet, authenticated, createWallet, onAddress, onError, ready]);

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-md border dark:border-zinc-800 border-zinc-200 bg-white px-3 py-2 text-xs font-semibold dark:bg-zinc-950 dark:text-zinc-200 text-zinc-800">
          <Wallet size={13} />
          {address.slice(0, 6)}...{address.slice(-4)}
        </div>
        <button
          onClick={() => {
            activeWallet?.disconnect();
            logout();
            onAddress(null);
          }}
          className="inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2.5 py-2 text-xs font-bold dark:text-zinc-500 text-zinc-500 transition-colors hover:border-rose-500 hover:text-rose-600"
          title="Sign out"
        >
          <ArrowRight size={13} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        if (!authenticated || !activeWallet) login({ loginMethods: ['email', 'wallet'] });
      }}
      disabled={!ready}
      className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-all active:scale-95 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Wallet size={13} />
      {authenticated ? 'Setting up account...' : 'Sign in'}
    </button>
  );
}

export function MyPositions({ fixtures = [], matchStates = {}, seasonStartedAt, onWatch }: Props) {
  const [address, setAddress] = useState<string | null>(null);
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const connect = useCallback(async () => {
    const provider = (window as typeof window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
    if (!provider) {
      setError('No wallet detected.');
      return;
    }
    const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
    setAddress(accounts[0] ?? null);
  }, []);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_HTTP}/positions/${address}`);
      if (!res.ok) throw new Error('Positions unavailable');
      const data = await res.json() as { positions: UserPosition[] };
      setPositions(data.positions ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    const provider = (window as typeof window & { ethereum?: { request: (args: { method: string }) => Promise<unknown> } }).ethereum;
    provider?.request({ method: 'eth_accounts' })
      .then((accounts: unknown) => {
        const list = accounts as string[];
        if (list?.[0]) setAddress(list[0]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 12_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const summary = useMemo(() => {
    const active = positions.filter(p => statusLabel(p).toLowerCase().includes('active')).length;
    const paid = positions.filter(p => ['paid', 'refunded', 'settled_winner'].includes(p.status)).length;
    const totalWei = positions.reduce((sum, position) => {
      const amount = position.type === 'refund' ? position.refund.amountWei : position.stake.amountWei;
      try {
        return sum + BigInt(amount);
      } catch {
        return sum;
      }
    }, 0n);
    return { active, paid, totalWei };
  }, [positions]);

  return (
    <section className="overflow-hidden rounded-lg border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white shadow-sm">
      <div className="border-b dark:border-zinc-900 border-zinc-100 px-4 py-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-md bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white dark:bg-white dark:text-zinc-950">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              Account
            </div>
            <div className="mt-3 text-xl font-semibold tracking-tight dark:text-zinc-50 text-zinc-950">
              Portfolio
            </div>
            <div className="mt-1 text-sm dark:text-zinc-500 text-zinc-500">
              {address
                ? 'Track stakes, payouts, refunds, and champion positions from one account.'
                : PRIVY_ENABLED
                  ? 'Sign in with email or wallet to view your FanVibe positions.'
                  : 'Connect your account to view positions.'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {address && (
              <button onClick={refresh} className="rounded-md border dark:border-zinc-800 border-zinc-200 px-2.5 py-2 text-xs font-semibold dark:text-zinc-300 text-zinc-700 hover:border-blue-500 transition-colors">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            )}
            {PRIVY_ENABLED ? (
              <PrivyPositionsConnect address={address} onAddress={setAddress} onError={setError} />
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={connect} className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-all active:scale-95 hover:bg-blue-500">
                  <Wallet size={13} />
                  {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connect'}
                </button>
                {address && (
                  <button
                    onClick={() => setAddress(null)}
                    className="inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2.5 py-2 text-xs font-bold dark:text-zinc-500 text-zinc-500 transition-colors hover:border-rose-500 hover:text-rose-600"
                    title="Disconnect"
                  >
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-md border dark:border-zinc-900 border-zinc-100 dark:bg-zinc-900/50 bg-zinc-50 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Positions</div>
            <div className="mt-1 text-lg font-semibold tabular-nums dark:text-zinc-50 text-zinc-950">{positions.length}</div>
          </div>
          <div className="rounded-md border dark:border-zinc-900 border-zinc-100 dark:bg-zinc-900/50 bg-zinc-50 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Active</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-blue-600 dark:text-blue-400">{summary.active}</div>
          </div>
          <div className="rounded-md border dark:border-zinc-900 border-zinc-100 dark:bg-zinc-900/50 bg-zinc-50 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Volume</div>
            <div className="mt-1 text-lg font-semibold tabular-nums dark:text-zinc-50 text-zinc-950">{formatOKB(summary.totalWei.toString())}</div>
          </div>
        </div>
      </div>

      {error && <div className="mx-4 mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-500">{error}</div>}

      {address && (
        <div className="space-y-2 p-4">
          {positions.length === 0 ? (
            <div className="rounded-md border dark:border-zinc-900 border-zinc-100 px-3 py-6 text-center text-sm dark:text-zinc-500 text-zinc-500">
              No stakes found for this wallet yet.
            </div>
          ) : positions.map((position) => {
            const txHash = position.type === 'refund' ? position.refund.txHash : position.stake.txHash;
            const actionHash = position.type === 'refund' ? position.refund.refundTxHash : position.type === 'match' ? position.payout?.txHash : undefined;
            const amount = position.type === 'refund' ? position.refund.amountWei : position.stake.amountWei;
            const liveFixture = position.type === 'match'
              ? fixtures.find(fixture => fixture.id === position.stake.fixtureId) ?? position.fixture
              : position.type === 'refund'
                ? fixtures.find(fixture => fixture.id === position.refund.fixtureId)
                : undefined;
            const liveState = liveFixture ? matchStates[liveFixture.id] : undefined;
            const canOpenMatch = position.type === 'match'
              && !!liveFixture
              && !!liveState
              && ['live', 'half_time', 'finished'].includes(liveState.status);
            const startsAt = position.type === 'match' && liveFixture && seasonStartedAt
              ? seasonFixtureStartAtMs(fixtures, liveFixture, seasonStartedAt, matchStates)
              : liveFixture?.simulatedKickoff
                ? Date.parse(liveFixture.simulatedKickoff)
                : undefined;
            const matchBadge = liveState?.status === 'finished'
              ? `FT ${liveState.homeScore}-${liveState.awayScore}`
              : liveState?.status === 'half_time'
                ? `HT ${liveState.homeScore}-${liveState.awayScore}`
                : liveState?.status === 'live'
                  ? `${liveState.minute}' ${liveState.homeScore}-${liveState.awayScore}`
                  : startsAt && startsAt > nowTick
                    ? `Starts ${fmtCountdown(startsAt - nowTick)}`
                    : liveFixture?.status === 'settled'
                      ? 'FT'
                      : liveFixture?.status === 'locked'
                        ? 'Live soon'
                        : liveFixture?.status === 'open'
                          ? 'Staking open'
                          : undefined;
            const title = position.type === 'champion'
              ? `Champion - ${position.stake.teamCode}`
              : position.type === 'refund'
                ? `${position.refund.fixtureId} - ${position.refund.outcome.toUpperCase()}`
                : `${liveFixture?.home.code ?? position.stake.fixtureId} vs ${liveFixture?.away.code ?? ''}`;
            const meta = position.type === 'match'
              ? [
                liveFixture?.round ? liveFixture.round : liveFixture?.group ? `Group ${liveFixture.group}` : undefined,
                liveFixture?.matchday ? `MD${liveFixture.matchday}` : undefined,
                liveFixture?.kickoff ? `Kickoff ${formatTime(liveFixture.kickoff)}` : undefined,
                position.settlement?.settledAt ? `Settled ${formatTime(position.settlement.settledAt)}` : undefined,
                position.settlement ? `Result ${position.settlement.outcome.toUpperCase()}` : undefined,
              ].filter(Boolean).join(' - ')
              : position.type === 'refund'
                ? `Rejected ${formatTime(position.refund.timestamp)} - ${position.refund.reason}`
                : `Placed ${formatTime(position.stake.timestamp)}${position.winner ? ` - Winner ${position.winner}` : ''}`;

            return (
              <div
                key={`${position.type}-${txHash}`}
                role={canOpenMatch ? 'button' : undefined}
                tabIndex={canOpenMatch ? 0 : undefined}
                onClick={canOpenMatch && liveFixture ? () => onWatch?.(liveFixture.id) : undefined}
                onKeyDown={canOpenMatch && liveFixture ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onWatch?.(liveFixture.id);
                  }
                } : undefined}
                className={`flex items-center justify-between gap-3 rounded-md border dark:border-zinc-900 border-zinc-100 dark:bg-zinc-950 bg-white px-3 py-3 shadow-sm ${canOpenMatch ? 'cursor-pointer transition-colors dark:hover:border-blue-500 hover:border-blue-500' : ''}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold dark:text-zinc-100 text-zinc-900">{title}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${pickTone(pickLabel(position))}`}>
                      {pickLabel(position)}
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${statusTone(position.status)}`}>
                      {statusLabel(position)}
                    </span>
                    {matchBadge && (
                      <span className="shrink-0 rounded bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tabular-nums text-zinc-600 dark:text-zinc-300">
                        {matchBadge}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] dark:text-zinc-500 text-zinc-500">
                    {formatOKB(amount)} - Stake {shortHash(txHash)}
                  </div>
                  <div className="mt-0.5 text-[10px] dark:text-zinc-600 text-zinc-400">
                    {meta}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a href={explorerTx(txHash)} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="text-xs font-semibold dark:text-zinc-400 text-zinc-500 hover:text-blue-500">
                    Stake
                  </a>
                  {actionHash && (
                    <a href={explorerTx(actionHash)} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2 py-1 text-xs font-bold text-blue-600 dark:text-blue-300">
                      <ExternalLink size={11} />
                      {position.type === 'refund' ? 'Refund' : 'Payout'}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
