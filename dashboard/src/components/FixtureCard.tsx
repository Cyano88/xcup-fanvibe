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
  const hasPool   = fmt.totalOKB !== '0.0000';

  const kickoffStr = new Date(fixture.kickoff).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';

  return (
    <div className={`rounded-2xl border bg-zinc-950 overflow-hidden transition-all duration-200
      ${isSettled ? 'border-zinc-800 opacity-75' : 'border-zinc-800/80 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/40'}`}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-[11px] font-mono text-zinc-600 uppercase tracking-wider">
          Group {fixture.group} · MD{fixture.matchday}
        </span>
        {isSettled ? (
          <span className="text-[10px] font-mono font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
            SETTLED
          </span>
        ) : isLocked ? (
          <span className="text-[10px] font-mono font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
            LOCKED
          </span>
        ) : (
          <span className="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            OPEN
          </span>
        )}
      </div>

      {/* Teams — large flags as hero */}
      <div className="flex items-center justify-between px-5 pb-4 pt-1">
        {/* Home */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-5xl leading-none">{fixture.home.flag}</span>
          <span className="text-sm font-bold text-white tracking-wide mt-1">{fixture.home.code}</span>
          <span className="text-[11px] text-zinc-500">{fixture.home.name}</span>
        </div>

        {/* VS / result */}
        <div className="flex flex-col items-center gap-1 px-2 shrink-0">
          {isSettled && fixture.result ? (
            <span className="text-sm font-bold text-purple-400 font-mono uppercase">
              {fixture.result === 'draw' ? 'DRAW' : fixture.result === 'home' ? fixture.home.code : fixture.away.code}
            </span>
          ) : (
            <>
              <span className="text-xs font-bold text-zinc-600">VS</span>
              <span className="text-[10px] text-zinc-700 font-mono">{timeLabel}</span>
              <span className="text-[10px] text-zinc-800 font-mono">{kickoffStr.split(',')[0]}</span>
            </>
          )}
        </div>

        {/* Away */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-5xl leading-none">{fixture.away.flag}</span>
          <span className="text-sm font-bold text-white tracking-wide mt-1">{fixture.away.code}</span>
          <span className="text-[11px] text-zinc-500">{fixture.away.name}</span>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-zinc-900 mx-4" />

      {/* Outcome buttons */}
      <div className="p-3">
        {isLocked ? (
          <div className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-600">
            <Lock size={11} />
            <span className="font-mono">Staking {isSettled ? 'closed' : 'locked'}</span>
            {isSettled && fixture.result && (
              <span className="text-purple-400 font-semibold capitalize ml-1">· {fixture.result}</span>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => onStake(fixture.id, 'home')}
              disabled={!isOpen}
              className="flex flex-col items-center gap-0.5 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/12 hover:border-emerald-500/50
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] text-zinc-500 font-mono">{fixture.home.code}</span>
              <span className="text-[22px] font-bold text-emerald-400 tabular-nums leading-tight">
                {Math.round(fmt.homeShare)}%
              </span>
              <span className="text-[9px] text-zinc-700 font-mono">{hasPool ? `${fmt.homeOKB} OKB` : 'Stake'}</span>
            </button>

            <button
              onClick={() => onStake(fixture.id, 'draw')}
              disabled={!isOpen}
              className="flex flex-col items-center gap-0.5 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                bg-zinc-800/40 border-zinc-700/60 hover:bg-zinc-700/40 hover:border-zinc-500/60
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] text-zinc-500 font-mono">Draw</span>
              <span className="text-[22px] font-bold text-zinc-300 tabular-nums leading-tight">
                {Math.round(fmt.drawShare)}%
              </span>
              <span className="text-[9px] text-zinc-700 font-mono">{hasPool ? `${fmt.drawOKB} OKB` : 'Stake'}</span>
            </button>

            <button
              onClick={() => onStake(fixture.id, 'away')}
              disabled={!isOpen}
              className="flex flex-col items-center gap-0.5 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/12 hover:border-amber-500/50
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] text-zinc-500 font-mono">{fixture.away.code}</span>
              <span className="text-[22px] font-bold text-amber-400 tabular-nums leading-tight">
                {Math.round(fmt.awayShare)}%
              </span>
              <span className="text-[9px] text-zinc-700 font-mono">{hasPool ? `${fmt.awayOKB} OKB` : 'Stake'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 pb-3">
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-700 font-mono">
          <TrendingUp size={9} />
          <span>{hasPool ? `${fmt.totalOKB} OKB · ${p.count} stake${p.count !== 1 ? 's' : ''}` : 'No stakes yet'}</span>
        </div>
        <span className="text-[10px] text-zinc-800 font-mono truncate max-w-[130px]">
          {fixture.venue.split('·')[0].trim()}
        </span>
      </div>
    </div>
  );
}
