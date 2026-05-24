import { useState, useEffect, useCallback } from 'react';
import { Lock, TrendingUp } from 'lucide-react';
import type { Fixture, Pool, Outcome } from '../types';
import { formatPool, countdown } from '../lib/encode';

interface Props {
  fixture: Fixture;
  pool?: Pool;
  onStake: (fixtureId: string, outcome: Outcome) => void;
}

const FLAG_URL = (iso: string) =>
  `https://flagcdn.com/w640/${iso.toLowerCase()}.png`;

export function FixtureCard({ fixture, pool, onStake }: Props) {
  const [showHome, setShowHome]   = useState(true);
  const [hovered, setHovered]     = useState(false);
  const [tick, setTick]           = useState(0);

  // Countdown refresh
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  void tick;

  // Auto-flip flag every 3 s (pauses on hover)
  useEffect(() => {
    if (hovered) return;
    const t = setInterval(() => setShowHome((h) => !h), 3000);
    return () => clearInterval(t);
  }, [hovered]);

  const flipTo = useCallback((side: 'home' | 'away') => {
    setShowHome(side === 'home');
    setHovered(true);
  }, []);

  const p   = pool ?? { fixtureId: fixture.id, home: '0', draw: '0', away: '0', fees: '0', count: 0 };
  const fmt = formatPool(p);
  const hasPool   = fmt.totalOKB !== '0.0000';
  const isSettled = fixture.status === 'settled';
  const isLocked  = fixture.status === 'locked' || isSettled;
  const isOpen    = fixture.status === 'open';
  const timeLabel = countdown(fixture.kickoff);

  // Use live pool shares when stakes exist, otherwise baseOdds
  const homeOdds = hasPool ? Math.round(fmt.homeShare) : fixture.baseOdds.home;
  const drawOdds = hasPool ? Math.round(fmt.drawShare)  : fixture.baseOdds.draw;
  const awayOdds = hasPool ? Math.round(fmt.awayShare)  : fixture.baseOdds.away;

  const kickoffStr = new Date(fixture.kickoff).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  return (
    <div
      className={`rounded-2xl overflow-hidden shadow-lg transition-all duration-300 border
        dark:bg-zinc-950 bg-white
        ${isSettled
          ? 'opacity-70 dark:border-zinc-800 border-zinc-200'
          : 'dark:border-zinc-800/60 border-zinc-200 hover:shadow-2xl hover:-translate-y-0.5 hover:dark:border-zinc-700 hover:border-zinc-300'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Flag hero ───────────────────────────────────────────────── */}
      <div className="relative h-44 overflow-hidden select-none">

        {/* Home flag layer */}
        <div
          className="absolute inset-0 transition-opacity duration-1000 ease-in-out bg-center bg-cover"
          style={{ backgroundImage: `url(${FLAG_URL(fixture.home.iso)})`, opacity: showHome ? 1 : 0 }}
        />
        {/* Away flag layer */}
        <div
          className="absolute inset-0 transition-opacity duration-1000 ease-in-out bg-center bg-cover"
          style={{ backgroundImage: `url(${FLAG_URL(fixture.away.iso)})`, opacity: showHome ? 0 : 1 }}
        />
        {/* Gradient scrim for readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/75" />

        {/* Top bar */}
        <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-3.5">
          <span className="text-[11px] font-mono text-white/60 uppercase tracking-widest">
            Group {fixture.group} · MD{fixture.matchday}
          </span>
          {isSettled ? (
            <span className="text-[10px] font-mono font-bold text-purple-300 bg-purple-500/25 border border-purple-400/40 px-2 py-0.5 rounded-full backdrop-blur-sm">
              SETTLED
            </span>
          ) : isLocked ? (
            <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-500/25 border border-amber-400/40 px-2 py-0.5 rounded-full backdrop-blur-sm">
              LOCKED
            </span>
          ) : (
            <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-400/30 px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              OPEN
            </span>
          )}
        </div>

        {/* Teams row */}
        <div className="absolute bottom-9 inset-x-0 flex items-end justify-between px-5">
          {/* Home team */}
          <button
            className="flex flex-col items-center gap-1 group/home"
            onClick={() => flipTo('home')}
            title={`View ${fixture.home.name} flag`}
          >
            <span className={`text-5xl drop-shadow-xl transition-transform duration-200 ${showHome ? 'scale-110' : 'scale-90 opacity-70'} group-hover/home:scale-110`}>
              {fixture.home.flag}
            </span>
            <span className={`text-sm font-bold tracking-wider drop-shadow transition-colors ${showHome ? 'text-white' : 'text-white/60'}`}>
              {fixture.home.code}
            </span>
          </button>

          {/* Centre — time / result */}
          <div className="flex flex-col items-center gap-0.5 pb-1">
            {isSettled && fixture.result ? (
              <span className="text-sm font-bold text-purple-300 font-mono uppercase tracking-widest">
                {fixture.result === 'draw'
                  ? 'DRAW'
                  : fixture.result === 'home' ? fixture.home.code : fixture.away.code}
              </span>
            ) : (
              <>
                <span className="text-xs font-bold text-white/30 font-mono">VS</span>
                <span className="text-[10px] text-white/50 font-mono">{timeLabel}</span>
                <span className="text-[9px] text-white/30 font-mono">{kickoffStr}</span>
              </>
            )}
          </div>

          {/* Away team */}
          <button
            className="flex flex-col items-center gap-1 group/away"
            onClick={() => flipTo('away')}
            title={`View ${fixture.away.name} flag`}
          >
            <span className={`text-5xl drop-shadow-xl transition-transform duration-200 ${!showHome ? 'scale-110' : 'scale-90 opacity-70'} group-hover/away:scale-110`}>
              {fixture.away.flag}
            </span>
            <span className={`text-sm font-bold tracking-wider drop-shadow transition-colors ${!showHome ? 'text-white' : 'text-white/60'}`}>
              {fixture.away.code}
            </span>
          </button>
        </div>

        {/* Flip indicator dots */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
          <button
            onClick={() => flipTo('home')}
            className={`transition-all duration-300 rounded-full ${showHome ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/30 hover:bg-white/50'}`}
          />
          <button
            onClick={() => flipTo('away')}
            className={`transition-all duration-300 rounded-full ${!showHome ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/30 hover:bg-white/50'}`}
          />
        </div>
      </div>

      {/* ── Outcome buttons ──────────────────────────────────────────── */}
      <div className="p-3 dark:bg-zinc-950 bg-white">
        {isLocked ? (
          <div className="flex items-center justify-center gap-2 py-3 rounded-xl dark:bg-zinc-900 bg-zinc-100 border dark:border-zinc-800 border-zinc-200 text-xs dark:text-zinc-500 text-zinc-400">
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
              onMouseEnter={() => flipTo('home')}
              disabled={!isOpen}
              className="group/btn flex flex-col items-center gap-0.5 py-2.5 px-1 rounded-xl border transition-all duration-150 active:scale-95
                dark:bg-emerald-500/8 bg-emerald-50 dark:border-emerald-500/20 border-emerald-200
                dark:hover:bg-emerald-500/18 hover:bg-emerald-100 dark:hover:border-emerald-400/50 hover:border-emerald-400
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] dark:text-emerald-500/70 text-emerald-600 font-mono font-medium">{fixture.home.code}</span>
              <span className="text-base font-bold dark:text-emerald-400 text-emerald-600 tabular-nums">
                {homeOdds}%
              </span>
              <span className="text-[9px] dark:text-emerald-900 text-emerald-400 font-mono">
                {hasPool ? `${fmt.homeOKB} OKB` : 'Stake →'}
              </span>
            </button>

            {/* Draw */}
            <button
              onClick={() => onStake(fixture.id, 'draw')}
              disabled={!isOpen}
              className="group/btn flex flex-col items-center gap-0.5 py-2.5 px-1 rounded-xl border transition-all duration-150 active:scale-95
                dark:bg-zinc-800/50 bg-zinc-50 dark:border-zinc-700/50 border-zinc-200
                dark:hover:bg-zinc-700/60 hover:bg-zinc-100 dark:hover:border-zinc-500 hover:border-zinc-400
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] dark:text-zinc-400 text-zinc-500 font-mono font-medium">Draw</span>
              <span className="text-base font-bold dark:text-zinc-200 text-zinc-700 tabular-nums">
                {drawOdds}%
              </span>
              <span className="text-[9px] dark:text-zinc-700 text-zinc-400 font-mono">
                {hasPool ? `${fmt.drawOKB} OKB` : 'Stake →'}
              </span>
            </button>

            {/* Away */}
            <button
              onClick={() => onStake(fixture.id, 'away')}
              onMouseEnter={() => flipTo('away')}
              disabled={!isOpen}
              className="group/btn flex flex-col items-center gap-0.5 py-2.5 px-1 rounded-xl border transition-all duration-150 active:scale-95
                dark:bg-amber-500/8 bg-amber-50 dark:border-amber-500/20 border-amber-200
                dark:hover:bg-amber-500/18 hover:bg-amber-100 dark:hover:border-amber-400/50 hover:border-amber-400
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[10px] dark:text-amber-500/70 text-amber-600 font-mono font-medium">{fixture.away.code}</span>
              <span className="text-base font-bold dark:text-amber-400 text-amber-600 tabular-nums">
                {awayOdds}%
              </span>
              <span className="text-[9px] dark:text-amber-900 text-amber-500 font-mono">
                {hasPool ? `${fmt.awayOKB} OKB` : 'Stake →'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pb-3 dark:bg-zinc-950 bg-white">
        <div className="flex items-center gap-1.5 text-[10px] dark:text-zinc-700 text-zinc-400 font-mono">
          <TrendingUp size={9} />
          <span>
            {hasPool
              ? `${fmt.totalOKB} OKB · ${p.count} stake${p.count !== 1 ? 's' : ''}`
              : 'Pre-match odds · No stakes yet'}
          </span>
        </div>
        <span className="text-[10px] dark:text-zinc-800 text-zinc-300 font-mono truncate max-w-[120px]">
          {fixture.venue.split('·')[0].trim()}
        </span>
      </div>
    </div>
  );
}
