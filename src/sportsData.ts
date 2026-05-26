import { REALTIME_FIXTURES } from './engine/worldCupFixtures.js';
import type { Fixture, FixtureStatus, MatchState, Team } from './types.js';

export interface WorldCupFeed {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  source: 'wc2026api' | 'static';
  mode: 'live' | 'fallback';
  updatedAt: number;
  freshnessSeconds: number;
  providerConfigured: boolean;
  error?: string;
}

interface Wc2026Match {
  id?: string | number;
  match_number?: number;
  group_name?: string;
  group?: string;
  round?: string;
  home_team?: string;
  away_team?: string;
  home_score?: number;
  away_score?: number;
  stadium?: string;
  venue?: string;
  kickoff_utc?: string;
  date?: string;
  status?: string;
}

const CACHE_MS = Number(process.env.SPORTS_DATA_CACHE_MS ?? '120000');
const WC2026_URL = process.env.WC2026_API_URL ?? 'https://api.wc2026api.com/matches';

let cache: WorldCupFeed | null = null;

const TEAM_BY_NAME = new Map<string, Team>();
const TEAM_BY_CODE = new Map<string, Team>();
for (const fixture of REALTIME_FIXTURES) {
  for (const team of [fixture.home, fixture.away]) {
    TEAM_BY_NAME.set(normalize(team.name), team);
    TEAM_BY_CODE.set(normalize(team.code), team);
  }
}

function normalize(value = ''): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function teamFromName(name?: string): Team | null {
  if (!name) return null;
  const key = normalize(name);
  return TEAM_BY_NAME.get(key) ?? TEAM_BY_CODE.get(key) ?? null;
}

function statusFromProvider(status?: string): FixtureStatus {
  const value = normalize(status);
  if (['live', 'inplay', 'halftime', 'firsthalf', 'secondhalf'].includes(value)) return 'locked';
  if (['finished', 'fulltime', 'ft', 'completed'].includes(value)) return 'settled';
  if (['cancelled', 'postponed', 'suspended'].includes(value)) return 'locked';
  return 'open';
}

function matchKey(home?: Team | null, away?: Team | null, group?: string): string {
  return `${home?.code ?? ''}:${away?.code ?? ''}:${group ?? ''}`;
}

function buildStaticFeed(error?: string): WorldCupFeed {
  return {
    fixtures: REALTIME_FIXTURES,
    matchStates: {},
    source: 'static',
    mode: 'fallback',
    updatedAt: Date.now(),
    freshnessSeconds: 0,
    providerConfigured: !!process.env.WC2026_API_KEY,
    error,
  };
}

function overlayWc2026(matches: Wc2026Match[]): WorldCupFeed {
  const apiByTeam = new Map<string, Wc2026Match>();
  for (const match of matches) {
    const home = teamFromName(match.home_team);
    const away = teamFromName(match.away_team);
    if (!home || !away) continue;
    apiByTeam.set(matchKey(home, away, match.group_name ?? match.group), match);
    apiByTeam.set(matchKey(home, away), match);
  }

  const matchStates: Record<string, MatchState> = {};
  const fixtures = REALTIME_FIXTURES.map(fixture => {
    const api = apiByTeam.get(matchKey(fixture.home, fixture.away, fixture.group))
      ?? apiByTeam.get(matchKey(fixture.home, fixture.away));
    if (!api) return fixture;

    const homeScore = Number(api.home_score ?? 0);
    const awayScore = Number(api.away_score ?? 0);
    const status = statusFromProvider(api.status);
    if (status === 'locked' || status === 'settled') {
      matchStates[fixture.id] = {
        fixtureId: fixture.id,
        status: status === 'settled' ? 'finished' : 'live',
        minute: status === 'settled' ? 90 : 1,
        homeScore,
        awayScore,
        events: [],
        simulatedKickoff: api.kickoff_utc ?? api.date ?? fixture.kickoff,
        possession: 50,
        finishedAt: status === 'settled' ? Date.now() : undefined,
      };
    }

    return {
      ...fixture,
      kickoff: api.kickoff_utc ?? api.date ?? fixture.kickoff,
      venue: api.stadium ?? api.venue ?? fixture.venue,
      status,
      result: status === 'settled'
        ? homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw'
        : fixture.result,
    } satisfies Fixture;
  });

  return {
    fixtures,
    matchStates,
    source: 'wc2026api',
    mode: 'live',
    updatedAt: Date.now(),
    freshnessSeconds: 0,
    providerConfigured: true,
  };
}

export async function getWorldCupFeed(force = false): Promise<WorldCupFeed> {
  if (!force && cache && Date.now() - cache.updatedAt < CACHE_MS) {
    return { ...cache, freshnessSeconds: Math.floor((Date.now() - cache.updatedAt) / 1000) };
  }

  const token = process.env.WC2026_API_KEY;
  if (!token) {
    cache = buildStaticFeed('WC2026_API_KEY is not configured');
    return cache;
  }

  try {
    const res = await fetch(WC2026_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`WC2026 API ${res.status}`);
    const json = await res.json() as Wc2026Match[] | { data?: Wc2026Match[]; matches?: Wc2026Match[] };
    const matches = Array.isArray(json) ? json : json.data ?? json.matches ?? [];
    cache = overlayWc2026(matches);
    return cache;
  } catch (err: unknown) {
    cache = buildStaticFeed(err instanceof Error ? err.message : String(err));
    return cache;
  }
}
