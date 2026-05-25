import type { Fixture, MatchState } from '../types';

interface TeamRow {
  code: string;
  name: string;
  flag: string;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

interface Props {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  selectedGroup?: string;
}

const flagUrl = (iso: string) =>
  iso === 'un' || iso === 'tbd' ? '' : `https://flagcdn.com/w80/${iso.toLowerCase()}.png`;

function TeamFlag({ iso, fallback }: { iso?: string; fallback: string }) {
  const src = iso ? flagUrl(iso) : '';
  if (!src) return <span className="text-sm leading-none">{fallback}</span>;
  return (
    <span className="inline-flex h-3.5 w-5 overflow-hidden rounded-[2px] bg-zinc-200 dark:bg-zinc-800 ring-1 ring-black/10 dark:ring-white/10">
      <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
    </span>
  );
}

function buildGroup(
  groupFixtures: Fixture[],
  matchStates: Record<string, MatchState>,
): TeamRow[] {
  const rows = new Map<string, TeamRow>();

  const ensure = (team: Fixture['home']): TeamRow => {
    if (!rows.has(team.code)) {
      rows.set(team.code, { code: team.code, name: team.name, flag: team.flag, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
    }
    return rows.get(team.code)!;
  };

  for (const fx of groupFixtures) {
    const ms = matchStates[fx.id];
    ensure(fx.home);
    ensure(fx.away);
    if (!ms || ms.status !== 'finished') continue;

    const h = ensure(fx.home);
    const a = ensure(fx.away);
    h.p++; a.p++;
    h.gf += ms.homeScore; h.ga += ms.awayScore;
    a.gf += ms.awayScore; a.ga += ms.homeScore;

    if (ms.homeScore > ms.awayScore) {
      h.w++; h.pts += 3; a.l++;
    } else if (ms.awayScore > ms.homeScore) {
      a.w++; a.pts += 3; h.l++;
    } else {
      h.d++; h.pts++; a.d++; a.pts++;
    }
  }

  return [...rows.values()].sort((a, b) =>
    b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf
  );
}

export function GroupTable({ fixtures, matchStates, selectedGroup }: Props) {
  const realtimeFixtures = fixtures.filter(f => f.mode === 'realtime' && (!selectedGroup || f.group === selectedGroup));
  if (realtimeFixtures.length === 0) return null;

  const groups = [...new Set(realtimeFixtures.map(f => f.group))].sort();
  const teamByCode = new Map(realtimeFixtures.flatMap(f => [[f.home.code, f.home], [f.away.code, f.away]]));

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-1 gap-4 ${selectedGroup ? '' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
        {groups.map(group => {
          const groupFixtures = realtimeFixtures.filter(f => f.group === group);
          const rows = buildGroup(groupFixtures, matchStates);

          return (
            <div key={group} className="dark:bg-zinc-900/60 bg-white border dark:border-zinc-800 border-zinc-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b dark:border-zinc-800 border-zinc-100">
                <span className="text-xs font-mono font-bold dark:text-zinc-400 text-zinc-500 uppercase tracking-widest">
                  Group {group}
                </span>
              </div>
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="dark:text-zinc-600 text-zinc-400 border-b dark:border-zinc-800/60 border-zinc-100">
                    <th className="text-left px-3 py-1.5 font-semibold w-5">#</th>
                    <th className="text-left px-1 py-1.5 font-semibold">Team</th>
                    <th className="text-center px-1 py-1.5 font-semibold w-6">P</th>
                    <th className="text-center px-1 py-1.5 font-semibold w-6">W</th>
                    <th className="text-center px-1 py-1.5 font-semibold w-6">D</th>
                    <th className="text-center px-1 py-1.5 font-semibold w-6">L</th>
                    <th className="text-center px-1 py-1.5 font-semibold w-8">GD</th>
                    <th className="text-center px-3 py-1.5 font-semibold w-8 dark:text-zinc-400 text-zinc-600">Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-zinc-800/40 divide-zinc-50">
                  {rows.map((row, i) => {
                    const gd = row.gf - row.ga;
                    const qualified = i < 2 && row.pts > 0;
                    return (
                      <tr key={row.code} className={`transition-colors ${qualified ? 'dark:bg-emerald-500/5 bg-emerald-50/50' : ''}`}>
                        <td className="px-3 py-2 dark:text-zinc-600 text-zinc-400 tabular-nums">{i + 1}</td>
                        <td className="px-1 py-2">
                          <div className="flex items-center gap-1.5">
                            <TeamFlag iso={teamByCode.get(row.code)?.iso} fallback={row.flag} />
                            <span className="dark:text-zinc-200 text-zinc-700 font-bold">{row.code}</span>
                          </div>
                        </td>
                        <td className="text-center px-1 py-2 dark:text-zinc-400 text-zinc-500 tabular-nums">{row.p}</td>
                        <td className="text-center px-1 py-2 dark:text-zinc-400 text-zinc-500 tabular-nums">{row.w}</td>
                        <td className="text-center px-1 py-2 dark:text-zinc-400 text-zinc-500 tabular-nums">{row.d}</td>
                        <td className="text-center px-1 py-2 dark:text-zinc-400 text-zinc-500 tabular-nums">{row.l}</td>
                        <td className="text-center px-1 py-2 dark:text-zinc-500 text-zinc-400 tabular-nums">
                          {gd > 0 ? `+${gd}` : gd === 0 ? '0' : gd}
                        </td>
                        <td className="text-center px-3 py-2 tabular-nums font-bold dark:text-zinc-100 text-zinc-900">{row.pts}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
