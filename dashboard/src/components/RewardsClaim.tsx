import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { formatUnits } from 'viem';
import { KeyRound, ShieldCheck, Trophy, Wallet, ExternalLink } from 'lucide-react';
import { shortAddr } from '../lib/encode';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';

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

interface StatusResponse {
  seasonId: string;
  snapshottedAt: number;
  registrationClosesAt: number;
  firstPayoutAt: number;
  finalPayoutAt: number;
  now: number;
  eligible: boolean;
  registrationOpen: boolean;
  entry: EntryView | null;
  registrationMessage: string | null;
}

function formatUsdt(wei: string): string {
  return `$${Number(formatUnits(BigInt(wei || '0'), 6)).toFixed(2)}`;
}

function formatFvb(wei: string): string {
  const n = Number(formatUnits(BigInt(wei || '0'), 18));
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} FVB`;
}

function formatUntil(target: number, now: number): string {
  const ms = target - now;
  if (ms <= 0) return 'unlocked';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days >= 1) return `${days}d ${hours}h`;
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

function fmtDateUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function StatusPill({ status, label }: { status: PayoutStatus; label: string }) {
  const style = status === 'sent'
    ? 'bg-emerald-500/10 text-emerald-500'
    : status === 'failed'
      ? 'bg-rose-500/10 text-rose-500'
      : 'bg-zinc-500/10 text-zinc-500';
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${style}`}>{label}</span>;
}

export function RewardsClaim() {
  const { ready, authenticated, login, logout, linkWallet, user } = usePrivy();
  const { wallets } = useWallets();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [snapshotAddresses, setSnapshotAddresses] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Auto-pick the wallet that matches a snapshot entry so users don't have to know
  // which linked wallet is the eligible one. Fall back to the primary if none match.
  const eligibleWallet = wallets.find(w => snapshotAddresses.has(w.address.toLowerCase()));
  const address = eligibleWallet?.address
    ?? user?.wallet?.address
    ?? wallets[0]?.address
    ?? null;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  // Fetch the full snapshot once so we know all eligible addresses across the top 5.
  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_HTTP}/rewards/snapshot`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (data?.entries) {
          setSnapshotAddresses(new Set(data.entries.map((e: { address: string }) => e.address.toLowerCase())));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!address) {
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_HTTP}/rewards/status/${address}`);
      if (res.status === 404) {
        setStatus(null);
        setError('Season 1 snapshot has not been published yet.');
      } else {
        const data = await res.json() as StatusResponse;
        setStatus(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const register = useCallback(async () => {
    if (!status?.entry || !status.registrationMessage || !address) return;
    setPending(true);
    setError(null);
    try {
      const target = status.entry.address.toLowerCase();
      const wallet = wallets.find(w => w.address.toLowerCase() === target);
      if (!wallet) throw new Error(`Connect the wallet ${shortAddr(target)} to register — this wallet holds a reward slot.`);
      const provider = await wallet.getEthereumProvider();
      const signature = await provider.request({
        method: 'personal_sign',
        params: [status.registrationMessage, wallet.address],
      }) as `0x${string}`;

      const res = await fetch(`${BACKEND_HTTP}/rewards/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seasonId: status.seasonId,
          address: wallet.address,
          signature,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error ?? 'Registration failed');
      }
      await refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // User cancellation from personal_sign shows up as this pattern
      if (/user reject|denied|cancelled/i.test(message)) {
        setError('Registration cancelled.');
      } else {
        setError(message);
      }
    } finally {
      setPending(false);
    }
  }, [address, refreshStatus, status, wallets]);

  const entry = status?.entry ?? null;

  const registrationEnded = status && status.now >= status.registrationClosesAt;
  const firstPayoutReached = status && status.now >= status.firstPayoutAt;
  const finalPayoutReached = status && status.now >= status.finalPayoutAt;

  const bodyState: 'not-connected' | 'not-eligible' | 'eligible-not-registered' | 'registered' | 'no-snapshot' = useMemo(() => {
    if (!status && error) return 'no-snapshot';
    if (!authenticated || !address) return 'not-connected';
    if (!entry) return 'not-eligible';
    if (!entry.registered) return 'eligible-not-registered';
    return 'registered';
  }, [address, authenticated, entry, error, status]);

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <a href="/" className="text-xs font-semibold text-blue-600 hover:underline">← Back to FanVibe</a>

        <div className="mt-4 flex items-center gap-3">
          <Trophy className="text-blue-600" size={22} />
          <h1 className="text-xl font-bold dark:text-white text-zinc-900">Season 1 rewards</h1>
        </div>
        <p className="mt-1 text-xs dark:text-zinc-500 text-zinc-500">
          Top 5 Distribution Cup wallets with connected X qualify. Register with the wallet that ranks — payouts are staged.
        </p>

        {status && (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border dark:border-zinc-900 border-zinc-200 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Registration closes</div>
              <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">{fmtDateUtc(status.registrationClosesAt)}</div>
              <div className="mt-0.5 text-[11px] dark:text-zinc-500 text-zinc-500">{formatUntil(status.registrationClosesAt, now)}</div>
            </div>
            <div className="rounded-md border dark:border-zinc-900 border-zinc-200 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">First payout</div>
              <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">{fmtDateUtc(status.firstPayoutAt)}</div>
              <div className="mt-0.5 text-[11px] dark:text-zinc-500 text-zinc-500">{formatUntil(status.firstPayoutAt, now)}</div>
            </div>
            <div className="rounded-md border dark:border-zinc-900 border-zinc-200 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Final payout</div>
              <div className="mt-1 text-sm font-semibold dark:text-zinc-100 text-zinc-900">{fmtDateUtc(status.finalPayoutAt)}</div>
              <div className="mt-0.5 text-[11px] dark:text-zinc-500 text-zinc-500">{formatUntil(status.finalPayoutAt, now)}</div>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-lg border dark:border-zinc-900 border-zinc-200 p-4">
          {bodyState === 'no-snapshot' && (
            <div className="text-xs dark:text-zinc-400 text-zinc-600">{error ?? 'Snapshot not published.'}</div>
          )}

          {bodyState === 'not-connected' && (
            <div className="flex flex-col items-start gap-3">
              <div className="text-sm dark:text-zinc-200 text-zinc-800 font-semibold">Connect the wallet on your leaderboard slot.</div>
              <div className="text-xs dark:text-zinc-500 text-zinc-500">
                Only the wallet ranked in the top 5 (with connected X) can register — signature is required.
              </div>
              <button
                type="button"
                onClick={() => login({ loginMethods: ['email', 'wallet'] })}
                disabled={!ready}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Wallet size={13} />
                Sign in
              </button>
            </div>
          )}

          {bodyState === 'not-eligible' && (
            <div>
              <div className="text-sm font-semibold dark:text-white text-zinc-900">
                None of your connected wallets are on the Season 1 snapshot.
              </div>
              <div className="mt-2 text-xs dark:text-zinc-500 text-zinc-500">
                The snapshot froze the top 5 X-connected Distribution Cup wallets at
                block <span className="font-mono">{status?.snapshottedAt ? fmtDateUtc(status.snapshottedAt) : '—'}</span>.
                If you were on the leaderboard but see this message, the wallet that ranked isn&apos;t connected here yet.
              </div>

              {wallets.length > 0 && (
                <div className="mt-3 rounded-md border dark:border-zinc-900 border-zinc-200 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Connected wallets</div>
                  <ul className="mt-2 space-y-1 text-[11px]">
                    {wallets.map(w => (
                      <li key={w.address} className="flex items-center justify-between gap-2 font-mono">
                        <span className="dark:text-zinc-300 text-zinc-700">{w.address}</span>
                        <span className="text-zinc-500">not on snapshot</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => linkWallet()}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  <Wallet size={13} />
                  Link the ranked wallet
                </button>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="inline-flex items-center gap-2 rounded-md border dark:border-zinc-800 border-zinc-200 px-3 py-1.5 text-xs font-semibold dark:text-zinc-300 text-zinc-700"
                >
                  Sign out
                </button>
              </div>

              <div className="mt-3 text-[11px] dark:text-zinc-500 text-zinc-500">
                Not sure which wallet ranked? Check the Distribution Cup leaderboard on <a href="/" className="text-blue-500 hover:underline">fanvibe.xyz</a> — the wallet showing your @handle is the one to link here.
              </div>
            </div>
          )}

          {bodyState === 'eligible-not-registered' && entry && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Rank #{entry.rank}</div>
                  <div className="mt-1 text-lg font-bold dark:text-white text-zinc-900">
                    {formatUsdt(entry.usdtWei)}
                    {BigInt(entry.fvbWei) > 0n && <> · {formatFvb(entry.fvbWei)}</>}
                  </div>
                  <div className="mt-0.5 text-[11px] dark:text-zinc-500 text-zinc-500">
                    {shortAddr(entry.address)} · @{entry.xHandle} · score {entry.score.toLocaleString()}
                  </div>
                </div>
                <Trophy className="text-blue-600" size={22} />
              </div>

              {entry.redirectedToBuyback && (
                <div className="rounded-md bg-amber-500/10 px-3 py-2 text-[11px] dark:text-amber-300 text-amber-700">
                  This wallet is disclosed as team-owned. Its USDT slot is redirected to the FVB buyback pool.
                </div>
              )}

              {status?.registrationOpen && !registrationEnded ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 text-[11px] leading-5 dark:text-zinc-500 text-zinc-500">
                    <ShieldCheck size={15} className="mt-0.5 shrink-0 text-blue-500" />
                    <p>
                      You&apos;ll sign a plain-text message to prove ownership of this address. FanVibe never asks for your private key.
                      No gas, no transaction. Once registered, the first tranche unlocks on {fmtDateUtc(status.firstPayoutAt)}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={register}
                    disabled={pending}
                    className="inline-flex items-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                  >
                    <KeyRound size={13} />
                    {pending ? 'Waiting for signature…' : 'Register to claim'}
                  </button>
                </div>
              ) : (
                <div className="rounded-md bg-rose-500/10 px-3 py-2 text-[11px] text-rose-500">
                  Registration has closed. This slot forfeits to the buyback pool.
                </div>
              )}
            </div>
          )}

          {bodyState === 'registered' && entry && status && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Rank #{entry.rank} · registered</div>
                  <div className="mt-1 text-lg font-bold dark:text-white text-zinc-900">
                    Total {formatUsdt(entry.usdtWei)}
                    {BigInt(entry.fvbWei) > 0n && <> · {formatFvb(entry.fvbWei)}</>}
                  </div>
                  <div className="mt-0.5 text-[11px] dark:text-zinc-500 text-zinc-500">
                    Registered {entry.registeredAt ? fmtDateUtc(entry.registeredAt) : '—'}
                  </div>
                </div>
                <ShieldCheck className="text-emerald-500" size={22} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <TrancheCard
                  title={`First tranche · ${fmtDateUtc(status.firstPayoutAt)}`}
                  unlocked={Boolean(firstPayoutReached)}
                  usdtWei={entry.tranches.firstUsdtWei}
                  fvbWei={entry.tranches.firstFvbWei}
                  usdtStatus={entry.firstUsdtStatus}
                  usdtTx={entry.firstUsdtTxHash}
                  fvbStatus={entry.firstFvbStatus}
                  fvbTx={entry.firstFvbTxHash}
                />
                <TrancheCard
                  title={`Final tranche · ${fmtDateUtc(status.finalPayoutAt)}`}
                  unlocked={Boolean(finalPayoutReached)}
                  usdtWei={entry.tranches.finalUsdtWei}
                  fvbWei={entry.tranches.finalFvbWei}
                  usdtStatus={entry.finalUsdtStatus}
                  usdtTx={entry.finalUsdtTxHash}
                  fvbStatus={entry.finalFvbStatus}
                  fvbTx={entry.finalFvbTxHash}
                />
              </div>
            </div>
          )}
        </div>

        {error && bodyState !== 'no-snapshot' && (
          <div className="mt-3 rounded-md bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-500">{error}</div>
        )}

        {loading && (
          <div className="mt-3 text-[11px] dark:text-zinc-500 text-zinc-500">Loading…</div>
        )}
      </div>
    </div>
  );
}

function TrancheCard({
  title,
  unlocked,
  usdtWei,
  fvbWei,
  usdtStatus,
  usdtTx,
  fvbStatus,
  fvbTx,
}: {
  title: string;
  unlocked: boolean;
  usdtWei: string;
  fvbWei: string;
  usdtStatus: PayoutStatus;
  usdtTx: string | null;
  fvbStatus: PayoutStatus;
  fvbTx: string | null;
}) {
  const usdt = BigInt(usdtWei || '0');
  const fvb = BigInt(fvbWei || '0');
  return (
    <div className="rounded-md border dark:border-zinc-900 border-zinc-200 px-3 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">{title}</div>
      <div className="mt-2 space-y-2 text-[12px] dark:text-zinc-200 text-zinc-800">
        {usdt > 0n && (
          <div className="flex items-center justify-between gap-2">
            <span>USDT · {formatUsdt(usdtWei)}</span>
            <div className="flex items-center gap-2">
              <StatusPill status={usdtStatus} label={unlocked ? usdtStatus : 'locked'} />
              {usdtTx && (
                <a
                  href={`https://www.okx.com/web3/explorer/xlayer/tx/${usdtTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-blue-500"
                >
                  tx <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>
        )}
        {fvb > 0n && (
          <div className="flex items-center justify-between gap-2">
            <span>FVB · {formatFvb(fvbWei)}</span>
            <div className="flex items-center gap-2">
              <StatusPill status={fvbStatus} label={unlocked ? fvbStatus : 'locked'} />
              {fvbTx && (
                <a
                  href={`https://www.okx.com/web3/explorer/xlayer/tx/${fvbTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-blue-500"
                >
                  tx <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>
        )}
        {usdt === 0n && fvb === 0n && (
          <div className="text-[11px] dark:text-zinc-500 text-zinc-500">No allocation in this tranche.</div>
        )}
      </div>
    </div>
  );
}
