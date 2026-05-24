import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Trophy, Zap, CheckCircle } from 'lucide-react';
import { parseEther } from 'viem';
import type { Fixture, MatchState, ChampionPool } from '../types';
import { STRENGTH } from '../lib/clientSim';
import { encodeChampionStake, CHAMP_TEAM_INDEX } from '../lib/encode';
import { STATIC_FIXTURES } from '../types';

interface Props {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  eliminatedTeams: Set<string>;
  refereeAddress: string;
  daemonChampPool?: ChampionPool; // from live daemon when online
}

// All 32 R32 teams in bracket order
const R32_TEAMS = STATIC_FIXTURES
  .filter(f => f.round === 'R32')
  .flatMap(f => [f.home, f.away]);

function fmtWei(wei: string | bigint): string {
  const n = Number(BigInt(wei)) / 1e18;
  return n < 0.0001 ? '0' : n.toFixed(4);
}

export function ChampionPick({
  eliminatedTeams,
  refereeAddress,
  daemonChampPool,
}: Props) {
  const [open, setOpen]           = useState(true);
  const [selected, setSelected]   = useState<string | null>(null);
  const [amountOKB, setAmountOKB] = useState('0.01');
  const [txPending, setTxPending] = useState(false);
  const [txHash, setTxHash]       = useState<string | null>(null);
  const [txError, setTxError]     = useState<string | null>(null);

  // Local pool (client-side tracking until daemon picks it up)
  const [localPool, setLocalPool] = useState<Record<string, bigint>>({});

  // Merge daemon pool (if live) with local
  const effectivePool = useMemo<Record<string, string>>(() => {
    const merged: Record<string, bigint> = {};
    R32_TEAMS.forEach(t => { merged[t.code] = 0n; });
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
  }, [daemonChampPool, localPool]);

  const totalWei = Object.values(effectivePool).reduce((s, v) => s + BigInt(v), 0n);
  const totalCount = (daemonChampPool?.count ?? 0) + Object.values(localPool).filter(v => v > 0n).length;
  const isSettled = daemonChampPool?.settled ?? false;
  const settledWinner = daemonChampPool?.winner;

  // Odds: blend base strength with live pool share
  const activeTeams = R32_TEAMS.filter(t => !eliminatedTeams.has(t.code));
  const totalStrength = activeTeams.reduce((s, t) => s + (STRENGTH[t.code] ?? 60), 0);

  function baseOdds(code: string): number {
    if (eliminatedTeams.has(code)) return 0;
    return Math.round(((STRENGTH[code] ?? 60) / totalStrength) * 100);
  }

  function poolShare(code: string): number {
    if (totalWei === 0n) return 0;
    const tw = BigInt(effectivePool[code] ?? '0');
    return Math.round(Number(tw * 10000n / totalWei) / 100);
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
    <div className="dark:bg-zinc-900/60 bg-white border dark:border-zinc-800 border-zinc-200 rounded-2xl overflow-hidden">

      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 dark:hover:bg-zinc-800/40 hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Trophy size={15} className="text-yellow-500" />
          <span className="text-sm font-bold dark:text-zinc-100 text-zinc-800">Predict the Champion</span>
          {isSettled && settledWinner && (
            <span className="flex items-center gap-1 text-[11px] font-mono font-bold text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">
              <CheckCircle size={9} /> Settled · {settledWinner}
            </span>
          )}
          {!isSettled && (
            <span className="text-[11px] font-mono dark:text-zinc-500 text-zinc-400">
              {totalWei > 0n
                ? `${fmtWei(totalWei)} OKB · ${totalCount} pick${totalCount !== 1 ? 's' : ''}`
                : 'Be the first to stake'}
            </span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="dark:text-zinc-500 text-zinc-400" /> : <ChevronDown size={14} className="dark:text-zinc-500 text-zinc-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">

          {/* Subheading */}
          <p className="text-[11px] dark:text-zinc-500 text-zinc-400 font-mono">
            Stake OKB on the team you think will lift the trophy. Pool pays out proportionally to backers of the champion when the Final settles.
            {eliminatedTeams.size > 0 && (
              <span className="dark:text-zinc-600 text-zinc-400"> · {eliminatedTeams.size} eliminated</span>
            )}
          </p>

          {/* Team grid */}
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5">
            {R32_TEAMS.map(team => {
              const elim    = eliminatedTeams.has(team.code);
              const odds    = baseOdds(team.code);
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
                  className={`relative flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl border text-center transition-all duration-150
                    ${isWinner
                      ? 'dark:bg-yellow-500/15 bg-yellow-50 dark:border-yellow-500/40 border-yellow-300 shadow-sm shadow-yellow-500/10'
                      : elim
                        ? 'opacity-25 dark:bg-zinc-900 bg-zinc-100 dark:border-zinc-800 border-zinc-200 cursor-default'
                        : selected === team.code
                          ? 'dark:bg-emerald-500/15 bg-emerald-50 dark:border-emerald-400/60 border-emerald-300 shadow-sm shadow-emerald-500/10'
                          : staked
                            ? 'dark:bg-zinc-800/80 bg-zinc-50 dark:border-zinc-600 border-zinc-300 dark:hover:border-zinc-500 hover:border-zinc-400'
                            : 'dark:bg-zinc-900 bg-white dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-300 active:scale-95'}`}
                >
                  {/* Staked dot */}
                  {staked && !elim && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  )}
                  {isWinner && (
                    <span className="absolute top-1 right-1 text-[10px]">🏆</span>
                  )}

                  <span className="text-xl leading-none">{team.flag}</span>
                  <span className={`text-[10px] font-mono font-bold leading-none mt-0.5 ${
                    isWinner ? 'text-yellow-400' :
                    selected === team.code ? 'dark:text-emerald-300 text-emerald-700' :
                    elim ? 'dark:text-zinc-600 text-zinc-400' :
                    'dark:text-zinc-200 text-zinc-700'}`}>
                    {team.code}
                  </span>
                  {!elim ? (
                    <span className={`text-[9px] font-mono leading-none ${
                      share > 0 ? 'dark:text-zinc-400 text-zinc-500' : 'dark:text-zinc-600 text-zinc-400'}`}>
                      {share > 0 ? `${share}%` : `~${odds}%`}
                    </span>
                  ) : (
                    <span className="text-[9px] font-mono dark:text-zinc-700 text-zinc-400 leading-none">OUT</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Stake panel */}
          {selected && !isSettled && (
            <div className="dark:bg-zinc-800/60 bg-zinc-50 border dark:border-zinc-700 border-zinc-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm font-bold dark:text-zinc-100 text-zinc-800">
                <span className="text-xl">{R32_TEAMS.find(t => t.code === selected)?.flag}</span>
                <span>{R32_TEAMS.find(t => t.code === selected)?.name ?? selected}</span>
                <span className="text-xs font-mono dark:text-zinc-400 text-zinc-500 font-normal">to win WC 2026</span>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <div className="flex items-center gap-1 dark:bg-zinc-900 bg-white border dark:border-zinc-700 border-zinc-200 rounded-lg px-2 py-1.5">
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={amountOKB}
                    onChange={e => setAmountOKB(e.target.value)}
                    className="w-20 bg-transparent text-xs font-mono dark:text-zinc-100 text-zinc-800 outline-none text-right"
                  />
                  <span className="text-[10px] font-mono dark:text-zinc-500 text-zinc-400">OKB</span>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-mono dark:text-zinc-500 text-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStake}
                  disabled={txPending || !refereeAddress}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all active:scale-95
                    bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {txPending ? (
                    <><Zap size={10} className="animate-pulse" />Confirm in wallet…</>
                  ) : (
                    <>Stake {amountOKB} OKB →</>
                  )}
                </button>
              </div>
              {txError && (
                <p className="w-full text-[11px] text-red-400 font-mono mt-1">{txError}</p>
              )}
            </div>
          )}

          {/* Recent tx confirmation */}
          {txHash && (
            <div className="flex items-center gap-2 text-[11px] font-mono dark:text-emerald-400 text-emerald-600">
              <CheckCircle size={11} />
              <span>Staked! Tx:</span>
              <a
                href={`https://www.okx.com/web3/explorer/xlayer/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline truncate max-w-[240px]"
              >
                {txHash.slice(0, 16)}…
              </a>
              <button onClick={() => setTxHash(null)} className="ml-auto dark:text-zinc-600 text-zinc-400 hover:dark:text-zinc-400 hover:text-zinc-600">✕</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
