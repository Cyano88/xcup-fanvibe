import { useState, useEffect } from 'react';
import { Lock, TrendingUp } from 'lucide-react';
import type { Fixture, Pool, Outcome } from '../types';
import { formatPool, countdown } from '../lib/encode';

interface Props {
  fixture: Fixture;
  pool?: Pool;
  onStake: (fixtureId: string, outcome: Outcome) => void;
}

// Each group gets a distinct gradient for the card header
const GROUP_GRADIENT: Record<string, string> = {
  A: 'from-blue-900/80 to-blue-950',
  B: 'from-emerald-900/80 to-emerald-950',
  C: 'from-violet-900/80 to-violet-950',
  D: 'from-rose-900/80 to-rose-950',
  E: 'from-cyan-900/80 to-cyan-950',
  F: 'from-orange-900/80 to-orange-950',
  G: 'from-indigo-900/80 to-indigo-950',
  H: 'from-amber-900/80 to-amber-950',
};

const GROUP_ACCENT: Record<string, string> = {
  A: 'border-blue-700/40',
  B: 'border-emerald-700/40',
  C: 'border-violet-700/40',
  D: 'border-rose-700/40',
  E: 'border-cyan-700/40',
  F: 'border-orange-700/40',
  G: 'border-indigo-700/40',
  H: 'border-amber-700/40',
};

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

  const gradient = GROUP_GRADIENT[fixture.group] ?? 'from-zinc-800 to-zinc-900';
  const accent   = GROUP_ACCENT[fixture.group]   ?? 'border-zinc-700/40';

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all duration-200 bg-zinc-950
      ${isSettled ? 'opacity-75 border-zinc-800' : `${accent} hover:shadow-xl hover:shadow-black/50`}`}>

      {/* Gradient header — teams live here */}
      <div className={`bg-gradient-to-b ${gradient} px-4 pt-4 pb-5`}>
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] font-mono text-white/50 uppercase tracking-wider">
            Group {fixture.group} · MD{fixture.matchday}
          </span>
          {isSettled ? (
            <span className="text-[10px] font-mono font-semibold text-purple-300 bg-purple-500/20 border border-purple-400/30 px-2 py-0.5 rounded-full">
              SETTLED
            </span>
          ) : isLocked ? (
            <span className="text-[10px] font-mono font-semibold text-amber-300 bg-amber-500/20 border border-amber-400/30 px-2 py-0.5 rounded-full">
              LOCKED
            </span>
          ) : (
            <span className="text-[10px] font-mono font-semibold text-emerald-300 bg-emerald-500/20 border border-emerald-400/30 px-2 py-0.5 rounded-full flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
              OPEN
            </span>
          )}
        </div>

        {/* Teams */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <span className="text-5xl leading-none drop-shadow-lg">{fixture.home.flag}</span>
            <span className="text-base font-bold text-white tracking-wide">{fixture.home.code}</span>
            <span className="text-xs text-white/50">{fixture.home.name}</span>
          </div>

          <div className="flex flex-col items-center gap-1 px-3 shrink-0">
            {isSettled && fixture.result ? (
              <span className="text-sm font-bold text-purple-300 font-mono uppercase">
                {fixture.result === 'draw' ? 'DRAW' : fixture.result === 'home' ? fixture.home.code : fixture.away.code}
              </span>
            ) : (
              <>
                <span className="text-sm font-bold text-white/30 font-mono">VS</span>
                <span className="text-[11px] text-white/40 font-mono">{timeLabel}</span>
              </>
            )}
          </div>

          <div className="flex flex-col items-center gap-1.5 flex-1">
            <span className="text-5xl leading-none drop-shadow-lg">{fixture.away.flag}</span>
            <span className="text-base font-bold text-white tracking-wide">{fixture.away.code}</span>
            <span className="text-xs text-white/50">{fixture.away.name}</span>
          </div>
        </div>
      </div>

      {/* Outcome buttons */}
      <div className="p-3 bg-zinc-950">
        {isLocked ? (
          <div className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-500">
            <Lock size={11} />
            <span className="font-mono">Staking {isSettled ? 'closed' : 'locked'}</span>
            {isSettled && fixture.result && (
              <span className="text-purple-400 font-semibold capitalize ml-1">· {fixture.result}</span>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {/* Home — green */}
            <button
              onClick={() => onStake(fixture.id, 'home')}
              disabled={!isOpen}
              className="flex flex-col items-center gap-1 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-400/60
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] text-emerald-400/70 font-mono font-medium">{fixture.home.code}</span>
              <span className="text-2xl font-bold text-emerald-400 tabular-nums leading-none">
                {Math.round(fmt.homeShare)}%
              </span>
              <span className="text-[9px] text-emerald-900 font-mono">{hasPool ? `${fmt.homeOKB} OKB` : 'Stake →'}</span>
            </button>

            {/* Draw — neutral */}
            <button
              onClick={() => onStake(fixture.id, 'draw')}
              disabled={!isOpen}
              className="flex flex-col items-center gap-1 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                bg-zinc-800/60 border-zinc-600/40 hover:bg-zinc-700/60 hover:border-zinc-500/60
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] text-zinc-400 font-mono font-medium">Draw</span>
              <span className="text-2xl font-bold text-zinc-200 tabular-nums leading-none">
                {Math.round(fmt.drawShare)}%
              </span>
              <span className="text-[9px] text-zinc-700 font-mono">{hasPool ? `${fmt.drawOKB} OKB` : 'Stake →'}</span>
            </button>

            {/* Away — amber */}
            <button
              onClick={() => onStake(fixture.id, 'away')}
              disabled={!isOpen}
              className="flex flex-col items-center gap-1 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-400/60
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] text-amber-400/70 font-mono font-medium">{fixture.away.code}</span>
              <span className="text-2xl font-bold text-amber-400 tabular-nums leading-none">
                {Math.round(fmt.awayShare)}%
              </span>
              <span className="text-[9px] text-amber-900 font-mono">{hasPool ? `${fmt.awayOKB} OKB` : 'Stake →'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 pb-3 -mt-1">
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
