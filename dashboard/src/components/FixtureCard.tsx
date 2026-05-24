import { useState, useEffect } from 'react';
import { Lock, TrendingUp } from 'lucide-react';
import type { Fixture, Pool, Outcome } from '../types';
import { formatPool, countdown } from '../lib/encode';

interface Props {
  fixture: Fixture;
  pool?: Pool;
  onStake: (fixtureId: string, outcome: Outcome) => void;
}

export function FixtureCard({ fixture, pool, onStake }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const p = pool ?? { fixtureId: fixture.id, home: '0', draw: '0', away: '0', fees: '0', count: 0 };
  const fmt = formatPool(p);
  const isSettled = fixture.status === 'settled';
  const isLocked  = fixture.status === 'locked' || isSettled;
  const isOpen    = fixture.status === 'open';
  const timeLabel = countdown(fixture.kickoff);

  const kickoffStr = new Date(fixture.kickoff).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';

  const hasPool = fmt.totalOKB !== '0.0000';

  return (
    <div className={`rounded-2xl border bg-zinc-950 transition-all duration-200 overflow-hidden
      ${isSettled ? 'border-zinc-800 opacity-75' : 'border-zinc-800/80 hover:border-zinc-700'}`}>

      {/* Card top bar */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-0">
        <span className="text-[11px] font-mono text-zinc-600 uppercase tracking-wider">
          Group {fixture.group} · MD{fixture.matchday}
        </span>
        <div className="flex items-center gap-2">
          {isSettled ? (
            <span className="text-[10px] font-mono font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
              SETTLED
            </span>
          ) : isLocked ? (
            <span className="text-[10px] font-mono font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
              LOCKED
            </span>
          ) : (
            <span className="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse inline-block" />
              OPEN
            </span>
          )}
        </div>
      </div>

      {/* Teams row */}
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className="text-3xl shrink-0 leading-none">{fixture.home.flag}</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white leading-tight">{fixture.home.code}</div>
            <div className="text-xs text-zinc-500 truncate">{fixture.home.name}</div>
          </div>
        </div>

        <div className="flex flex-col items-center shrink-0 px-3">
          {isSettled && fixture.result ? (
            <span className="text-xs font-bold text-purple-400 font-mono uppercase">
              {fixture.result === 'draw' ? 'DRAW' : fixture.result === 'home' ? fixture.home.code : fixture.away.code}
            </span>
          ) : (
            <span className="text-[11px] font-mono text-zinc-600">{timeLabel}</span>
          )}
          <span className="text-[10px] text-zinc-700 font-mono mt-0.5">{kickoffStr.split(',')[0]}</span>
        </div>

        <div className="flex items-center gap-2.5 min-w-0 flex-1 justify-end">
          <div className="min-w-0 text-right">
            <div className="text-sm font-bold text-white leading-tight">{fixture.away.code}</div>
            <div className="text-xs text-zinc-500 truncate">{fixture.away.name}</div>
          </div>
          <span className="text-3xl shrink-0 leading-none">{fixture.away.flag}</span>
        </div>
      </div>

      {/* Outcome buttons — Polymarket-style: display + action in one */}
      <div className="px-3 pb-3">
        {isLocked ? (
          <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-600">
            <Lock size={11} />
            <span className="font-mono">Staking {isSettled ? 'closed' : 'locked'}</span>
            {isSettled && fixture.result && (
              <span className="text-purple-400 font-semibold capitalize ml-1">· {fixture.result}</span>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {/* Home */}
            <button
              onClick={() => onStake(fixture.id, 'home')}
              disabled={!isOpen}
              className="group flex flex-col items-center gap-0.5 py-3 px-1.5 rounded-xl border transition-all duration-150 active:scale-95
                bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/12 hover:border-emerald-500/40
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] text-zinc-500 font-mono truncate w-full text-center">{fixture.home.code}</span>
              <span className="text-xl font-bold text-emerald-400 tabular-nums leading-tight">
                {Math.round(fmt.homeShare)}%
              </span>
              <span className="text-[9px] text-zinc-700 font-mono">{hasPool ? fmt.homeOKB : '—'} OKB</span>
            </button>

            {/* Draw */}
            <button
              onClick={() => onStake(fixture.id, 'draw')}
              disabled={!isOpen}
              className="group flex flex-col items-center gap-0.5 py-3 px-1.5 rounded-xl border transition-all duration-150 active:scale-95
                bg-zinc-800/40 border-zinc-700/60 hover:bg-zinc-700/40 hover:border-zinc-600
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] text-zinc-500 font-mono">Draw</span>
              <span className="text-xl font-bold text-zinc-300 tabular-nums leading-tight">
                {Math.round(fmt.drawShare)}%
              </span>
              <span className="text-[9px] text-zinc-700 font-mono">{hasPool ? fmt.drawOKB : '—'} OKB</span>
            </button>

            {/* Away */}
            <button
              onClick={() => onStake(fixture.id, 'away')}
              disabled={!isOpen}
              className="group flex flex-col items-center gap-0.5 py-3 px-1.5 rounded-xl border transition-all duration-150 active:scale-95
                bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/12 hover:border-amber-500/40
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] text-zinc-500 font-mono truncate w-full text-center">{fixture.away.code}</span>
              <span className="text-xl font-bold text-amber-400 tabular-nums leading-tight">
                {Math.round(fmt.awayShare)}%
              </span>
              <span className="text-[9px] text-zinc-700 font-mono">{hasPool ? fmt.awayOKB : '—'} OKB</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 pb-3 pt-0">
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-700 font-mono">
          <TrendingUp size={9} />
          <span>{hasPool ? `${fmt.totalOKB} OKB · ${p.count} stake${p.count !== 1 ? 's' : ''}` : 'No stakes yet'}</span>
        </div>
        <span className="text-[10px] text-zinc-800 font-mono truncate max-w-[120px]">
          {fixture.venue.split('·')[0].trim()}
        </span>
      </div>
    </div>
  );
}
