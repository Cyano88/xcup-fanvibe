import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Trophy, Zap, CheckCircle } from 'lucide-react';
import { parseEther } from 'viem';
import type { Fixture, MatchState, ChampionPool } from '../types';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { STRENGTH } from '../lib/clientSim';
import { encodeChampionStake, CHAMP_TEAM_INDEX } from '../lib/encode';
import { formatStakeUsd, useOkbUsdPrice } from '../lib/useOkbUsdPrice';
import { PrivyStakeButton } from './PrivyStakeButton';
import { PrivyWalletStakeButton } from './PrivyWalletStakeButton';
import { PrivyBalanceHint } from './PrivyBalanceHint';

const PRIVY_ENABLED = Boolean(import.meta.env.VITE_PRIVY_APP_ID);

interface Props {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  eliminatedTeams: Set<string>;
  refereeAddress: string;
  daemonChampPool?: ChampionPool; // from live daemon when online
}

const flagUrl = (iso: string) =>
  iso === 'un' || iso === 'tbd' ? '' : `https://flagcdn.com/w160/${iso.toLowerCase()}.png`;

function TeamFlag({ iso, fallback, className = '' }: { iso: string; fallback: string; className?: string }) {
  const src = flagUrl(iso);
  if (!src) return <span className={className}>{fallback}</span>;

  return (
    <span className={`relative inline-flex items-center justify-center overflow-hidden rounded-[3px] bg-zinc-200 dark:bg-zinc-800 shadow-sm ring-1 ring-black/10 dark:ring-white/10 ${className}`}>
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
          const parent = event.currentTarget.parentElement;
          if (parent) parent.textContent = fallback;
        }}
      />
    </span>
  );
}

function fmtWei(wei: string | bigint): string {
  const n = Number(BigInt(wei)) / 1e18;
  return n < 0.0001 ? '0' : n.toFixed(4);
}

function isEmbeddedWallet(walletClientType: string) {
  return walletClientType === 'privy' || walletClientType === 'privy-v2';
}

function PrimaryChampionStakeAction({
  amountOKB,
  calldata,
  refereeAddress,
  disabled,
  pendingLabel,
  onSuccess,
  onError,
}: {
  amountOKB: string;
  calldata: `0x${string}`;
  refereeAddress: string;
  disabled?: boolean;
  pendingLabel: string;
  onSuccess: (hash: `0x${string}`, amountWei: bigint) => void;
  onError: (message: string) => void;
}) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const externalWallet = wallets.find(wallet => !isEmbeddedWallet(wallet.walletClientType));
  const buttonClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-3.5 text-xs font-bold text-white transition-all active:scale-95 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50';
  const label = authenticated || externalWallet ? `Stake ${amountOKB} OKB ->` : 'Sign in to stake';

  if (externalWallet) {
    return (
      <PrivyWalletStakeButton
        amountOKB={amountOKB}
        calldata={calldata}
        refereeAddress={refereeAddress}
        disabled={disabled}
        pendingLabel={pendingLabel}
        onSuccess={(hash, amountWei) => onSuccess(hash, amountWei)}
        onError={(message) => onError(message || '')}
        className={buttonClass}
      >
        {label}
      </PrivyWalletStakeButton>
    );
  }

  return (
    <PrivyStakeButton
      amountOKB={amountOKB}
      calldata={calldata}
      refereeAddress={refereeAddress}
      disabled={disabled}
      pendingLabel="Confirm stake..."
      onSuccess={(hash, amountWei) => onSuccess(hash, amountWei)}
      onError={(message) => onError(message || '')}
      className={buttonClass}
    >
      {label}
    </PrivyStakeButton>
  );
}

export function ChampionPick({
  fixtures,
  eliminatedTeams,
  refereeAddress,
  daemonChampPool,
}: Props) {
  const [open, setOpen]           = useState(false);
  const [selected, setSelected]   = useState<string | null>(null);
  const [amountOKB, setAmountOKB] = useState('0.01');
  const [txPending, setTxPending] = useState(false);
  const [txHash, setTxHash]       = useState<string | null>(null);
  const [txError, setTxError]     = useState<string | null>(null);
  const okbUsd = useOkbUsdPrice();
  const stakeUsd = formatStakeUsd(amountOKB, okbUsd);

  // Local pool (client-side tracking until daemon picks it up)
  const [localPool, setLocalPool] = useState<Record<string, bigint>>({});

  const championTeams = useMemo(() => {
    const teams = new Map<string, Fixture['home']>();
    fixtures.forEach(fixture => {
      if (fixture.home.code !== 'TBD') teams.set(fixture.home.code, fixture.home);
      if (fixture.away.code !== 'TBD') teams.set(fixture.away.code, fixture.away);
    });
    return [...teams.values()]
      .filter(team => CHAMP_TEAM_INDEX[team.code] !== undefined)
      .sort((a, b) => CHAMP_TEAM_INDEX[a.code] - CHAMP_TEAM_INDEX[b.code]);
  }, [fixtures]);

  // Merge daemon pool (if live) with local
  const effectivePool = useMemo<Record<string, string>>(() => {
    const merged: Record<string, bigint> = {};
    championTeams.forEach(t => { merged[t.code] = 0n; });
    // daemon pool
    if (daemonChampPool) {
      Object.entries(daemonChampPool.byTeam).forEach(([code, wei]) => {
        merged[code] = (merged[code] ?? 0n) + BigInt(wei);
      });
    }
    // local additions
    Object.entries(localPool).forEach(([code, wei]) => {
      merged[code] = (merged[code] ?? 0n) + wei;
    });
    return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, v.toString()]));
  }, [daemonChampPool, localPool, championTeams]);

  const totalWei = Object.values(effectivePool).reduce((s, v) => s + BigInt(v), 0n);
  const totalCount = (daemonChampPool?.count ?? 0) + Object.values(localPool).filter(v => v > 0n).length;
  const isSettled = daemonChampPool?.settled ?? false;
  const settledWinner = daemonChampPool?.winner;

  // Odds: squad model first, then market flow as OKB enters the pool.
  const activeTeams = championTeams.filter(t => !eliminatedTeams.has(t.code));
  const ratingWeight = (code: string) => {
    const strength = STRENGTH[code] ?? 60;
    return Math.exp((strength - 72) / 10);
  };
  const totalRatingWeight = activeTeams.reduce((s, t) => s + ratingWeight(t.code), 0);

  function modelChance(code: string): number {
    if (eliminatedTeams.has(code)) return 0;
    return (ratingWeight(code) / totalRatingWeight) * 100;
  }

  function poolShare(code: string): number {
    if (totalWei === 0n) return 0;
    const tw = BigInt(effectivePool[code] ?? '0');
    return Math.round(Number(tw * 10000n / totalWei) / 100);
  }

  function displayOdds(code: string): number {
    const model = modelChance(code);
    if (totalWei === 0n) return model;
    const market = poolShare(code);
    return model * 0.7 + market * 0.3;
  }

  function fmtOdds(value: number): string {
    if (value <= 0) return '0%';
    return value >= 10 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
  }

  async function handleStake() {
    if (!selected || !refereeAddress) return;
    setTxError(null);
    setTxPending(true);
    try {
      const eth = (window as unknown as { ethereum?: unknown }).ethereum as {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      } | undefined;
      if (!eth) throw new Error('No wallet detected. Install MetaMask or OKX Wallet.');

      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts?.length) throw new Error('No account connected');

      const amountWei = parseEther(amountOKB || '0.01');
      const calldata  = encodeChampionStake(selected);

      const hash = (await eth.request({
        method: 'eth_sendTransaction',
        params: [{
          from: accounts[0],
          to: refereeAddress,
          value: `0x${amountWei.toString(16)}`,
          data: calldata,
          chainId: '0xc4', // 196 = X Layer mainnet
        }],
      })) as string;

      setTxHash(hash);
      // Track locally
      setLocalPool(prev => ({
        ...prev,
        [selected]: (prev[selected] ?? 0n) + amountWei,
      }));
      setSelected(null);
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setTxPending(false);
    }
  }

  return (
    <div className="dark:bg-zinc-950 bg-white border dark:border-zinc-800 border-zinc-200 rounded-lg overflow-hidden">

      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 dark:hover:bg-zinc-800/40 hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Trophy size={15} className="text-emerald-500" />
          <span className="text-sm font-bold dark:text-zinc-100 text-zinc-800">Predict the Champion</span>
          {isSettled && settledWinner && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              <CheckCircle size={9} /> Settled  - {settledWinner}
            </span>
          )}
          {!isSettled && (
            <span className="text-[11px] dark:text-zinc-500 text-zinc-400">
              {totalWei > 0n
                ? `${fmtWei(totalWei)} OKB  - ${totalCount} pick${totalCount !== 1 ? 's' : ''}`
                : 'Be the first to stake'}
            </span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="dark:text-zinc-500 text-zinc-400" /> : <ChevronDown size={14} className="dark:text-zinc-500 text-zinc-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">

          {/* Subheading */}
          <p className="text-[11px] dark:text-zinc-500 text-zinc-400">
            Stake OKB on the team you think will lift the trophy. Pool pays out proportionally to backers of the champion when the Final settles.
            {eliminatedTeams.size > 0 && (
              <span className="dark:text-zinc-600 text-zinc-400">  - {eliminatedTeams.size} eliminated</span>
            )}
          </p>

          {/* Team grid */}
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5">
            {championTeams.map(team => {
              const elim    = eliminatedTeams.has(team.code);
              const odds    = displayOdds(team.code);
              const share   = poolShare(team.code);
              const staked  = BigInt(effectivePool[team.code] ?? '0') > 0n;
              const isWinner = settledWinner === team.code;
              const teamIdx  = CHAMP_TEAM_INDEX[team.code];
              const canStake = !elim && !isSettled && teamIdx !== undefined;

              return (
                <button
                  key={team.code}
                  onClick={() => canStake ? setSelected(s => s === team.code ? null : team.code) : undefined}
                  disabled={!canStake}
                  style={team.iso !== 'un' && team.iso !== 'tbd'
                    ? { backgroundImage: `url(${flagUrl(team.iso)})` }
                    : undefined}
                  className={`group relative min-h-[78px] overflow-hidden bg-cover bg-center flex flex-col items-center justify-end gap-0.5 p-2 rounded-lg border text-center transition-all duration-150
                    ${isWinner
                      ? 'dark:border-emerald-400 border-emerald-500 shadow-sm shadow-emerald-500/10'
                      : elim
                        ? 'opacity-30 dark:border-zinc-800 border-zinc-200 cursor-default grayscale'
                        : selected === team.code
                          ? 'dark:border-emerald-400 border-emerald-500 shadow-sm shadow-emerald-500/10'
                          : staked
                            ? 'dark:border-zinc-600 border-zinc-300 dark:hover:border-zinc-500 hover:border-zinc-400'
                            : 'dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-500 hover:border-zinc-300 active:scale-95 hover:-translate-y-0.5'}`}
                >
                  <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/52 to-black/24 transition-opacity duration-200 group-hover:from-black/82 group-hover:via-black/42 group-hover:to-black/18" />
                  {/* Staked dot */}
                  {staked && !elim && (
                    <span className="absolute top-1.5 right-1.5 z-10 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm" />
                  )}
                  {isWinner && (
                    <span className="absolute top-1.5 right-1.5 z-10 grid h-4 w-4 place-items-center rounded-full bg-black/35 text-emerald-200 ring-1 ring-white/15 backdrop-blur-sm"><Trophy size={9} strokeWidth={1.8} /></span>
                  )}

                  <span className={`relative z-10 text-[11px] font-bold leading-none drop-shadow ${
                    isWinner ? 'text-emerald-200' :
                    selected === team.code ? 'text-white' :
                    elim ? 'dark:text-zinc-600 text-zinc-400' :
                    'text-white'}`}>
                    {team.code}
                  </span>
                  {!elim ? (
                    <span className={`relative z-10 mt-1 rounded bg-black/58 px-1.5 py-0.5 text-[11px] font-black leading-none shadow-sm ring-1 ring-white/12 backdrop-blur-[1px] ${
                      share > 0 ? 'text-white' : 'text-zinc-100'}`}>
                      {totalWei > 0n ? fmtOdds(odds) : `~${fmtOdds(odds)}`}
                    </span>
                  ) : (
                    <span className="relative z-10 text-[9px] text-zinc-300 leading-none">OUT</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Stake panel */}
          {selected && !isSettled && (
            <div className="dark:bg-zinc-800/60 bg-zinc-50 border dark:border-zinc-700 border-zinc-200 rounded-xl p-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-bold dark:text-zinc-100 text-zinc-800">
                {(() => {
                  const team = championTeams.find(t => t.code === selected);
                  return team ? (
                    <>
                      <TeamFlag iso={team.iso} fallback={team.flag} className="h-5 w-7" />
                      <span className="min-w-0 truncate">{team.name}</span>
                    </>
                  ) : <span>{selected}</span>;
                })()}
                <span className="text-xs dark:text-zinc-400 text-zinc-500 font-normal">to win WC 2026</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(150px,1fr)_auto_auto] sm:items-center">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-9 min-w-[120px] items-center gap-1 dark:bg-zinc-900 bg-white border dark:border-zinc-700 border-zinc-200 rounded-lg px-2">
                    <input
                      type="number"
                      step="0.001"
                      min="0.001"
                      value={amountOKB}
                      onChange={e => setAmountOKB(e.target.value)}
                      className="w-full min-w-0 bg-transparent text-sm font-semibold dark:text-zinc-100 text-zinc-800 outline-none"
                    />
                    <span className="shrink-0 text-[10px] dark:text-zinc-500 text-zinc-400">OKB</span>
                  </div>
                  {stakeUsd && (
                    <span className="shrink-0 text-[11px] font-medium dark:text-zinc-600 text-zinc-400">
                      {stakeUsd}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="h-9 rounded-md px-2.5 text-xs font-semibold dark:text-zinc-500 text-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-600 transition-colors"
                >
                  Cancel
                </button>
                {PRIVY_ENABLED ? (
                  <PrimaryChampionStakeAction
                    amountOKB={amountOKB}
                    calldata={encodeChampionStake(selected)}
                    refereeAddress={refereeAddress}
                    disabled={txPending || !refereeAddress}
                    pendingLabel="Confirm in wallet..."
                    onSuccess={(hash, amountWei) => {
                      setTxHash(hash);
                      setLocalPool(prev => ({
                        ...prev,
                        [selected]: (prev[selected] ?? 0n) + amountWei,
                      }));
                      setSelected(null);
                    }}
                    onError={(message) => setTxError(message || null)}
                  />
                ) : (
                  <button
                    onClick={handleStake}
                    disabled={txPending || !refereeAddress}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-3.5 text-xs font-bold text-white transition-all active:scale-95 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {txPending ? (
                      <><Zap size={10} className="animate-pulse" />Confirm in wallet...</>
                    ) : (
                      <>Stake {amountOKB} OKB {'->'}</>
                    )}
                  </button>
                )}
              </div>
              {PRIVY_ENABLED && <div className="mt-2"><PrivyBalanceHint amountOKB={amountOKB} /></div>}
              {txError && (
                <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-400">{txError}</p>
              )}
            </div>
          )}

          {/* Recent tx confirmation */}
          {txHash && (
            <div className="flex items-center gap-2 text-[11px] dark:text-emerald-400 text-emerald-600">
              <CheckCircle size={11} />
              <span>Staked! Tx:</span>
              <a
                href={`https://www.okx.com/web3/explorer/xlayer/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline truncate max-w-[240px]"
              >
                {txHash.slice(0, 16)}...
              </a>
              <button onClick={() => setTxHash(null)} className="ml-auto dark:text-zinc-600 text-zinc-400 hover:dark:text-zinc-400 hover:text-zinc-600">x</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


