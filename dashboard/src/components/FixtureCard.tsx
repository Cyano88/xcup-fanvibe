import { useState, useEffect } from 'react';
import { Clock, Lock } from 'lucide-react';
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
  const isLocked   = fixture.status === 'locked' || fixture.status === 'settled';
  const isSettled  = fixture.status === 'settled';
  const isOpen     = fixture.status === 'open';
  const timeLabel  = countdown(fixture.kickoff);
  const kickoffStr = new Date(fixture.kickoff).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';

  const statusPill = isSettled
    ? <span className="badge-live text-purple-400 bg-purple-500/10 border-purple-500/20">SETTLED</span>
    : isLocked
    ? <span className="badge-warn">LOCKED</span>
    : <span className="badge-live">OPEN</span>;

  const outcomeLabel: Record<Outcome, string> = {
    home: fixture.home.code,
    draw: 'Draw',
    away: fixture.away.code,
  };

  return (
    <div className={`card p-4 space-y-3 transition-all duration-200 ${isSettled ? 'opacity-70' : 'hover:border-zinc-700'}`}>
      {/* Match header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span>Group {fixture.group}</span>
          <span>·</span>
          <span>MD{fixture.matchday}</span>
        </div>
        {statusPill}
      </div>

      {/* Teams */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 text-center">
          <div className="text-2xl leading-none">{fixture.home.flag}</div>
          <div className="mt-1 text-sm font-semibold text-zinc-100 dark:text-zinc-100">{fixture.home.name}</div>
          <div className="text-xs text-zinc-500 font-mono">{fixture.home.code}</div>
        </div>

        <div className="flex flex-col items-center gap-1 px-3">
          {isSettled && fixture.result ? (
            <div className="text-xs font-mono font-bold text-purple-400 uppercase">
              {fixture.result === 'draw' ? 'DRAW' : outcomeLabel[fixture.result]}
            </div>
          ) : (
            <div className="text-xs text-zinc-600 font-mono">vs</div>
          )}
          <div className="flex items-center gap-1 text-zinc-600">
            <Clock size={10} />
            <span className="text-xs font-mono">{timeLabel}</span>
          </div>
        </div>

        <div className="flex-1 text-center">
          <div className="text-2xl leading-none">{fixture.away.flag}</div>
          <div className="mt-1 text-sm font-semibold text-zinc-100 dark:text-zinc-100">{fixture.away.name}</div>
          <div className="text-xs text-zinc-500 font-mono">{fixture.away.code}</div>
        </div>
      </div>

      {/* Pool bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-zinc-600">
          <span>{fmt.totalOKB} OKB pool</span>
          <span>{p.count} stake{p.count !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
          <div className="bg-emerald-500/70 transition-all duration-500" style={{ width: `${fmt.homeShare}%` }} />
          <div className="bg-zinc-500/50 transition-all duration-500" style={{ width: `${fmt.drawShare}%` }} />
          <div className="bg-amber-500/70 transition-all duration-500" style={{ width: `${fmt.awayShare}%` }} />
        </div>
        <div className="flex justify-between text-xs font-mono text-zinc-600">
          <span className="text-emerald-600">{fmt.homeOKB}</span>
          <span>{fmt.drawOKB}</span>
          <span className="text-amber-600">{fmt.awayOKB}</span>
        </div>
      </div>

      {/* Stake buttons */}
      {isLocked ? (
        <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-zinc-600">
          <Lock size={11} />
          <span>Staking {isSettled ? 'closed' : 'locked'}</span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {(['home', 'draw', 'away'] as Outcome[]).map((o) => (
            <button
              key={o}
              disabled={!isOpen}
              onClick={() => onStake(fixture.id, o)}
              className="py-1.5 px-2 rounded-lg text-xs font-medium border transition-all duration-150 active:scale-95
                border-zinc-700 text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-400 hover:bg-emerald-500/5
                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-700 disabled:hover:text-zinc-400 disabled:hover:bg-transparent"
            >
              {outcomeLabel[o]}
            </button>
          ))}
        </div>
      )}

      {/* Venue */}
      <div className="text-xs text-zinc-600 text-center truncate">{kickoffStr} · {fixture.venue}</div>
    </div>
  );
}
