import { useState, useCallback } from 'react';
import { X, Wallet, ExternalLink, AlertCircle, Check } from 'lucide-react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import type { Fixture, Outcome } from '../types';
import { encodeStakeCalldata } from '../lib/encode';
import { CHAIN_ID_HEX, X_LAYER_RPC_URLS, explorerTx } from '../lib/chain';
import { useOkbUsdPrice } from '../lib/useOkbUsdPrice';
import { PrivyStakeButton } from './PrivyStakeButton';
import { PrivyWalletStakeButton } from './PrivyWalletStakeButton';
import { PrivyBalanceHint } from './PrivyBalanceHint';
import {
  cleanStakeUsdInput,
  minStakeMessage,
  normalizedStakeUsd,
  STAKE_MIN_USD,
  usdToOkbAmount,
} from '../lib/stakeMinimum';
import { isEmbeddedPrivyWallet, preferredFanVibeWallet } from '../lib/privyWallets';

interface Props {
  fixture: Fixture;
  defaultOutcome: Outcome;
  refereeAddress: string;
  onClose: () => void;
  onStakeClosed?: (fixtureId: string, reason?: string) => void;
}

type Step = 'configure' | 'pending' | 'confirmed' | 'error';

const PRIVY_ENABLED = Boolean(import.meta.env.VITE_PRIVY_APP_ID);

const OUTCOME_LABEL: Record<Outcome, string> = {
  home: 'Home Win',
  draw: 'Draw',
  away: 'Away Win',
};

const OUTCOME_COLOR: Record<Outcome, string> = {
  home: 'border-emerald-400/60 bg-emerald-500/14 text-emerald-100',
  draw: 'border-zinc-300/50 bg-white/10 text-white',
  away: 'border-blue-400/60 bg-blue-500/14 text-blue-100',
};

function PrimaryStakeAction({
  amountOKB,
  amountUsd,
  calldata,
  refereeAddress,
  disabled,
  onBeforeStake,
  onSuccess,
  onError,
}: {
  amountOKB: string;
  amountUsd: string;
  calldata: `0x${string}`;
  refereeAddress: string;
  disabled?: boolean;
  onBeforeStake: () => Promise<boolean>;
  onSuccess: (hash: `0x${string}`) => void;
  onError: (message: string) => void;
}) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const activeWallet = preferredFanVibeWallet(wallets);
  const externalWallet = activeWallet && !isEmbeddedPrivyWallet(activeWallet.walletClientType) ? activeWallet : null;
  const className = 'inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50';
  const label = authenticated || externalWallet ? `Stake $${amountUsd || STAKE_MIN_USD}` : 'Sign in to stake';

  if (externalWallet) {
    return (
      <PrivyWalletStakeButton
        amountOKB={amountOKB}
        calldata={calldata}
        refereeAddress={refereeAddress}
        disabled={disabled}
        pendingLabel="Confirm in wallet..."
        onBeforeStake={onBeforeStake}
        onSuccess={(hash) => onSuccess(hash)}
        onError={onError}
        className={className}
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
      onBeforeStake={onBeforeStake}
      onSuccess={(hash) => onSuccess(hash)}
      onError={onError}
      className={className}
    >
      {label}
    </PrivyStakeButton>
  );
}

export function StakeModal({ fixture, defaultOutcome, refereeAddress, onClose, onStakeClosed }: Props) {
  const [outcome, setOutcome] = useState<Outcome>(defaultOutcome);
  const [amountUsd, setAmountUsd] = useState(String(STAKE_MIN_USD));
  const [step, setStep] = useState<Step>('configure');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const okbUsd = useOkbUsdPrice();
  const minStakeMsg = minStakeMessage(okbUsd);
  const amount = usdToOkbAmount(amountUsd, okbUsd);
  const amountUsdNumber = Number(amountUsd);
  const amountValid = Number.isFinite(amountUsdNumber) && amountUsdNumber >= STAKE_MIN_USD && Number(amount) > 0;
  const okbEquivalentLabel = amount ? `${amount} OKB` : 'OKB quote loading';

  const handleStake = useCallback(async () => {
    if (!amountValid) {
      setError(minStakeMsg);
      setStep('error');
      return;
    }
    const provider = (window as typeof window & { ethereum?: unknown }).ethereum as
      | {
          request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
        }
      | undefined;

    if (!provider) {
      setError('No Web3 wallet detected. Install MetaMask or OKX Wallet to stake.');
      setStep('error');
      return;
    }

    try {
      setStep('pending');
      setError(null);

      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts.length) throw new Error('No accounts returned');

      // Switch to X Layer Mainnet
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: CHAIN_ID_HEX }],
        });
      } catch (switchErr: unknown) {
        const err = switchErr as { code?: number };
        if (err.code === 4902) {
          // Add X Layer Mainnet
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: CHAIN_ID_HEX,
              chainName: 'X Layer Mainnet',
              nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
              rpcUrls: [...X_LAYER_RPC_URLS],
              blockExplorerUrls: ['https://www.okx.com/web3/explorer/xlayer'],
            }],
          });
        } else {
          throw switchErr;
        }
      }

      const calldata = encodeStakeCalldata(fixture.id, outcome);
      const amountFloat = parseFloat(amount);
      if (isNaN(amountFloat) || amountFloat <= 0) throw new Error('Invalid stake amount');

      const statusRes = await fetch(`${import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001'}/stake/status/${fixture.id}`);
      if (statusRes.ok) {
        const status = await statusRes.json() as { canStake?: boolean; reason?: string };
        if (!status.canStake) {
          onStakeClosed?.(fixture.id, status.reason);
          onClose();
          return;
        }
      }

      const amountWei = BigInt(Math.floor(amountFloat * 1e18)).toString(16);

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from:    accounts[0],
          to:      refereeAddress,
          value:   `0x${amountWei}`,
          data:    calldata,
          chainId: CHAIN_ID_HEX,
        }],
      }) as string;

      setTxHash(hash);
      setStep('confirmed');

      // Report TX to daemon for immediate indexing (don't block UI)
      fetch(`${import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001'}/stake/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: hash }),
      }).catch(() => {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('User rejected') ? 'Transaction rejected by wallet.' : msg);
      setStep('error');
    }
  }, [fixture.id, outcome, amount, amountValid, refereeAddress, onClose, onStakeClosed]);

  const checkStakeOpen = useCallback(async () => {
    if (!amountValid) {
      setError(minStakeMsg);
      return false;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1800);
    try {
      const statusRes = await fetch(`${import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001'}/stake/status/${fixture.id}`, {
        signal: controller.signal,
      });
      if (statusRes.ok) {
        const status = await statusRes.json() as { canStake?: boolean; reason?: string };
        if (!status.canStake) {
          onStakeClosed?.(fixture.id, status.reason);
          onClose();
          return false;
        }
      }
    } catch {
      return true;
    } finally {
      window.clearTimeout(timer);
    }
    return true;
  }, [amountValid, fixture.id, onClose, onStakeClosed]);

  const handlePrivySuccess = useCallback((hash: `0x${string}`) => {
    setTxHash(hash);
    setStep('confirmed');
    fetch(`${import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001'}/stake/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash: hash }),
    }).catch(() => {});
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative z-10 w-full max-w-sm overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 bg-cover bg-center shadow-2xl animate-slide-in"
        style={{ backgroundImage: "url('/assets/stake-modal-bg.jpeg')" }}
      >
        <div className="absolute inset-0 bg-zinc-950/90" />
        <div className="absolute inset-0 bg-gradient-to-b from-blue-950/18 via-black/28 to-zinc-950/70" />
        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/10">
          <div>
            <div className="text-sm font-semibold text-white">Place Stake</div>
            <div className="text-xs font-medium text-zinc-300 mt-0.5">
              {fixture.home.flag} {fixture.home.code} vs {fixture.away.flag} {fixture.away.code}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="relative p-5 space-y-4">
          {step === 'configure' && (
            <>
              {/* Outcome selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-200">Predict</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['home', 'draw', 'away'] as Outcome[]).map((o) => (
                    <button
                      key={o}
                      onClick={() => setOutcome(o)}
                      className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all duration-150 ${
                        outcome === o ? OUTCOME_COLOR[o] : 'border-white/10 bg-zinc-950/72 text-zinc-300 hover:border-white/20 hover:bg-zinc-900/84'
                      }`}
                    >
                      <div>{o === 'home' ? fixture.home.flag : o === 'away' ? fixture.away.flag : '-'}</div>
                      <div className="mt-0.5">{OUTCOME_LABEL[o]}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-200">Stake Amount (USD)</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-zinc-300 shrink-0">$</span>
                  <input
                    type="number"
                    value={amountUsd}
                    onChange={(e) => {
                      const next = cleanStakeUsdInput(e.target.value);
                      if (next !== null) setAmountUsd(next);
                    }}
                    onBlur={() => setAmountUsd(current => normalizedStakeUsd(current) || String(STAKE_MIN_USD))}
                    min={STAKE_MIN_USD}
                    step="1"
                    inputMode="decimal"
                    className="flex-1 bg-zinc-950/78 border border-white/10 rounded-lg px-3 py-2 text-sm font-semibold text-white
                      focus:outline-none transition-colors"
                  />
                  <span className="text-xs font-semibold text-zinc-300 shrink-0">USD</span>
                </div>
                <div className="flex gap-2">
                  {['1', '5', '10', '25'].map((v) => (
                    <button key={v} onClick={() => setAmountUsd(v)}
                      className="text-xs px-2 py-1 rounded border border-white/10 bg-zinc-950/70 text-zinc-300 hover:text-white hover:bg-white/10 transition-colors">
                      ${v}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] font-medium text-zinc-500">
                  Equivalent: {okbEquivalentLabel} on X Layer
                </div>
                {PRIVY_ENABLED && <PrivyBalanceHint amountOKB={amount} />}
                {!amountValid && (
                  <div className="text-[11px] font-medium text-zinc-500">
                    {minStakeMsg}
                  </div>
                )}
              </div>

              {/* Protocol fee note */}
              <p className="text-xs font-medium text-zinc-300">0.5% protocol fee. Payouts are sent automatically after settlement.</p>

              {PRIVY_ENABLED ? (
                <PrimaryStakeAction
                  amountOKB={amount}
                  amountUsd={normalizedStakeUsd(amountUsd) || String(STAKE_MIN_USD)}
                  calldata={encodeStakeCalldata(fixture.id, outcome)}
                  refereeAddress={refereeAddress}
                  disabled={!amountValid}
                  onBeforeStake={checkStakeOpen}
                  onSuccess={handlePrivySuccess}
                  onError={(message) => {
                    setError(message || null);
                    if (message) setStep('error');
                  }}
                />
              ) : (
                <button onClick={handleStake} disabled={!amountValid} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
                  <Wallet size={14} />
                  Stake via Wallet
                </button>
              )}
            </>
          )}

          {step === 'pending' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <div className="text-center text-sm font-semibold text-zinc-300">Confirm in wallet...</div>
              <div className="text-center text-xs text-zinc-500">Sending ${amountUsd} ({okbEquivalentLabel}) on X Layer Mainnet</div>
            </div>
          )}

          {step === 'confirmed' && txHash && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-emerald-400">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20">
                  <Check size={12} />
                </div>
                <span className="text-sm font-medium">Stake confirmed</span>
              </div>
              <div className="text-xs text-zinc-500">
                Your stake of <span className="text-zinc-300">${amountUsd} ({okbEquivalentLabel})</span> on{' '}
                <span className="text-zinc-300">{OUTCOME_LABEL[outcome]}</span> is live on-chain.
              </div>
              <a
                href={explorerTx(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
              >
                <ExternalLink size={12} />
                <span>{txHash.slice(0, 16)}...</span>
                View on OKX Explorer
              </a>
              <button onClick={onClose} className="btn-primary w-full mt-1">Done</button>
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-red-400">
                <AlertCircle size={16} />
                <span className="text-sm font-medium">Stake failed</span>
              </div>
              <p className="text-xs text-zinc-500">{error}</p>
              <button onClick={() => setStep('configure')} className="btn-primary w-full">Try Again</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
