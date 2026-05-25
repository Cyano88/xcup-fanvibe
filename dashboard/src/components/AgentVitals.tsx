import { useState, useCallback } from 'react';
import { Copy, CheckCheck, ExternalLink, Zap, Activity } from 'lucide-react';
import { FuelBar } from './FuelBar';
import type { MetabolicState } from '../types';
import { explorerAddr } from '../lib/chain';
import { shortAddr } from '../lib/encode';

interface Props {
  refereeAddress: string;
  metabolism: MetabolicState;
  lastBlock: number;
  wsConnected: boolean;
  daemonOnline: boolean;
}

export function AgentVitals({ refereeAddress, metabolism, lastBlock, wsConnected, daemonOnline }: Props) {
  const [copied, setCopied] = useState(false);

  const copyAddr = useCallback(() => {
    navigator.clipboard.writeText(refereeAddress).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [refereeAddress]);

  const sinceCheck = metabolism.checkedAt
    ? Math.round((Date.now() - metabolism.checkedAt) / 1000)
    : null;

  return (
    <div className="card dark:bg-zinc-900/80 p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-emerald-400" />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Referee Agent</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${daemonOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
          <span className={`text-xs ${daemonOnline ? 'text-emerald-400' : 'text-zinc-600'}`}>
            {daemonOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Wallet address capsule */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 dark:bg-zinc-800/50 border border-zinc-700/50">
        <span className=" text-xs text-zinc-300 flex-1 truncate">
          {refereeAddress || '0x0000...0000'}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={copyAddr}
            className="p-1 rounded text-zinc-500 hover:text-zinc-200 transition-colors"
            title="Copy address"
          >
            {copied ? <CheckCheck size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>
          {refereeAddress && (
            <a
              href={explorerAddr(refereeAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded text-zinc-500 hover:text-zinc-200 transition-colors"
              title="View on OKX Explorer"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>

      {/* Fuel bar */}
      <FuelBar
        percent={metabolism.healthPercent}
        okbFormatted={metabolism.okbBalanceFormatted}
        isRefuelNeeded={metabolism.isRefuelNeeded}
      />

      {/* Metabolism status */}
      <div className="space-y-2 pt-1 border-t border-zinc-800">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-zinc-500">
            <Zap size={11} />
            O2 Metabolism
          </span>
          <span className={` font-medium ${metabolism.isRefuelNeeded ? 'text-blue-400' : 'text-emerald-400'}`}>
            {metabolism.isRefuelNeeded ? 'REFUELING' : 'Active - 60s'}
          </span>
        </div>

        {sinceCheck !== null && (
          <div className="flex justify-between text-xs text-zinc-600">
            <span>Last check</span>
            <span>{sinceCheck}s ago</span>
          </div>
        )}

        {metabolism.lastTxHash && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-600">Last refuel</span>
            <a
              href={`https://www.okx.com/web3/explorer/xlayer/tx/${metabolism.lastTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className=" text-emerald-500 hover:text-emerald-400 transition-colors"
            >
              {shortAddr(metabolism.lastTxHash)} open
            </a>
          </div>
        )}
      </div>

      {/* Chain info */}
      <div className="pt-1 border-t border-zinc-800 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-zinc-600">Network</div>
          <div className="text-zinc-300 font-medium mt-0.5">X Layer Mainnet</div>
        </div>
        <div>
          <div className="text-zinc-600">Latest Block</div>
          <div className=" text-zinc-300 mt-0.5 flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            {lastBlock > 0 ? `#${lastBlock.toLocaleString()}` : '--'}
          </div>
        </div>
        <div>
          <div className="text-zinc-600">Chain ID</div>
          <div className=" text-zinc-300 mt-0.5">196</div>
        </div>
        <div>
          <div className="text-zinc-600">Protocol Fee</div>
          <div className=" text-zinc-300 mt-0.5">0.5%</div>
        </div>
      </div>
    </div>
  );
}


