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
  ORACLE:     'text-purple-400 bg-purple-500/10',
  METABOLISM: 'text-amber-400 bg-amber-500/10',
};

const LEVEL_TEXT: Record<LogLevel, string> = {
  info:    'text-zinc-300',
  warn:    'text-amber-300',
  error:   'text-red-400',
  success: 'text-emerald-300',
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Terminal size={13} className="text-zinc-500" />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Daemon Log</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${daemonOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
          <span className="text-xs font-mono text-zinc-600">{logs.length} entries</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {logs.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-zinc-700">
            {daemonOnline ? 'Waiting for daemon events…' : 'Connect daemon to see live logs'}
          </div>
        )}

        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-2 text-xs animate-fade-in group">
            <span className="font-mono text-zinc-700 shrink-0 mt-px">{formatTs(log.ts)}</span>
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
                  className="ml-2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  title={log.txHash}
                >
                  [{log.txHash.slice(0, 8)}…] ↗
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
