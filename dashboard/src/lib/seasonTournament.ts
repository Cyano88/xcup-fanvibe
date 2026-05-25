import type { Fixture, MatchState, Outcome, Team, TournamentRound } from '../types';
import { REALTIME_FIXTURES } from '../types';

export const SEASON_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
export const GROUP_STAGE_MATCH_MS = 10 * 60 * 1000;
export const SEASON_PRESTART_SECONDS = 5 * 60;
export const SEASON_INTERMISSION_SECONDS = 5 * 60;
export const SEASON_WAVE_SIZE = 6;
export const SEASON_WAVE_GAP_MS = 75 * 1000;
export const SEASON_MATCHDAY_GAP_MS = 10 * 60 * 1000;

export const TBD_TEAM: Team = {
  name: 'Awaiting qualifier',
  code: 'TBD',
  flag: '',
  iso: 'un',
};

interface Standing {
  team: Team;
  group: string;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
}

const S = (name: string, city: string, country: string, capacity: number) => ({ name, city, country, capacity });

const KNOCKOUT_VENUES = [
  { venue: 'Rose Bowl Stadium · Pasadena', stadium: S('Rose Bowl Stadium', 'Pasadena, CA', 'USA', 88565) },
  { venue: 'MetLife Stadium · East Rutherford', stadium: S('MetLife Stadium', 'East Rutherford, NJ', 'USA', 82500) },
  { venue: 'AT&T Stadium · Arlington', stadium: S('AT&T Stadium', 'Arlington, TX', 'USA', 80000) },
  { venue: 'SoFi Stadium · Inglewood', stadium: S('SoFi Stadium', 'Inglewood, CA', 'USA', 70240) },
  { venue: 'Mercedes-Benz Stadium · Atlanta', stadium: S('Mercedes-Benz Stadium', 'Atlanta, GA', 'USA', 75000) },
  { venue: 'NRG Stadium · Houston', stadium: S('NRG Stadium', 'Houston, TX', 'USA', 72220) },
  { venue: 'Arrowhead Stadium · Kansas City', stadium: S('Arrowhead Stadium', 'Kansas City, MO', 'USA', 76416) },
  { venue: 'Lumen Field · Seattle', stadium: S('Lumen Field', 'Seattle, WA', 'USA', 68740) },
];

function seededRandom(seed: number): () => number {
  let value = Math.max(1, seed | 0);
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const next = [...items];
  const rand = seededRandom(seed);
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function odds(home: Team, away: Team): Fixture['baseOdds'] {
  const h = strength(home.code);
  const a = strength(away.code);
  const diff = h - a;
  const homeOdds = Math.round(Math.max(32, Math.min(76, 48 + diff * 0.6)));
  const drawOdds = Math.round(Math.max(18, Math.min(30, 26 - Math.abs(diff) * 0.08)));
  return { home: homeOdds, draw: drawOdds, away: Math.max(8, 100 - homeOdds - drawOdds) };
}

function strength(code: string): number {
  const map: Record<string, number> = {
    ARG:95, FRA:93, BRA:92, ENG:88, ESP:87, GER:86, POR:85, NED:83,
    BEL:82, ITA:80, CRO:77, URU:77, MAR:75, SEN:74, JPN:73, DEN:73,
    COL:72, MEX:72, SUI:71, CAN:71, USA:70, SRB:70, TUR:69, CIV:69,
    NGA:68, AUS:67, KOR:67, ECU:66, ALG:65, EGY:64, CMR:64, KSA:61,
    SWE:76, NOR:74, AUT:68, CZE:66, SCO:65, GHA:60, PAR:60, TUN:60,
    IRN:61, RSA:57, COD:56, BIH:58, IRQ:52, QAT:52, CPV:48, PAN:48,
    JOR:48, UZB:50, NZL:45, HAI:42, CUW:35,
  };
  return map[code] ?? 65;
}

function groupTeams(group: string): Team[] {
  const teams = new Map<string, Team>();
  REALTIME_FIXTURES
    .filter(f => f.group === group)
    .forEach(f => {
      teams.set(f.home.code, f.home);
      teams.set(f.away.code, f.away);
    });
  return [...teams.values()];
}

function seasonizeFixture(fixture: Fixture, seed: number, idx: number): Fixture {
  const flip = seededRandom(seed + idx * 97)() > 0.5;
  const home = flip ? fixture.away : fixture.home;
  const away = flip ? fixture.home : fixture.away;
  return {
    ...fixture,
    id: `season-${fixture.id}`,
    mode: 'simulated',
    status: 'open',
    home,
    away,
    matchday: fixture.matchday,
    round: undefined,
    baseOdds: odds(home, away),
  };
}

function createThirdMatchday(group: string, seasonSeed: number): Fixture[] {
  const existing = REALTIME_FIXTURES.filter(f => f.group === group);
  const teams = groupTeams(group);
  const played = new Set(existing.map(f => [f.home.code, f.away.code].sort().join('-')));
  const missing: [Team, Team][] = [];

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const key = [teams[i].code, teams[j].code].sort().join('-');
      if (!played.has(key)) missing.push([teams[i], teams[j]]);
    }
  }

  const base = existing[existing.length - 1];
  return seededShuffle(missing.slice(0, 2), seasonSeed + group.charCodeAt(0)).map(([baseHome, baseAway], i) => {
    const flip = seededRandom(seasonSeed + group.charCodeAt(0) * 31 + i)() > 0.5;
    const home = flip ? baseAway : baseHome;
    const away = flip ? baseHome : baseAway;
    const venueInfo = base?.stadium
      ? { venue: base.venue, stadium: base.stadium }
      : KNOCKOUT_VENUES[i % KNOCKOUT_VENUES.length];
    const kickoff = new Date(Date.parse(base?.kickoff ?? '2026-06-27T18:00:00Z') + (7 * 24 * 60 + i * 180) * 60_000).toISOString();
    return {
      id: `season-wc-${group.toLowerCase()}-${5 + i}`,
      matchday: 3,
      group,
      mode: 'simulated',
      home,
      away,
      kickoff,
      ...venueInfo,
      status: 'open',
      baseOdds: odds(home, away),
    };
  });
}

function placeholderFixture(id: string, round: TournamentRound, matchday: number): Fixture {
  const venueInfo = KNOCKOUT_VENUES[(matchday - 1) % KNOCKOUT_VENUES.length];
  const date = new Date(Date.UTC(2026, 5, 29 + matchday, 18 + (matchday % 3) * 3, 0, 0)).toISOString();
  return {
    id,
    matchday,
    group: round,
    round,
    mode: 'simulated',
    home: { ...TBD_TEAM },
    away: { ...TBD_TEAM },
    kickoff: date,
    ...venueInfo,
    status: 'upcoming',
    baseOdds: { home: 50, draw: 25, away: 25 },
  };
}

export function createSeasonFixtures(seasonSeed = 1): Fixture[] {
  const groupStage = SEASON_GROUPS.flatMap((group, groupIndex) => {
    const known = REALTIME_FIXTURES
      .filter(f => f.group === group)
      .map((fixture, idx) => seasonizeFixture(fixture, seasonSeed + groupIndex * 101, idx));
    const matchdayOne = seededShuffle(known.filter(f => f.matchday === 1), seasonSeed + groupIndex * 17);
    const matchdayTwo = seededShuffle(known.filter(f => f.matchday === 2), seasonSeed + groupIndex * 37);
    const matchdayThree = createThirdMatchday(group, seasonSeed + groupIndex * 1009);
    return [...matchdayOne, ...matchdayTwo, ...matchdayThree];
  });

  const knockout = [
    ...Array.from({ length: 16 }, (_, i) => placeholderFixture(`k32-${i + 1}`, 'R32', i + 1)),
    ...Array.from({ length: 8 }, (_, i) => placeholderFixture(`k16-${i + 1}`, 'R16', i + 1)),
    ...Array.from({ length: 4 }, (_, i) => placeholderFixture(`qf-${i + 1}`, 'QF', i + 1)),
    ...Array.from({ length: 2 }, (_, i) => placeholderFixture(`sf-${i + 1}`, 'SF', i + 1)),
    placeholderFixture('3pl-1', '3PL', 1),
    placeholderFixture('f-1', 'F', 1),
  ];

  return [...groupStage, ...knockout];
}

export function isGroupStageFixture(fixture: Fixture): boolean {
  return fixture.mode === 'simulated' && SEASON_GROUPS.includes(fixture.group) && !fixture.round;
}

export function seasonFixtureKickoffDelayMs(fixtures: Fixture[], fixtureId: string): number {
  const fixture = fixtures.find(f => f.id === fixtureId);
  const groupFixtures = fixtures
    .filter(f => isGroupStageFixture(f) && (!fixture || f.matchday === fixture.matchday));
  const index = groupFixtures.findIndex(f => f.id === fixtureId);
  if (index < 0) return 0;
  const matchdayDelay = fixture ? (fixture.matchday - 1) * (GROUP_STAGE_MATCH_MS + SEASON_MATCHDAY_GAP_MS) : 0;
  return matchdayDelay + Math.floor(index / SEASON_WAVE_SIZE) * SEASON_WAVE_GAP_MS;
}

export function seasonFixtureStartAtMs(
  fixtures: Fixture[],
  fixture: Fixture,
  seasonStartedAt: number,
  matchStates: Record<string, MatchState> = {},
): number | null {
  if (!isGroupStageFixture(fixture)) return seasonStartedAt;

  const sameDayFixtures = fixtures.filter(f => isGroupStageFixture(f) && f.matchday === fixture.matchday);
  const waveDelay = Math.floor(Math.max(0, sameDayFixtures.findIndex(f => f.id === fixture.id)) / SEASON_WAVE_SIZE) * SEASON_WAVE_GAP_MS;

  if (fixture.matchday <= 1) return seasonStartedAt + waveDelay;

  const previousMatchdays = fixtures.filter(f => isGroupStageFixture(f) && f.matchday < fixture.matchday);
  if (!previousMatchdays.every(f => matchStates[f.id]?.status === 'finished')) {
    return null;
  }

  const latestPreviousFinish = Math.max(
    ...previousMatchdays.map(f => matchStates[f.id]?.finishedAt ?? seasonStartedAt + seasonFixtureKickoffDelayMs(fixtures, f.id) + GROUP_STAGE_MATCH_MS),
  );
  return latestPreviousFinish + SEASON_MATCHDAY_GAP_MS + waveDelay;
}

export function isSeasonFixtureDue(
  fixtures: Fixture[],
  fixture: Fixture,
  seasonStartedAt: number,
  matchStates: Record<string, MatchState> = {},
  now = Date.now(),
): boolean {
  if (!isGroupStageFixture(fixture)) return true;
  if (fixture.matchday > 1) {
    const previousMatchdays = fixtures.filter(f => isGroupStageFixture(f) && f.matchday < fixture.matchday);
    if (!previousMatchdays.every(f => matchStates[f.id]?.status === 'finished')) return false;
  }
  const startsAt = seasonFixtureStartAtMs(fixtures, fixture, seasonStartedAt, matchStates);
  return startsAt !== null && now >= startsAt;
}

export function currentGroupMatchday(fixtures: Fixture[], matchStates: Record<string, MatchState>): number {
  for (const matchday of [1, 2, 3]) {
    const dayFixtures = fixtures.filter(f => isGroupStageFixture(f) && f.matchday === matchday);
    if (dayFixtures.length && !dayFixtures.every(f => matchStates[f.id]?.status === 'finished')) {
      return matchday;
    }
  }
  return 3;
}

export function standingsForGroup(fixtures: Fixture[], matchStates: Record<string, MatchState>, group: string): Standing[] {
  const rows = new Map<string, Standing>();
  const ensure = (team: Team) => {
    if (!rows.has(team.code)) {
      rows.set(team.code, { team, group, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
    }
    return rows.get(team.code)!;
  };

  fixtures.filter(f => isGroupStageFixture(f) && f.group === group).forEach(f => {
    const home = ensure(f.home);
    const away = ensure(f.away);
    const ms = matchStates[f.id];
    if (ms?.status !== 'finished') return;
    home.p++; away.p++;
    home.gf += ms.homeScore; home.ga += ms.awayScore;
    away.gf += ms.awayScore; away.ga += ms.homeScore;
    if (ms.homeScore > ms.awayScore) {
      home.w++; away.l++; home.pts += 3;
    } else if (ms.awayScore > ms.homeScore) {
      away.w++; home.l++; away.pts += 3;
    } else {
      home.d++; away.d++; home.pts++; away.pts++;
    }
    home.gd = home.gf - home.ga;
    away.gd = away.gf - away.ga;
  });

  return [...rows.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.code.localeCompare(b.team.code));
}

export function allGroupMatchesFinished(fixtures: Fixture[], matchStates: Record<string, MatchState>): boolean {
  const groupFixtures = fixtures.filter(isGroupStageFixture);
  return groupFixtures.length > 0 && groupFixtures.every(f => matchStates[f.id]?.status === 'finished');
}

export function qualifiedTeams(fixtures: Fixture[], matchStates: Record<string, MatchState>): Team[] {
  const ranked = SEASON_GROUPS.map(group => standingsForGroup(fixtures, matchStates, group));
  const topTwo = ranked.flatMap(rows => rows.slice(0, 2).map(row => row.team));
  const thirds = ranked
    .map(rows => rows[2])
    .filter(Boolean)
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
    .slice(0, 8)
    .map(row => row.team);
  return [...topTwo, ...thirds];
}

export function seedRoundOf32(fixtures: Fixture[], matchStates: Record<string, MatchState>): Fixture[] {
  const qualifiers = qualifiedTeams(fixtures, matchStates);
  if (qualifiers.length < 32) return fixtures;
  return fixtures.map(f => {
    if (!f.id.startsWith('k32-')) return f;
    const idx = Number(f.id.replace('k32-', '')) - 1;
    const home = qualifiers[idx];
    const away = qualifiers[31 - idx];
    return {
      ...f,
      home,
      away,
      status: 'open',
      baseOdds: odds(home, away),
    };
  });
}

const NEXT_ROUND: Record<string, { winner: { matchId: string; slot: 'home' | 'away' }; loser?: { matchId: string; slot: 'home' | 'away' } }> = {
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k32-${i + 1}`, { winner: { matchId: `k16-${Math.floor(i / 2) + 1}`, slot: i % 2 === 0 ? 'home' : 'away' } }])),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k16-${i + 1}`, { winner: { matchId: `qf-${Math.floor(i / 2) + 1}`, slot: i % 2 === 0 ? 'home' : 'away' } }])),
  ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`qf-${i + 1}`, { winner: { matchId: `sf-${Math.floor(i / 2) + 1}`, slot: i % 2 === 0 ? 'home' : 'away' } }])),
  'sf-1': { winner: { matchId: 'f-1', slot: 'home' }, loser: { matchId: '3pl-1', slot: 'home' } },
  'sf-2': { winner: { matchId: 'f-1', slot: 'away' }, loser: { matchId: '3pl-1', slot: 'away' } },
};

export function advanceKnockout(fixtures: Fixture[], fixtureId: string, matchState: MatchState): { fixtures: Fixture[]; eliminated?: Team } {
  const entry = NEXT_ROUND[fixtureId];
  if (!entry || matchState.status !== 'finished') return { fixtures };
  const source = fixtures.find(f => f.id === fixtureId);
  if (!source) return { fixtures };

  const winner = matchState.homeScore > matchState.awayScore ? source.home
    : matchState.awayScore > matchState.homeScore ? source.away
    : Math.random() > 0.5 ? source.home : source.away;
  const loser = winner.code === source.home.code ? source.away : source.home;

  const place = (list: Fixture[], target: { matchId: string; slot: 'home' | 'away' }, team: Team) => list.map(f => {
    if (f.id !== target.matchId) return f;
    const updated = { ...f, [target.slot]: team };
    const ready = updated.home.code !== 'TBD' && updated.away.code !== 'TBD';
    return {
      ...updated,
      status: ready ? 'open' : updated.status,
      baseOdds: ready ? odds(updated.home, updated.away) : updated.baseOdds,
    };
  });

  let next = place(fixtures, entry.winner, winner);
  if (entry.loser) next = place(next, entry.loser, loser);
  return { fixtures: next, eliminated: loser };
}

export function matchOutcome(matchState: MatchState): Outcome {
  if (matchState.homeScore > matchState.awayScore) return 'home';
  if (matchState.awayScore > matchState.homeScore) return 'away';
  return 'draw';
}
