import type { MatchState, Fixture } from '../types';

interface Row { player: string; team: string; flag: string; goals: number; assists: number; }

interface Props {
  matchStates: Record<string, MatchState>;
  fixtures: Fixture[];
}

export function Leaderboard({ matchStates, fixtures }: Props) {
  // Build lookup: fixtureId → fixture
  const fxMap = Object.fromEntries(fixtures.map(f => [f.id, f]));

  // Aggregate goals + assists across all match events
  const stats = new Map<string, Row>();

  const ensure = (player: string, team: string, flag: string) => {
    if (!stats.has(player)) stats.set(player, { player, team, flag, goals: 0, assists: 0 });
    return stats.get(player)!;
  };

  for (const [id, ms] of Object.entries(matchStates)) {
    const fx = fxMap[id];
    if (!fx) continue;
    for (const ev of ms.events) {
      if (ev.type !== 'goal_home' && ev.type !== 'goal_away') continue;
      const isHome = ev.team === 'home';
      const team = isHome ? fx.home.code : fx.away.code;
      const flag = isHome ? fx.home.flag : fx.away.flag;
      if (ev.player) ensure(ev.player, team, flag).goals++;
      if (ev.player2) ensure(ev.player2, team, flag).assists++;
    }
  }

  const sorted = [...stats.values()]
    .filter(r => r.goals > 0 || r.assists > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists)
    .slice(0, 10);

  if (sorted.length === 0) return null;

  return (
    <div className="dark:bg-zinc-950 bg-white border dark:border-zinc-800 border-zinc-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b dark:border-zinc-800 border-zinc-200">
        <span className="text-xs font-bold dark:text-zinc-400 text-zinc-500 uppercase tracking-widest">
          ⚽ Top Scorers
        </span>
      </div>
      <div className="divide-y dark:divide-zinc-800/60 divide-zinc-100">
        {sorted.map((row, i) => (
          <div key={row.player} className="flex items-center gap-3 px-5 py-2.5">
            <span className="text-[11px] dark:text-zinc-600 text-zinc-400 w-4 tabular-nums">{i + 1}</span>
            <span className="text-lg">{row.flag}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold dark:text-zinc-100 text-zinc-900 truncate">{row.player}</div>
              <div className="text-[10px] dark:text-zinc-500 text-zinc-500">{row.team}</div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-center">
                <div className="text-lg font-black tabular-nums dark:text-emerald-400 text-emerald-600 leading-none">{row.goals}</div>
                <div className="text-[9px] dark:text-zinc-600 text-zinc-400 uppercase">goals</div>
              </div>
              {row.assists > 0 && (
                <div className="text-center">
                  <div className="text-lg font-black tabular-nums dark:text-zinc-300 text-zinc-700 leading-none">{row.assists}</div>
                  <div className="text-[9px] dark:text-zinc-600 text-zinc-400 uppercase">ast</div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
