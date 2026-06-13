import { GitBranch, Zap } from 'lucide-react';
import type { Fixture, MatchState, Team } from '../types';

interface Props {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  onWatch: (fixtureId: string) => void;
}

const ROUNDS = [
  { key: 'R32', label: 'Round of 32' },
  { key: 'R16', label: 'Last 16' },
  { key: 'QF', label: 'Quarter-Finals' },
  { key: 'SF', label: 'Semi-Finals' },
  { key: '3PL', label: 'Third Place' },
  { key: 'F', label: 'Final' },
] as const;

const PLACEHOLDER_CODES = new Set(['TBD', '1ST', '2ND', '3RD', 'WIN', 'LOS']);
const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

interface Standing {
  team: Team;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
}

interface SlotDisplay {
  team: Team;
  label: string;
  ready: boolean;
  projected: boolean;
}

function rankGroup(fixtures: Fixture[], matchStates: Record<string, MatchState>, group: string): Standing[] {
  const rows = new Map<string, Standing>();
  const ensure = (team: Team) => {
    if (!rows.has(team.code)) {
      rows.set(team.code, { team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
    }
    return rows.get(team.code)!;
  };

  fixtures
    .filter(fixture => !fixture.round && fixture.group === group)
    .forEach(fixture => {
      const home = ensure(fixture.home);
      const away = ensure(fixture.away);
      const state = matchStates[fixture.id];
      if (state?.status !== 'finished') return;
      home.p += 1;
      away.p += 1;
      home.gf += state.homeScore;
      home.ga += state.awayScore;
      away.gf += state.awayScore;
      away.ga += state.homeScore;
      if (state.homeScore > state.awayScore) {
        home.w += 1;
        away.l += 1;
        home.pts += 3;
      } else if (state.awayScore > state.homeScore) {
        away.w += 1;
        home.l += 1;
        away.pts += 3;
      } else {
        home.d += 1;
        away.d += 1;
        home.pts += 1;
        away.pts += 1;
      }
      home.gd = home.gf - home.ga;
      away.gd = away.gf - away.ga;
    });

  return [...rows.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.code.localeCompare(b.team.code));
}

function groupComplete(fixtures: Fixture[], matchStates: Record<string, MatchState>, group: string): boolean {
  const groupFixtures = fixtures.filter(fixture => !fixture.round && fixture.group === group);
  return groupFixtures.length >= 6 && groupFixtures.every(fixture => matchStates[fixture.id]?.status === 'finished');
}

function allGroupsComplete(fixtures: Fixture[], matchStates: Record<string, MatchState>): boolean {
  return GROUPS.every(group => groupComplete(fixtures, matchStates, group));
}

function cleanSeedLabel(team: Team): string {
  const source = team.name || team.code;
  const winnerMatch = source.match(/winner\s+match\s+(\d+)/i);
  if (winnerMatch) return `Winner Match ${winnerMatch[1]}`;
  const loserSemi = source.match(/loser\s+semi[-\s]?final\s+(\d+)/i);
  if (loserSemi) return `Loser SF ${loserSemi[1]}`;
  const winnerSemi = source.match(/winner\s+semi[-\s]?final\s+(\d+)/i);
  if (winnerSemi) return `Winner SF ${winnerSemi[1]}`;
  const winnerQf = source.match(/winner\s+quarter[-\s]?final\s+(\d+)/i);
  if (winnerQf) return `Winner QF ${winnerQf[1]}`;
  const first = source.match(/(?:1st|first|winner)\s+group\s+([A-L])/i);
  if (first) return `Winner Group ${first[1].toUpperCase()}`;
  const second = source.match(/(?:2nd|second|runner[-\s]?up)\s+group\s+([A-L])/i);
  if (second) return `Runner-up Group ${second[1].toUpperCase()}`;
  const third = source.match(/(?:3rd|third)\s+group\s+([A-L](?:\s*\/\s*[A-L])*)/i);
  if (third) return `Best 3rd ${third[1].replace(/\s+/g, '').toUpperCase()}`;
  if (team.code === 'WIN') return 'Winner';
  if (team.code === 'LOS') return 'Loser';
  if (team.code === '1ST') return 'Group winner';
  if (team.code === '2ND') return 'Group runner-up';
  if (team.code === '3RD') return 'Best third-place';
  return 'Awaiting qualifier';
}

function resolveSeed(team: Team, fixtures: Fixture[], matchStates: Record<string, MatchState>): SlotDisplay {
  if (!PLACEHOLDER_CODES.has(team.code)) {
    return { team, label: team.code, ready: true, projected: false };
  }

  const source = team.name || team.code;
  const first = source.match(/(?:1st|first|winner)\s+group\s+([A-L])/i);
  if (first) {
    const group = first[1].toUpperCase();
    if (groupComplete(fixtures, matchStates, group)) {
      const resolved = rankGroup(fixtures, matchStates, group)[0]?.team;
      if (resolved) return { team: resolved, label: resolved.code, ready: true, projected: true };
    }
  }

  const second = source.match(/(?:2nd|second|runner[-\s]?up)\s+group\s+([A-L])/i);
  if (second) {
    const group = second[1].toUpperCase();
    if (groupComplete(fixtures, matchStates, group)) {
      const resolved = rankGroup(fixtures, matchStates, group)[1]?.team;
      if (resolved) return { team: resolved, label: resolved.code, ready: true, projected: true };
    }
  }

  const third = source.match(/(?:3rd|third)\s+group\s+([A-L](?:\s*\/\s*[A-L])*)/i);
  if (third) {
    const groups = third[1].replace(/\s+/g, '').toUpperCase().split('/');
    if (allGroupsComplete(fixtures, matchStates)) {
      const resolved = resolvedBestThirds(fixtures, matchStates).find(row => groups.includes(row.teamGroup));
      if (resolved) return { team: resolved.team, label: resolved.team.code, ready: true, projected: true };
    }
  }

  return { team, label: cleanSeedLabel(team), ready: false, projected: false };
}

function resolvedBestThirds(fixtures: Fixture[], matchStates: Record<string, MatchState>): Array<Standing & { teamGroup: string }> {
  return GROUPS
    .filter(group => groupComplete(fixtures, matchStates, group))
    .map(group => {
      const row = rankGroup(fixtures, matchStates, group)[2];
      return row ? { ...row, teamGroup: group } : null;
    })
    .filter((row): row is Standing & { teamGroup: string } => Boolean(row))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.code.localeCompare(b.team.code))
    .slice(0, 8);
}

function MatchNode({
  fixture,
  fixtures,
  matchStates,
  matchState,
  onWatch,
}: {
  fixture: Fixture;
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  matchState?: MatchState;
  onWatch: () => void;
}) {
  const homeSlot = resolveSeed(fixture.home, fixtures, matchStates);
  const awaySlot = resolveSeed(fixture.away, fixtures, matchStates);
  const isReady = homeSlot.ready && awaySlot.ready;
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
            {homeSlot.ready ? homeSlot.team.code.slice(0, 1) : ''}
          </span>
          <span className="text-xs font-semibold truncate">{homeSlot.label}</span>
        </div>
        <span className="text-sm font-semibold tabular-nums dark:text-zinc-100 text-zinc-900">
          {matchState ? matchState.homeScore : '-'}
        </span>
      </div>
      <div className="my-1 flex items-center gap-2">
        <div className="h-px flex-1 dark:bg-zinc-800 bg-zinc-200" />
        <span className={`text-[9px] font-semibold uppercase tracking-widest ${isLive ? 'text-emerald-400' : 'dark:text-zinc-600 text-zinc-400'}`}>
          {isLive ? `${matchState!.minute}'` : isHalfTime ? 'HT' : isDone ? matchState?.penaltyShootout ? 'PENS' : 'FT' : isReady ? 'Ready' : 'Seeded'}
        </span>
        <div className="h-px flex-1 dark:bg-zinc-800 bg-zinc-200" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className={`flex items-center gap-2 min-w-0 ${awayWin ? 'dark:text-emerald-300 text-emerald-700' : 'dark:text-zinc-200 text-zinc-800'}`}>
          <span className="h-5 w-5 rounded-full border dark:border-zinc-700 border-zinc-300 dark:bg-zinc-900 bg-white grid place-items-center text-[9px] font-semibold">
            {awaySlot.ready ? awaySlot.team.code.slice(0, 1) : ''}
          </span>
          <span className="text-xs font-semibold truncate">{awaySlot.label}</span>
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
  const qualifiedCodes = new Set(
    GROUPS
      .filter(group => groupComplete(fixtures, matchStates, group))
      .flatMap(group => rankGroup(fixtures, matchStates, group).slice(0, 2).map(row => row.team.code))
      .concat(resolvedBestThirds(fixtures, matchStates).map(row => row.team.code))
  );
  const qualifiedCount = qualifiedCodes.size;

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
                  fixtures={fixtures}
                  matchStates={matchStates}
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
