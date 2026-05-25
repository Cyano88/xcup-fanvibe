import { useEffect, useState } from 'react';
import { CheckCircle, ExternalLink, Minus, X } from 'lucide-react';
import type { SettlementResult } from '../types';
import { formatOKB } from '../lib/encode';

interface Props {
  settlement: SettlementResult;
  onDismiss: () => void;
}

export function SettlementToast({ settlement, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, 12_000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const totalOKB = formatOKB(settlement.totalPool);

  return (
    <div
      className="fixed bottom-5 right-5 z-50 w-80 transition-all duration-300 ease-out"
      style={{
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)',
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
        {/* Accent bar */}
        <div className="h-0.5 bg-emerald-500" />

        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-emerald-400 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-zinc-100">Match Settled</div>
                <div className="text-xs text-zinc-500 font-mono">{settlement.fixtureId}</div>
              </div>
            </div>
            <button onClick={onDismiss} className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors shrink-0">
              <X size={14} />
            </button>
          </div>

          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-800/60 text-sm">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-zinc-900 text-zinc-400 ring-1 ring-zinc-700"><Minus size={13} /></span>
            <div>
              <div className="text-zinc-100 font-medium capitalize">{settlement.outcome} wins</div>
              <div className="text-xs text-zinc-500">
                {settlement.winnerCount} winner{settlement.winnerCount !== 1 ? 's' : ''}  - {totalOKB} OKB distributed
              </div>
            </div>
          </div>

          {settlement.payouts.length > 0 && (
            <a
              href={settlement.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
            >
              <ExternalLink size={11} />
              <span className="font-mono">{settlement.payouts[0].txHash.slice(0, 18)}...</span>
              Verify on-chain open
            </a>
          )}
        </div>
      </div>
    </div>
  );
}



