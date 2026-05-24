import { useState, useCallback } from 'react';
import { X, Wallet, ExternalLink, AlertCircle } from 'lucide-react';
import type { Fixture, Outcome } from '../types';
import { encodeStakeCalldata } from '../lib/encode';
import { CHAIN_ID_HEX, explorerTx } from '../lib/chain';

interface Props {
  fixture: Fixture;
  defaultOutcome: Outcome;
  refereeAddress: string;
  onClose: () => void;
}

type Step = 'configure' | 'pending' | 'confirmed' | 'error';

const OUTCOME_LABEL: Record<Outcome, string> = {
  home: 'Home Win',
  draw: 'Draw',
  away: 'Away Win',
};

const OUTCOME_COLOR: Record<Outcome, string> = {
  home: 'border-emerald-500/50 bg-emerald-500/5 text-emerald-400',
  draw: 'border-zinc-500/50 bg-zinc-500/5 text-zinc-400',
  away: 'border-amber-500/50 bg-amber-500/5 text-amber-400',
};

export function StakeModal({ fixture, defaultOutcome, refereeAddress, onClose }: Props) {
  const [outcome, setOutcome] = useState<Outcome>(defaultOutcome);
  const [amount, setAmount] = useState('0.01');
  const [step, setStep] = useState<Step>('configure');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStake = useCallback(async () => {
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
              rpcUrls: ['https://rpc.xlayer.tech'],
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('User rejected') ? 'Transaction rejected by wallet.' : msg);
      setStep('error');
    }
  }, [fixture.id, outcome, amount, refereeAddress]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-800">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Place Stake</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {fixture.home.flag} {fixture.home.code} vs {fixture.away.flag} {fixture.away.code}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === 'configure' && (
            <>
              {/* Outcome selector */}
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-500">Predict</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['home', 'draw', 'away'] as Outcome[]).map((o) => (
                    <button
                      key={o}
                      onClick={() => setOutcome(o)}
                      className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all duration-150 ${
                        outcome === o ? OUTCOME_COLOR[o] : 'border-zinc-700 text-zinc-500 hover:border-zinc-600'
                      }`}
                    >
                      <div>{o === 'home' ? fixture.home.flag : o === 'away' ? fixture.away.flag : '🤝'}</div>
                      <div className="mt-0.5">{OUTCOME_LABEL[o]}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-500">Stake Amount (OKB)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="0.001"
                    step="0.01"
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100
                      focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                  <span className="text-xs text-zinc-500 font-mono shrink-0">OKB</span>
                </div>
                <div className="flex gap-2">
                  {['0.01', '0.05', '0.1', '0.5'].map((v) => (
                    <button key={v} onClick={() => setAmount(v)}
                      className="text-xs font-mono px-2 py-1 rounded bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors">
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Protocol fee note */}
              <p className="text-xs text-zinc-700">0.5% protocol fee · Payouts sent autonomously on settlement</p>

              <button onClick={handleStake} className="btn-primary w-full">
                <Wallet size={14} />
                Stake via Wallet
              </button>
            </>
          )}

          {step === 'pending' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <div className="text-sm text-zinc-400 text-center">Confirm in wallet…</div>
              <div className="text-xs text-zinc-600">Sending {amount} OKB on X Layer Mainnet</div>
            </div>
          )}

          {step === 'confirmed' && txHash && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-emerald-400">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">✓</div>
                <span className="text-sm font-medium">Stake confirmed!</span>
              </div>
              <div className="text-xs text-zinc-500">
                Your stake of <span className="text-zinc-300 font-mono">{amount} OKB</span> on{' '}
                <span className="text-zinc-300">{OUTCOME_LABEL[outcome]}</span> is live on-chain.
              </div>
              <a
                href={explorerTx(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
              >
                <ExternalLink size={12} />
                <span className="font-mono">{txHash.slice(0, 16)}…</span>
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
