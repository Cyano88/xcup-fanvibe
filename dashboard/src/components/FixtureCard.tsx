import { useState, useEffect, useCallback } from 'react';
import { AlarmClock, Lock, MonitorPlay, TrendingUp, Zap } from 'lucide-react';
import type { Fixture, Pool, Outcome, MatchState } from '../types';
import { formatPool, countdown } from '../lib/encode';

interface Props {
  fixture: Fixture;
  pool?: Pool;
  matchState?: MatchState;
  seasonPhase?: 'preseason' | 'playing' | 'champion' | 'interseason';
  seasonTimer?: number;
  seasonKickoffDelayMs?: number;
  seasonStartedAt?: number;
  seasonFixtureStartsAt?: number | null;
  onStake: (fixtureId: string, outcome: Outcome) => void;
  onWatch: (fixtureId: string) => void;
}

const FLAG_URL = (iso: string) =>
  iso === 'un' || iso === 'tbd' ? '' : `https://flagcdn.com/w640/${iso.toLowerCase()}.png`;

const ROUND_LABEL: Record<string, string> = {
  R32: 'Knockout',
  R16: 'Round of 16',
  QF:  'Quarter-Final',
  SF:  'Semi-Final',
  '3PL': '3rd Place',
  F:   'Final',
};

function TBDCard({ fixture }: { fixture: Fixture }) {
  return (
    <div className="rounded-lg overflow-hidden border dark:border-zinc-800/40 border-zinc-200/60 dark:bg-zinc-950 bg-white opacity-55">
      <div className="h-44 relative dark:bg-zinc-900 bg-zinc-100 overflow-hidden">
        <div
          className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/6 dark:via-white/4 to-transparent"
          style={{ animation: 'shimmer 2.4s ease-in-out infinite' }}
        />
        <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-3.5">
          <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest">
            {fixture.round ? (ROUND_LABEL[fixture.round] ?? fixture.round) : 'Upcoming'}
          </span>
          <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 bg-zinc-200/60 dark:bg-zinc-800/60 border border-zinc-300/50 dark:border-zinc-700/40 px-2 py-0.5 rounded-full">
            UPCOMING
          </span>
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 select-none">
          <div className="flex items-center gap-5">
            <div className="h-14 w-14 rounded-full border dark:border-zinc-700 border-zinc-300 dark:bg-zinc-800 bg-zinc-200 grid place-items-center">
              <span className="text-sm font-bold dark:text-zinc-600 text-zinc-400">TBD</span>
            </div>
            <span className="text-xs font-mono dark:text-zinc-700 text-zinc-400">vs</span>
            <div className="h-14 w-14 rounded-full border dark:border-zinc-700 border-zinc-300 dark:bg-zinc-800 bg-zinc-200 grid place-items-center">
              <span className="text-sm font-bold dark:text-zinc-600 text-zinc-400">TBD</span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-600">Awaiting group qualifiers</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t dark:from-zinc-900 from-zinc-100 to-transparent" />
      </div>
      <div className="p-3 dark:bg-zinc-950 bg-white">
        <div className="h-11 rounded-xl dark:bg-zinc-900/80 bg-zinc-100 border dark:border-zinc-800 border-zinc-200 animate-pulse" />
      </div>
      <div className="px-4 pb-3 dark:bg-zinc-950 bg-white">
        <div className="h-2.5 w-2/5 rounded dark:bg-zinc-900 bg-zinc-100 animate-pulse" />
      </div>
    </div>
  );
}

function formatShortDuration(totalSeconds: number): string {
  const secs = Math.max(0, totalSeconds);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function FixtureCard({
  fixture,
  pool,
  matchState,
  seasonPhase,
  seasonTimer = 0,
  seasonKickoffDelayMs = 0,
  seasonStartedAt,
  seasonFixtureStartsAt,
  onStake,
  onWatch,
}: Props) {
  if (fixture.home.code === 'TBD' && fixture.away.code === 'TBD') {
    return <TBDCard fixture={fixture} />;
  }

  const [showHome, setShowHome]   = useState(true);
  const [hovered, setHovered]     = useState(false);
  const [tick, setTick]           = useState(0);
  const isSeasonPlay = fixture.mode === 'simulated';
  const isLiveMatch = matchState?.status === 'live' || matchState?.status === 'half_time';
  const isFinishedMatch = matchState?.status === 'finished';
  const canStream = isLiveMatch || isFinishedMatch;

  // Countdown refresh
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), isSeasonPlay ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [isSeasonPlay]);
  void tick;

  // Auto-flip flag every 3 s (pauses on hover)
  useEffect(() => {
    if (hovered || isLiveMatch) return;
    const t = setInterval(() => setShowHome((h) => !h), 3000);
    return () => clearInterval(t);
  }, [hovered, isLiveMatch]);

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
  const seasonFixtureStartsIn = seasonPhase === 'preseason'
    ? seasonTimer + Math.ceil(seasonKickoffDelayMs / 1000)
    : seasonPhase === 'playing'
      ? seasonFixtureStartsAt === null
        ? Number.POSITIVE_INFINITY
        : Math.ceil(((seasonFixtureStartsAt ?? seasonStartedAt ?? Date.now()) - Date.now()) / 1000)
      : 0;
  const timeLabel = isSeasonPlay
    ? !Number.isFinite(seasonFixtureStartsIn)
      ? 'Awaiting MD'
      : seasonFixtureStartsIn > 0
      ? formatShortDuration(seasonFixtureStartsIn)
      : seasonPhase === 'playing'
        ? 'Starting'
        : 'Awaiting'
    : countdown(fixture.kickoff);

  // Use live pool shares when stakes exist, otherwise baseOdds
  const homeOdds = hasPool ? Math.round(fmt.homeShare) : fixture.baseOdds.home;
  const drawOdds = hasPool ? Math.round(fmt.drawShare)  : fixture.baseOdds.draw;
  const awayOdds = hasPool ? Math.round(fmt.awayShare)  : fixture.baseOdds.away;

  const kickoffStr = isSeasonPlay ? (!Number.isFinite(seasonFixtureStartsIn) ? 'after previous MD' : seasonFixtureStartsIn > 0 ? 'until window' : 'season clock') : new Date(fixture.kickoff).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  return (
    <div
      className={`rounded-lg overflow-hidden shadow-sm transition-all duration-300 border
        dark:bg-zinc-950 bg-white
        ${isSettled
          ? 'opacity-70 dark:border-zinc-800 border-zinc-200'
          : 'dark:border-zinc-800/60 border-zinc-200 hover:shadow-2xl hover:-translate-y-0.5 hover:dark:border-zinc-700 hover:border-zinc-300'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* â”€â”€ Flag hero â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
        <div
          className={`absolute inset-0 transition-colors duration-500 ${
            isLiveMatch
              ? 'bg-gradient-to-b from-black/70 via-black/75 to-black/90'
              : 'bg-gradient-to-b from-black/30 via-black/40 to-black/75'
          }`}
        />

        {/* Top bar */}
        <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-3.5">
          <span className="text-[11px] font-mono text-white/60 uppercase tracking-widest">
            {fixture.round
              ? `${ROUND_LABEL[fixture.round] ?? 'Knockout'}  - Match ${fixture.matchday}`
              : `Group ${fixture.group}  - MD${fixture.matchday}`}
          </span>
          {matchState?.status === 'live' ? (
            <span className="text-[10px] font-mono font-bold text-emerald-200 bg-emerald-500/25 border border-emerald-300/40 px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
              LIVE
            </span>
          ) : matchState?.status === 'half_time' ? (
            <span className="text-[10px] font-mono font-bold text-zinc-100 bg-zinc-900/55 border border-white/15 px-2 py-0.5 rounded-full backdrop-blur-sm">
              HALF TIME
            </span>
          ) : matchState?.status === 'finished' ? (
            <span className="text-[10px] font-mono font-bold text-zinc-100 bg-zinc-900/55 border border-white/15 px-2 py-0.5 rounded-full backdrop-blur-sm">
              FT
            </span>
          ) : isSettled ? (
            <span className="text-[10px] font-mono font-bold text-zinc-100 bg-zinc-900/55 border border-white/15 px-2 py-0.5 rounded-full backdrop-blur-sm">
              SETTLED
            </span>
          ) : isLocked ? (
            <span className="text-[10px] font-mono font-bold text-zinc-100 bg-zinc-900/55 border border-white/15 px-2 py-0.5 rounded-full backdrop-blur-sm">
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

          {/* Centre - live score / time / result */}
          <div className={`flex flex-col items-center gap-0.5 pb-1 rounded-lg px-3 py-2 transition-colors duration-300 ${
            isLiveMatch ? 'bg-black/45 border border-white/10 backdrop-blur-sm shadow-2xl' : ''
          }`}>
            {matchState?.status === 'live' ? (
              <>
                <div className="flex items-center gap-2 text-white font-black text-2xl tabular-nums drop-shadow-lg">
                  <span>{matchState.homeScore}</span>
                  <span className="text-white/40 text-lg">-</span>
                  <span>{matchState.awayScore}</span>
                </div>
                <span className="text-[10px] text-emerald-300 font-mono font-bold flex items-center gap-1">
                  <Zap size={9} className="animate-pulse" />{matchState.minute}'
                </span>
              </>
            ) : matchState?.status === 'half_time' ? (
              <>
                <div className="flex items-center gap-2 text-white font-black text-2xl tabular-nums drop-shadow-lg">
                  <span>{matchState.homeScore}</span>
                  <span className="text-white/40 text-lg">-</span>
                  <span>{matchState.awayScore}</span>
                </div>
                <span className="text-[10px] text-zinc-200 font-mono font-bold">HT</span>
              </>
            ) : matchState?.status === 'finished' ? (
              <>
                <div className="flex items-center gap-2 text-white font-black text-2xl tabular-nums drop-shadow-lg">
                  <span>{matchState.homeScore}</span>
                  <span className="text-white/40 text-lg">-</span>
                  <span>{matchState.awayScore}</span>
                </div>
                <span className="text-[10px] text-zinc-200 font-mono font-bold">FT</span>
              </>
            ) : isSettled && fixture.result ? (
              <span className="text-sm font-bold text-zinc-100 font-mono uppercase tracking-widest">
                {fixture.result === 'draw' ? 'DRAW' : fixture.result === 'home' ? fixture.home.code : fixture.away.code}
              </span>
            ) : (
              <>
                <span className="text-xs font-bold text-white/40 font-mono tracking-widest">VS</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/24 px-2 py-0.5 text-[13px] text-white font-mono font-semibold tabular-nums ring-1 ring-white/10 backdrop-blur-sm">
                  <AlarmClock size={12} strokeWidth={1.65} className="text-white/75" />
                  {timeLabel}
                </span>
                <span className="text-[10px] text-white/55 font-mono">{kickoffStr}</span>
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

      {/* â”€â”€ Outcome buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="p-3 dark:bg-zinc-950 bg-white">
        {isLocked || canStream ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl dark:bg-zinc-900 bg-zinc-100 border dark:border-zinc-800 border-zinc-200 text-xs dark:text-zinc-500 text-zinc-400">
              <Lock size={11} />
              <span className="font-mono">
                {isLiveMatch ? 'Match live' : isFinishedMatch ? 'Match ended' : `Staking ${isSettled ? 'closed' : 'locked'}`}
              </span>
              {isSettled && fixture.result && (
                <span className="dark:text-zinc-300 text-zinc-600 font-semibold capitalize ml-1"> - {fixture.result}</span>
              )}
            </div>
            {canStream && (
              <button
                onClick={() => onWatch(fixture.id)}
                className="flex items-center gap-1.5 px-3 py-3 rounded-lg text-xs font-semibold transition-all
                  dark:bg-zinc-100 dark:text-zinc-950 bg-zinc-900 text-white
                  dark:hover:bg-white hover:bg-zinc-800 active:scale-95"
              >
                <MonitorPlay size={12} />
                {isFinishedMatch ? 'Replay' : 'Stream'}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {/* Home */}
            <button
              onClick={() => onStake(fixture.id, 'home')}
              onMouseEnter={() => flipTo('home')}
              disabled={!isOpen}
              className="group/btn flex flex-col items-center gap-1 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                dark:bg-emerald-500/8 bg-emerald-50 dark:border-emerald-500/20 border-emerald-200
                dark:hover:bg-emerald-500/18 hover:bg-emerald-100 dark:hover:border-emerald-400/50 hover:border-emerald-400
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[11px] dark:text-emerald-400 text-emerald-700 font-mono font-semibold">{fixture.home.code}</span>
              <span className="text-lg font-black dark:text-emerald-300 text-emerald-700 tabular-nums leading-none">
                {homeOdds}%
              </span>
              <span className="text-[10px] dark:text-emerald-600 text-emerald-500 font-mono font-medium">
                {hasPool ? `${fmt.homeOKB}` : 'Stake ->'}
              </span>
            </button>

            {/* Draw */}
            <button
              onClick={() => onStake(fixture.id, 'draw')}
              disabled={!isOpen}
              className="group/btn flex flex-col items-center gap-1 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                dark:bg-zinc-800/50 bg-zinc-100 dark:border-zinc-700/50 border-zinc-200
                dark:hover:bg-zinc-700/60 hover:bg-zinc-200 dark:hover:border-zinc-500 hover:border-zinc-400
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[11px] dark:text-zinc-400 text-zinc-600 font-mono font-semibold">Draw</span>
              <span className="text-lg font-black dark:text-zinc-100 text-zinc-800 tabular-nums leading-none">
                {drawOdds}%
              </span>
              <span className="text-[10px] dark:text-zinc-500 text-zinc-500 font-mono font-medium">
                {hasPool ? `${fmt.drawOKB}` : 'Stake ->'}
              </span>
            </button>

            {/* Away */}
            <button
              onClick={() => onStake(fixture.id, 'away')}
              onMouseEnter={() => flipTo('away')}
              disabled={!isOpen}
              className="group/btn flex flex-col items-center gap-1 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                dark:bg-blue-500/8 bg-blue-50 dark:border-blue-500/20 border-blue-200
                dark:hover:bg-blue-500/14 hover:bg-blue-100 dark:hover:border-blue-400/45 hover:border-blue-300
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-[11px] dark:text-blue-300 text-blue-700 font-mono font-semibold">{fixture.away.code}</span>
              <span className="text-lg font-black dark:text-blue-200 text-blue-700 tabular-nums leading-none">
                {awayOdds}%
              </span>
              <span className="text-[10px] dark:text-blue-500 text-blue-600 font-mono font-medium">
                {hasPool ? `${fmt.awayOKB}` : 'Stake ->'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* â”€â”€ Footer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex items-center justify-between px-4 pb-3 dark:bg-zinc-950 bg-white">
        <div className="flex items-center gap-1.5 text-[11px] dark:text-zinc-500 text-zinc-500 font-mono font-medium">
          <TrendingUp size={10} />
          <span>
            {hasPool
              ? `${fmt.totalOKB} OKB  - ${p.count} stake${p.count !== 1 ? 's' : ''}`
              : 'No stakes yet'}
          </span>
        </div>
        <span className="text-[11px] dark:text-zinc-500 text-zinc-500 font-mono truncate max-w-[160px]">
          {fixture.stadium
            ? `${fixture.stadium.city.split(',')[0]}  - ${fixture.stadium.capacity.toLocaleString()}`
            : fixture.venue.split(' -')[0].trim()}
        </span>
      </div>
    </div>
  );
}


