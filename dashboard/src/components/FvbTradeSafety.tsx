import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { FANVIBE_TOKEN_ADDRESS, FANVIBE_TOKEN_URL } from '../lib/fanvibeToken';

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

interface Props {
  compact?: boolean;
  showTradeLink?: boolean;
  className?: string;
}

export function FvbTradeSafety({ compact = false, showTradeLink = false, className = '' }: Props) {
  const [copied, setCopied] = useState(false);
  const displayUrl = 'web3.okx.com/token/x-layer';

  const copyContract = () => {
    navigator.clipboard?.writeText(FANVIBE_TOKEN_ADDRESS).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };

  return (
    <div className={`rounded-lg border border-zinc-950/10 bg-white/95 px-3 py-2 text-zinc-950 shadow-sm ring-1 ring-white/40 dark:border-white/10 dark:bg-zinc-950/80 dark:text-zinc-100 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] leading-4">
        <span className="font-bold">Only trade $FVB through OKX Wallet / OKX DEX on X Layer.</span>
        <span className="rounded-md border border-zinc-950/10 bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-700 dark:border-white/10 dark:bg-white/10 dark:text-zinc-300">
          CA {shortAddress(FANVIBE_TOKEN_ADDRESS)}
        </span>
        {showTradeLink && (
          <a
            href={FANVIBE_TOKEN_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => navigator.clipboard?.writeText(FANVIBE_TOKEN_ADDRESS).catch(() => {})}
            className="inline-flex max-w-[150px] items-center gap-1 rounded-md border border-zinc-950/10 bg-zinc-100 px-2 py-0.5 font-bold text-zinc-800 transition-colors hover:bg-zinc-200 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/15 sm:max-w-[190px]"
            title={FANVIBE_TOKEN_URL}
          >
            <span>Open OKX</span>
            <span className="min-w-0 truncate font-mono text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">{displayUrl}</span>
            <ExternalLink size={10} className="shrink-0" />
          </a>
        )}
        <button
          type="button"
          onClick={copyContract}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-950/10 bg-zinc-950 px-2 py-0.5 font-bold text-white transition-colors hover:bg-zinc-800 dark:border-white/10 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {!compact && (
        <div className="mt-1 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
          Unofficial links, third-party listings, or other swap routes are not endorsed by FanVibe.
        </div>
      )}
    </div>
  );
}
