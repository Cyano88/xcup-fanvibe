import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import type { DaemonLog, LogPrefix, LogLevel } from '../types';
import { explorerTx } from '../lib/chain';

interface Props {
  logs: DaemonLog[];
  daemonOnline: boolean;
}

const PREFIX_STYLE: Record<LogPrefix, string> = {
  SYSTEM:     'text-zinc-400 bg-zinc-800',
  RPC:        'text-blue-400 bg-blue-500/10',
  STAKE:      'text-emerald-400 bg-emerald-500/10',
  ORACLE:     'text-zinc-300 bg-zinc-700/60',
  METABOLISM: 'text-zinc-300 bg-zinc-700/60',
};

const LEVEL_TEXT: Record<LogLevel, string> = {
  info:    'dark:text-zinc-300 text-zinc-600',
  warn:    'dark:text-zinc-300 text-zinc-600',
  error:   'dark:text-red-400 text-red-500',
  success: 'dark:text-emerald-300 text-emerald-600',
};

function formatTs(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return ts.slice(11, 19);
  }
}

export function LogStream({ logs, daemonOnline }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div className="card flex flex-col" style={{ minHeight: '260px', maxHeight: '340px' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-zinc-800 border-zinc-200">
        <div className="flex items-center gap-2">
          <Terminal size={13} className="dark:text-zinc-500 text-zinc-400" />
          <span className="text-xs font-semibold dark:text-zinc-400 text-zinc-600 uppercase tracking-widest">Activity Feed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${daemonOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-400'}`} />
          <span className="text-xs font-mono dark:text-zinc-600 text-zinc-400">{logs.length} entries</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {logs.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs dark:text-zinc-700 text-zinc-400">
            {daemonOnline ? 'Waiting for engine events...' : 'Connect market engine to see live activity'}
          </div>
        )}

        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-2 text-xs animate-fade-in group">
            <span className="font-mono dark:text-zinc-700 text-zinc-400 shrink-0 mt-px">{formatTs(log.ts)}</span>
            <span className={`shrink-0 mt-px px-1.5 py-px rounded text-[10px] font-bold font-mono ${PREFIX_STYLE[log.prefix]}`}>
              {log.prefix}
            </span>
            <span className={`flex-1 font-mono leading-5 break-all ${LEVEL_TEXT[log.level]}`}>
              {log.message}
              {log.txHash && (
                <a
                  href={explorerTx(log.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 dark:text-zinc-500 text-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-600 transition-colors"
                  title={log.txHash}
                >
                  [{log.txHash.slice(0, 8)}...] open
                </a>
              )}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}


