import { REALTIME_FIXTURES } from './engine/worldCupFixtures.js';
import type { Fixture, FixtureStatus, MatchState, Team } from './types.js';

export interface WorldCupFeed {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  source: 'wc2026api' | 'balldontlie' | 'zafronix' | 'static';
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
  group?: string | { name?: string };
  round?: string;
  stage?: { name?: string };
  home_team?: string | { name?: string; abbreviation?: string };
  away_team?: string | { name?: string; abbreviation?: string };
  home_score?: number;
  away_score?: number;
  home_goals?: number;
  away_goals?: number;
  stadium?: string | { name?: string; city?: string; country?: string };
  venue?: string;
  kickoff_utc?: string;
  date?: string;
  datetime?: string;
  status?: string;
}

const CACHE_MS = Number(process.env.SPORTS_DATA_CACHE_MS ?? '120000');
const WC2026_URL = process.env.WC2026_API_URL ?? 'https://api.wc2026api.com/matches';
const WC2026_PROVIDER = process.env.WC2026_API_PROVIDER
  ?? (WC2026_URL.includes('balldontlie') ? 'balldontlie' : WC2026_URL.includes('zafronix') ? 'zafronix' : 'wc2026api');

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

function teamName(value?: Wc2026Match['home_team']): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.name ?? value.abbreviation;
}

function groupName(match: Wc2026Match): string | undefined {
  if (typeof match.group === 'string') return match.group;
  return match.group_name ?? match.group?.name ?? match.stage?.name ?? match.round;
}

function venueName(match: Wc2026Match, fallback: string): string {
  if (typeof match.stadium === 'string') return match.stadium;
  if (match.stadium?.name) {
    const place = [match.stadium.city, match.stadium.country].filter(Boolean).join(', ');
    return place ? `${match.stadium.name} - ${place}` : match.stadium.name;
  }
  return match.venue ?? fallback;
}

function kickoffTime(match: Wc2026Match, fallback: string): string {
  return match.kickoff_utc ?? match.datetime ?? match.date ?? fallback;
}

function scoreValue(primary?: number, fallback?: number): number {
  return Number(primary ?? fallback ?? 0);
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
    const home = teamFromName(teamName(match.home_team));
    const away = teamFromName(teamName(match.away_team));
    if (!home || !away) continue;
    apiByTeam.set(matchKey(home, away, groupName(match)), match);
    apiByTeam.set(matchKey(home, away), match);
  }

  const matchStates: Record<string, MatchState> = {};
  const fixtures = REALTIME_FIXTURES.map(fixture => {
    const api = apiByTeam.get(matchKey(fixture.home, fixture.away, fixture.group))
      ?? apiByTeam.get(matchKey(fixture.home, fixture.away));
    if (!api) return fixture;

    const homeScore = scoreValue(api.home_score, api.home_goals);
    const awayScore = scoreValue(api.away_score, api.away_goals);
    const status = statusFromProvider(api.status);
    if (status === 'locked' || status === 'settled') {
      matchStates[fixture.id] = {
        fixtureId: fixture.id,
        status: status === 'settled' ? 'finished' : 'live',
        minute: status === 'settled' ? 90 : 1,
        homeScore,
        awayScore,
        events: [],
        simulatedKickoff: kickoffTime(api, fixture.kickoff),
        possession: 50,
        finishedAt: status === 'settled' ? Date.now() : undefined,
      };
    }

    return {
      ...fixture,
      kickoff: kickoffTime(api, fixture.kickoff),
      venue: venueName(api, fixture.venue),
      status,
      result: status === 'settled'
        ? homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw'
        : fixture.result,
    } satisfies Fixture;
  });

  return {
    fixtures,
    matchStates,
    source: WC2026_PROVIDER === 'balldontlie' ? 'balldontlie' : WC2026_PROVIDER === 'zafronix' ? 'zafronix' : 'wc2026api',
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
    const url = new URL(WC2026_URL);
    if (WC2026_PROVIDER === 'balldontlie') {
      url.searchParams.set('seasons[]', '2026');
      url.searchParams.set('per_page', '100');
    }
    const headers: Record<string, string> = WC2026_PROVIDER === 'zafronix'
      ? { 'X-API-Key': token }
      : { Authorization: WC2026_PROVIDER === 'balldontlie' ? token : `Bearer ${token}` };
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`WC2026 API ${res.status}`);
    const json = await res.json() as Wc2026Match[] | {
      data?: Wc2026Match[] | { matches?: Wc2026Match[]; fixtures?: Wc2026Match[] };
      matches?: Wc2026Match[];
      fixtures?: Wc2026Match[];
      tournament?: { matches?: Wc2026Match[]; fixtures?: Wc2026Match[] };
    };
    const matches = Array.isArray(json)
      ? json
      : Array.isArray(json.data)
        ? json.data
        : json.data?.matches ?? json.data?.fixtures ?? json.matches ?? json.fixtures ?? json.tournament?.matches ?? json.tournament?.fixtures ?? [];
    cache = overlayWc2026(matches);
    return cache;
  } catch (err: unknown) {
    cache = buildStaticFeed(err instanceof Error ? err.message : String(err));
    return cache;
  }
}
