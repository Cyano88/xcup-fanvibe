import { GitBranch, Zap } from 'lucide-react';
import type { Fixture, MatchState } from '../types';
import { baseFixtureId } from '../lib/seasonTournament';

interface Props {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  onWatch: (fixtureId: string) => void;
}

const ROUNDS = [
  { key: 'R32', label: 'Qualified 32' },
  { key: 'R16', label: 'Last 16' },
  { key: 'QF', label: 'Quarter-Finals' },
  { key: 'SF', label: 'Semi-Finals' },
  { key: 'F', label: 'Final' },
] as const;

function slotLabel(fixture: Fixture, side: 'home' | 'away') {
  const team = fixture[side];
  if (team.code !== 'TBD') return team.code;
  return side === 'home' ? 'Qualifier' : 'Qualifier';
}

function MatchNode({ fixture, matchState, onWatch }: { fixture: Fixture; matchState?: MatchState; onWatch: () => void }) {
  const isReady = fixture.home.code !== 'TBD' && fixture.away.code !== 'TBD';
  const isLive = matchState?.status === 'live';
  const isHalfTime = matchState?.status === 'half_time';
  const isDone = matchState?.status === 'finished';
  const canOpen = isLive || isHalfTime || isDone;
  const homeWin = isDone && (matchState.penaltyWinner === 'home' || (!matchState.penaltyWinner && matchState.homeScore > matchState.awayScore));
  const awayWin = isDone && (matchState.penaltyWinner === 'away' || (!matchState.penaltyWinner && matchState.awayScore > matchState.homeScore));

  return (
    <button
      onClick={canOpen ? onWatch : undefined}
      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors
        ${canOpen ? 'cursor-pointer active:scale-[0.99]' : 'cursor-default'}
        ${isReady
          ? 'dark:bg-zinc-950 bg-white dark:border-zinc-800 border-zinc-200 dark:hover:border-zinc-700 hover:border-zinc-300'
          : 'dark:bg-zinc-900/45 bg-zinc-100/70 dark:border-zinc-800/70 border-zinc-200 opacity-70'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className={`flex items-center gap-2 min-w-0 ${homeWin ? 'dark:text-emerald-300 text-emerald-700' : 'dark:text-zinc-200 text-zinc-800'}`}>
          <span className="h-5 w-5 rounded-full border dark:border-zinc-700 border-zinc-300 dark:bg-zinc-900 bg-white grid place-items-center text-[9px] font-semibold">
            {fixture.home.code === 'TBD' ? '' : fixture.home.code.slice(0, 1)}
          </span>
          <span className="text-xs font-semibold truncate">{slotLabel(fixture, 'home')}</span>
        </div>
        <span className="text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">
          {matchState ? matchState.homeScore : '-'}
        </span>
      </div>
      <div className="my-1 flex items-center gap-2">
        <div className="h-px flex-1 dark:bg-zinc-800 bg-zinc-200" />
        <span className={`text-[9px] font-semibold uppercase tracking-widest ${isLive ? 'text-emerald-400' : 'dark:text-zinc-600 text-zinc-400'}`}>
          {isLive ? `${matchState!.minute}'` : isHalfTime ? 'HT' : isDone ? matchState?.penaltyShootout ? 'PENS' : 'FT' : isReady ? 'Ready' : 'Pending'}
        </span>
        <div className="h-px flex-1 dark:bg-zinc-800 bg-zinc-200" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className={`flex items-center gap-2 min-w-0 ${awayWin ? 'dark:text-emerald-300 text-emerald-700' : 'dark:text-zinc-200 text-zinc-800'}`}>
          <span className="h-5 w-5 rounded-full border dark:border-zinc-700 border-zinc-300 dark:bg-zinc-900 bg-white grid place-items-center text-[9px] font-semibold">
            {fixture.away.code === 'TBD' ? '' : fixture.away.code.slice(0, 1)}
          </span>
          <span className="text-xs font-semibold truncate">{slotLabel(fixture, 'away')}</span>
        </div>
        <span className="text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">
          {matchState ? matchState.awayScore : '-'}
        </span>
      </div>
    </button>
  );
}

export function BracketView({ fixtures, matchStates, onWatch }: Props) {
  const knockoutFixtures = fixtures.filter(f => !!f.round);
  const liveCount = knockoutFixtures.filter(f => matchStates[f.id]?.status === 'live').length;
  const qualifiedCount = knockoutFixtures.filter(f => baseFixtureId(f.id).startsWith('k32-') && f.home.code !== 'TBD' && f.away.code !== 'TBD').length * 2;

  return (
    <div className="dark:bg-zinc-950 bg-white border dark:border-zinc-900 border-zinc-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b dark:border-zinc-900 border-zinc-100">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="dark:text-zinc-500 text-zinc-500" />
          <div>
            <div className="text-sm font-semibold dark:text-zinc-100 text-zinc-900">Knockout Bracket</div>
            <div className="text-[11px] dark:text-zinc-500 text-zinc-500">
              {qualifiedCount > 0 ? `${qualifiedCount} teams qualified from groups` : 'Bracket unlocks after all group matches finish'}
            </div>
          </div>
        </div>
        {liveCount > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
            <Zap size={11} className="animate-pulse" />
            {liveCount} live
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 p-4">
        {ROUNDS.map(round => {
          const roundFixtures = knockoutFixtures.filter(f => f.round === round.key);
          return (
            <section key={round.key} className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                {round.label}
              </div>
              {roundFixtures.map(fixture => (
                <MatchNode
                  key={fixture.id}
                  fixture={fixture}
                  matchState={matchStates[fixture.id]}
                  onWatch={() => onWatch(fixture.id)}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
