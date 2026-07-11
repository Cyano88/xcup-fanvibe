import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { formatUnits } from 'viem';
import { AlertTriangle, KeyRound, RefreshCw, ShieldCheck, Wallet, ExternalLink } from 'lucide-react';
import { shortAddr } from '../lib/encode';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const ADMIN_ADDRESS = (import.meta.env.VITE_ADMIN_ADDRESS ?? '').trim().toLowerCase();

type PayoutStatus = 'pending' | 'sent' | 'failed';

interface EntryView {
  rank: number;
  address: string;
  xHandle: string;
  score: number;
  usdtWei: string;
  fvbWei: string;
  tranches: {
    firstUsdtWei: string;
    firstFvbWei: string;
    finalUsdtWei: string;
    finalFvbWei: string;
  };
  redirectedToBuyback: boolean;
  registered: boolean;
  registeredAt: number | null;
  firstUsdtStatus: PayoutStatus;
  firstUsdtTxHash: string | null;
  firstFvbStatus: PayoutStatus;
  firstFvbTxHash: string | null;
  finalUsdtStatus: PayoutStatus;
  finalUsdtTxHash: string | null;
  finalFvbStatus: PayoutStatus;
  finalFvbTxHash: string | null;
}

interface SnapshotView {
  seasonId: string;
  snapshottedAt: number;
  snapshottedAtBlock: number;
  registrationClosesAt: number;
  firstPayoutAt: number;
  finalPayoutAt: number;
  fvbTokenAddress: string;
  fvbDecimals: number;
  fvbPoolWei: string;
  usdtTokenAddress: string;
  usdtDecimals: number;
  usdtPoolWei: string;
  usdtPerRankWei: string;
  entries: EntryView[];
  buybackPool: {
    usdtWei: string;
    fvbWei: string;
  };
}

interface BalanceView {
  refereeAddress: string;
  okbWei: string;
  usdtWei: string;
  fvbWei: string;
}

const fmtUsdt = (wei: string) => `$${Number(formatUnits(BigInt(wei || '0'), 6)).toFixed(2)}`;
const fmtFvb = (wei: string) => `${Number(formatUnits(BigInt(wei || '0'), 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} FVB`;
const fmtOkb = (wei: string) => `${Number(formatUnits(BigInt(wei || '0'), 18)).toFixed(6)} OKB`;
const fmtDate = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

function StatusPill({ status, unlocked }: { status: PayoutStatus; unlocked: boolean }) {
  const label = unlocked ? status : 'locked';
  const style = status === 'sent'
    ? 'bg-emerald-500/10 text-emerald-500'
    : status === 'failed'
      ? 'bg-rose-500/10 text-rose-500'
      : !unlocked
        ? 'bg-zinc-500/10 text-zinc-500'
        : 'bg-amber-500/10 text-amber-500';
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${style}`}>{label}</span>;
}

export function AdminRewards() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [snapshot, setSnapshot] = useState<SnapshotView | null>(null);
  const [balances, setBalances] = useState<BalanceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyOp, setBusyOp] = useState<string | null>(null);
  const [confirmOp, setConfirmOp] = useState<null | { label: string; run: () => Promise<void> }>(null);
  const [loading, setLoading] = useState(false);

  const connectedAddress = (user?.wallet?.address ?? wallets[0]?.address ?? '').toLowerCase();
  const isAdmin = ADMIN_ADDRESS && connectedAddress === ADMIN_ADDRESS;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapRes, balRes] = await Promise.all([
        fetch(`${BACKEND_HTTP}/rewards/snapshot`),
        fetch(`${BACKEND_HTTP}/rewards/admin/balances`),
      ]);
      if (snapRes.status === 404) {
        setSnapshot(null);
      } else if (!snapRes.ok) {
        throw new Error(`snapshot fetch failed: ${snapRes.status}`);
      } else {
        setSnapshot(await snapRes.json());
      }
      if (balRes.ok) setBalances(await balRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signWithAdmin = useCallback(async (message: string): Promise<`0x${string}`> => {
    const wallet = wallets.find(w => w.address.toLowerCase() === ADMIN_ADDRESS);
    if (!wallet) throw new Error(`Connect the admin wallet ${shortAddr(ADMIN_ADDRESS)}`);
    const provider = await wallet.getEthereumProvider();
    return await provider.request({
      method: 'personal_sign',
      params: [message, wallet.address],
    }) as `0x${string}`;
  }, [wallets]);

  const runOp = useCallback(async (id: string, label: string, run: () => Promise<void>) => {
    setConfirmOp({
      label,
      run: async () => {
        setBusyOp(id);
        setError(null);
        try {
          await run();
          await refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/user reject|denied|cancelled/i.test(message)) {
            setError('Signature cancelled.');
          } else {
            setError(message);
          }
        } finally {
          setBusyOp(null);
          setConfirmOp(null);
        }
      },
    });
  }, [refresh]);

  const createSnapshot = useCallback(() => {
    const nonce = Date.now();
    const seasonId = 'season-1';
    const message = `X-Cup-Rewards-Snapshot:${seasonId}:${nonce}`;
    runOp('snapshot', `Freeze Season 1 snapshot (top-5 X-connected leaderboard).`, async () => {
      const signature = await signWithAdmin(message);
      const res = await fetch(`${BACKEND_HTTP}/rewards/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonId, signature, nonce }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data?.error ?? `snapshot failed: ${res.status}`);
    });
  }, [runOp, signWithAdmin]);

  const forfeit = useCallback((entry: EntryView) => {
    if (!snapshot) return;
    const nonce = Date.now();
    const message = `X-Cup-Rewards-Forfeit:${snapshot.seasonId}:${entry.address.toLowerCase()}:${nonce}`;
    const opId = `forfeit-${entry.address}`;
    const label = `Sweep rank #${entry.rank} · ${shortAddr(entry.address)} · @${entry.xHandle} → buyback pool. Adds ${fmtUsdt(entry.usdtWei)}${BigInt(entry.fvbWei) > 0n ? ` + ${fmtFvb(entry.fvbWei)}` : ''} to buyback. Not reversible.`;
    runOp(opId, label, async () => {
      const signature = await signWithAdmin(message);
      const res = await fetch(`${BACKEND_HTTP}/rewards/admin/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seasonId: snapshot.seasonId,
          address: entry.address,
          signature,
          nonce,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data?.error ?? `forfeit failed: ${res.status}`);
    });
  }, [runOp, signWithAdmin, snapshot]);

  const release = useCallback((entry: EntryView, token: 'usdt' | 'fvb', tranche: 'first' | 'final') => {
    if (!snapshot) return;
    const amountWei = token === 'usdt'
      ? (tranche === 'first' ? entry.tranches.firstUsdtWei : entry.tranches.finalUsdtWei)
      : (tranche === 'first' ? entry.tranches.firstFvbWei : entry.tranches.finalFvbWei);
    const humanAmount = token === 'usdt' ? fmtUsdt(amountWei) : fmtFvb(amountWei);
    const nonce = Date.now();
    const message = `X-Cup-Rewards-Release:${snapshot.seasonId}:${entry.address.toLowerCase()}:${token}:${tranche}:${nonce}`;
    const opId = `release-${token}-${tranche}-${entry.address}`;
    const label = `Release ${humanAmount} ${token.toUpperCase()} (${tranche} tranche) to rank #${entry.rank} · ${shortAddr(entry.address)} · @${entry.xHandle}`;
    runOp(opId, label, async () => {
      const signature = await signWithAdmin(message);
      const res = await fetch(`${BACKEND_HTTP}/rewards/admin/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seasonId: snapshot.seasonId,
          address: entry.address,
          token,
          tranche,
          signature,
          nonce,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data?.error ?? `release failed: ${res.status}`);
    });
  }, [runOp, signWithAdmin, snapshot]);

  const trancheStatus = useMemo(() => ({
    firstUnlocked: snapshot ? Date.now() >= snapshot.firstPayoutAt : false,
    finalUnlocked: snapshot ? Date.now() >= snapshot.finalPayoutAt : false,
    registrationClosed: snapshot ? Date.now() >= snapshot.registrationClosesAt : false,
  }), [snapshot]);

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <a href="/" className="text-xs font-semibold text-blue-600 hover:underline">← Back to FanVibe</a>

        <div className="mt-4 flex items-center gap-3">
          <ShieldCheck className="text-blue-600" size={22} />
          <h1 className="text-xl font-bold dark:text-white text-zinc-900">Admin — Rewards</h1>
          <button
            type="button"
            onClick={refresh}
            className="ml-auto inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2 py-1 text-[11px] font-semibold dark:text-zinc-300 text-zinc-600"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {!ADMIN_ADDRESS && (
          <div className="mt-4 rounded-md bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-500">
            VITE_ADMIN_ADDRESS is not configured. Set it in Vercel env and rebuild.
          </div>
        )}

        {ADMIN_ADDRESS && !authenticated && (
          <div className="mt-6 rounded-lg border dark:border-zinc-900 border-zinc-200 p-4">
            <div className="text-sm font-semibold dark:text-zinc-200 text-zinc-800">Connect the admin wallet to continue.</div>
            <div className="mt-1 text-[11px] dark:text-zinc-500 text-zinc-500">Expected address: <span className="font-mono">{ADMIN_ADDRESS}</span></div>
            <button
              type="button"
              onClick={() => login({ loginMethods: ['wallet'] })}
              disabled={!ready}
              className="mt-3 inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wallet size={13} /> Connect wallet
            </button>
          </div>
        )}

        {ADMIN_ADDRESS && authenticated && !isAdmin && (
          <div className="mt-6 rounded-lg border dark:border-zinc-900 border-zinc-200 p-4">
            <div className="flex items-start gap-2 text-sm dark:text-rose-300 text-rose-600">
              <AlertTriangle size={16} className="mt-0.5" />
              <div>
                <div className="font-semibold">Not authorized.</div>
                <div className="mt-1 text-[11px] dark:text-zinc-400 text-zinc-500">
                  Connected: <span className="font-mono">{connectedAddress || '—'}</span>
                  <br />Expected admin: <span className="font-mono">{ADMIN_ADDRESS}</span>
                </div>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="mt-2 inline-flex items-center gap-2 rounded-md border dark:border-zinc-800 border-zinc-200 px-3 py-1.5 text-xs font-semibold dark:text-zinc-300 text-zinc-700"
                >
                  Switch wallet
                </button>
              </div>
            </div>
          </div>
        )}

        {ADMIN_ADDRESS && isAdmin && (
          <>
            {balances && (
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border dark:border-zinc-900 border-zinc-200 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Referee OKB</div>
                  <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">{fmtOkb(balances.okbWei)}</div>
                </div>
                <div className="rounded-md border dark:border-zinc-900 border-zinc-200 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Referee USDT</div>
                  <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">{fmtUsdt(balances.usdtWei)}</div>
                </div>
                <div className="rounded-md border dark:border-zinc-900 border-zinc-200 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Referee FVB</div>
                  <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">{fmtFvb(balances.fvbWei)}</div>
                </div>
              </div>
            )}

            {!snapshot && (
              <div className="mt-6 rounded-lg border dark:border-zinc-900 border-zinc-200 p-4">
                <div className="text-sm font-semibold dark:text-zinc-200 text-zinc-800">Snapshot not created.</div>
                <div className="mt-1 text-[11px] dark:text-zinc-500 text-zinc-500">
                  Freezes the current qualified top-5 X-connected leaderboard entries with USDT + FVB allocations.
                </div>
                <button
                  type="button"
                  onClick={createSnapshot}
                  disabled={busyOp === 'snapshot'}
                  className="mt-3 inline-flex items-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-zinc-950"
                >
                  <KeyRound size={13} /> {busyOp === 'snapshot' ? 'Signing…' : 'Create Season 1 snapshot'}
                </button>
              </div>
            )}

            {snapshot && (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border dark:border-zinc-900 border-zinc-200 p-4">
                  <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Season {snapshot.seasonId} · block {snapshot.snapshottedAtBlock}</div>
                  <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3">
                    <div>Reg closes <div className="font-semibold dark:text-zinc-200 text-zinc-800">{fmtDate(snapshot.registrationClosesAt)}</div></div>
                    <div>First payout <div className="font-semibold dark:text-zinc-200 text-zinc-800">{fmtDate(snapshot.firstPayoutAt)}</div></div>
                    <div>Final payout <div className="font-semibold dark:text-zinc-200 text-zinc-800">{fmtDate(snapshot.finalPayoutAt)}</div></div>
                  </div>
                  <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-3">
                    <div>USDT pool <div className="font-semibold dark:text-zinc-200 text-zinc-800">{fmtUsdt(snapshot.usdtPoolWei)}</div></div>
                    <div>FVB pool <div className="font-semibold dark:text-zinc-200 text-zinc-800">{fmtFvb(snapshot.fvbPoolWei)}</div></div>
                    <div>Buyback pool <div className="font-semibold dark:text-zinc-200 text-zinc-800">{fmtUsdt(snapshot.buybackPool.usdtWei)} + {fmtFvb(snapshot.buybackPool.fvbWei)}</div></div>
                  </div>
                </div>

                {snapshot.entries.map(entry => (
                  <div key={entry.address} className="rounded-lg border dark:border-zinc-900 border-zinc-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Rank #{entry.rank} · score {entry.score.toLocaleString()}</div>
                        <div className="mt-1 text-sm font-semibold dark:text-white text-zinc-900">
                          @{entry.xHandle} · <span className="font-mono">{shortAddr(entry.address)}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] dark:text-zinc-500 text-zinc-500">
                          Total {fmtUsdt(entry.usdtWei)}
                          {BigInt(entry.fvbWei) > 0n && <> · {fmtFvb(entry.fvbWei)}</>}
                          {entry.redirectedToBuyback && <> · <span className="text-amber-500">team → buyback</span></>}
                        </div>
                      </div>
                      <div className="text-right text-[11px]">
                        {entry.registered
                          ? <span className="inline-flex items-center gap-1 text-emerald-500 font-semibold"><ShieldCheck size={12} /> registered</span>
                          : <span className="text-zinc-500">not registered</span>}
                        {entry.registeredAt && (
                          <div className="mt-0.5 dark:text-zinc-500 text-zinc-500">{fmtDate(entry.registeredAt)}</div>
                        )}
                        {!entry.registered
                          && !entry.redirectedToBuyback
                          && trancheStatus.registrationClosed
                          && (BigInt(entry.usdtWei) > 0n || BigInt(entry.fvbWei) > 0n) && (
                          <button
                            type="button"
                            onClick={() => forfeit(entry)}
                            disabled={busyOp === `forfeit-${entry.address}`}
                            className="mt-2 inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-500 hover:bg-amber-500/20 disabled:opacity-40"
                          >
                            {busyOp === `forfeit-${entry.address}` ? 'Sweeping…' : 'Sweep to buyback'}
                          </button>
                        )}
                      </div>
                    </div>

                    {!entry.redirectedToBuyback && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <TrancheRow
                          title={`First · ${fmtDate(snapshot.firstPayoutAt)}`}
                          unlocked={trancheStatus.firstUnlocked}
                          registered={entry.registered}
                          usdtWei={entry.tranches.firstUsdtWei}
                          fvbWei={entry.tranches.firstFvbWei}
                          usdtStatus={entry.firstUsdtStatus}
                          fvbStatus={entry.firstFvbStatus}
                          usdtTx={entry.firstUsdtTxHash}
                          fvbTx={entry.firstFvbTxHash}
                          busyOp={busyOp}
                          onReleaseUsdt={() => release(entry, 'usdt', 'first')}
                          onReleaseFvb={() => release(entry, 'fvb', 'first')}
                          opIdUsdt={`release-usdt-first-${entry.address}`}
                          opIdFvb={`release-fvb-first-${entry.address}`}
                        />
                        <TrancheRow
                          title={`Final · ${fmtDate(snapshot.finalPayoutAt)}`}
                          unlocked={trancheStatus.finalUnlocked}
                          registered={entry.registered}
                          usdtWei={entry.tranches.finalUsdtWei}
                          fvbWei={entry.tranches.finalFvbWei}
                          usdtStatus={entry.finalUsdtStatus}
                          fvbStatus={entry.finalFvbStatus}
                          usdtTx={entry.finalUsdtTxHash}
                          fvbTx={entry.finalFvbTxHash}
                          busyOp={busyOp}
                          onReleaseUsdt={() => release(entry, 'usdt', 'final')}
                          onReleaseFvb={() => release(entry, 'fvb', 'final')}
                          opIdUsdt={`release-usdt-final-${entry.address}`}
                          opIdFvb={`release-fvb-final-${entry.address}`}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {error && (
          <div className="mt-4 rounded-md bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-500">{error}</div>
        )}
      </div>

      {confirmOp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-white">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 text-amber-400" size={16} />
              <div>
                <div className="font-semibold">Confirm signature</div>
                <div className="mt-1 text-xs text-zinc-300">{confirmOp.label}</div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOp(null)}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmOp.run()}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
              >
                Sign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrancheRow({
  title,
  unlocked,
  registered,
  usdtWei,
  fvbWei,
  usdtStatus,
  fvbStatus,
  usdtTx,
  fvbTx,
  busyOp,
  onReleaseUsdt,
  onReleaseFvb,
  opIdUsdt,
  opIdFvb,
}: {
  title: string;
  unlocked: boolean;
  registered: boolean;
  usdtWei: string;
  fvbWei: string;
  usdtStatus: PayoutStatus;
  fvbStatus: PayoutStatus;
  usdtTx: string | null;
  fvbTx: string | null;
  busyOp: string | null;
  onReleaseUsdt: () => void;
  onReleaseFvb: () => void;
  opIdUsdt: string;
  opIdFvb: string;
}) {
  const usdt = BigInt(usdtWei || '0');
  const fvb = BigInt(fvbWei || '0');
  const canRelease = unlocked && registered;
  return (
    <div className="rounded-md border dark:border-zinc-900 border-zinc-200 px-3 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">{title}</div>
      <div className="mt-2 space-y-2 text-[12px] dark:text-zinc-200 text-zinc-800">
        {usdt > 0n && (
          <div className="flex items-center justify-between gap-2">
            <span>USDT · {fmtUsdt(usdtWei)}</span>
            <div className="flex items-center gap-2">
              <StatusPill status={usdtStatus} unlocked={unlocked} />
              {usdtTx && (
                <a href={`https://www.okx.com/web3/explorer/xlayer/tx/${usdtTx}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-500 inline-flex items-center gap-1">
                  tx <ExternalLink size={10} />
                </a>
              )}
              {usdtStatus === 'pending' && canRelease && (
                <button
                  type="button"
                  onClick={onReleaseUsdt}
                  disabled={busyOp === opIdUsdt}
                  className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  {busyOp === opIdUsdt ? '…' : 'Release'}
                </button>
              )}
            </div>
          </div>
        )}
        {fvb > 0n && (
          <div className="flex items-center justify-between gap-2">
            <span>FVB · {fmtFvb(fvbWei)}</span>
            <div className="flex items-center gap-2">
              <StatusPill status={fvbStatus} unlocked={unlocked} />
              {fvbTx && (
                <a href={`https://www.okx.com/web3/explorer/xlayer/tx/${fvbTx}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-500 inline-flex items-center gap-1">
                  tx <ExternalLink size={10} />
                </a>
              )}
              {fvbStatus === 'pending' && canRelease && (
                <button
                  type="button"
                  onClick={onReleaseFvb}
                  disabled={busyOp === opIdFvb}
                  className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  {busyOp === opIdFvb ? '…' : 'Release'}
                </button>
              )}
            </div>
          </div>
        )}
        {usdt === 0n && fvb === 0n && (
          <div className="text-[11px] dark:text-zinc-500 text-zinc-500">No allocation.</div>
        )}
      </div>
    </div>
  );
}
