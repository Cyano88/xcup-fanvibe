import { REALTIME_FIXTURES } from './engine/worldCupFixtures.js';
import type { Fixture, FixtureStatus, MatchState, Team } from './types.js';

export interface WorldCupFeed {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  source: 'sportmonks' | 'wc2026api' | 'balldontlie' | 'zafronix' | 'static';
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

interface SportmonksParticipant {
  id?: number;
  name?: string;
  short_code?: string;
  meta?: { location?: 'home' | 'away' | string };
}

interface SportmonksScore {
  participant_id?: number;
  score?: { goals?: number; participant?: string };
}

interface SportmonksEvent {
  id?: number;
  minute?: number;
  type_id?: number;
  type?: { name?: string; code?: string };
  participant_id?: number;
  player_name?: string;
  related_player_name?: string;
  info?: string;
}

interface SportmonksFixture {
  id?: number;
  name?: string;
  starting_at?: string;
  state?: { name?: string; short_name?: string; developer_name?: string };
  participants?: SportmonksParticipant[];
  scores?: SportmonksScore[];
  events?: SportmonksEvent[];
  venue?: { name?: string; city_name?: string; country_name?: string };
}

const CACHE_MS = Number(process.env.SPORTS_DATA_CACHE_MS ?? '120000');
const WC2026_URL = process.env.WC2026_API_URL ?? 'https://api.wc2026api.com/matches';
const WC2026_PROVIDER = process.env.WC2026_API_PROVIDER
  ?? (process.env.SPORTMONKS_API_KEY ? 'sportmonks' : undefined)
  ?? (WC2026_URL.includes('balldontlie') ? 'balldontlie' : WC2026_URL.includes('zafronix') ? 'zafronix' : 'wc2026api');
const SPORTMONKS_BASE_URL = process.env.SPORTMONKS_API_URL ?? 'https://api.sportmonks.com/v3/football';
const SPORTMONKS_WORLD_CUP_LEAGUE_ID = process.env.SPORTMONKS_WORLD_CUP_LEAGUE_ID ?? '732';

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
    providerConfigured: !!(process.env.SPORTMONKS_API_KEY || process.env.WC2026_API_KEY),
    error,
  };
}

function sportmonksTeam(match: SportmonksFixture, location: 'home' | 'away'): Team | null {
  const participant = match.participants?.find(item => item.meta?.location === location);
  return teamFromName(participant?.short_code) ?? teamFromName(participant?.name);
}

function sportmonksStatus(match: SportmonksFixture): FixtureStatus {
  const state = normalize(match.state?.developer_name ?? match.state?.short_name ?? match.state?.name);
  if (['inplay', 'live', '1sthalf', '2ndhalf', 'halftime', 'break'].includes(state)) return 'locked';
  if (['finished', 'ft', 'afterextratime', 'afterpenalties', 'ended'].includes(state)) return 'settled';
  if (['postponed', 'cancelled', 'suspended', 'interrupted'].includes(state)) return 'locked';
  return 'open';
}

function sportmonksScore(match: SportmonksFixture, location: 'home' | 'away'): number {
  const participant = match.participants?.find(item => item.meta?.location === location);
  if (!participant?.id) return 0;
  const score = match.scores?.find(item => item.participant_id === participant.id);
  return Number(score?.score?.goals ?? 0);
}

function sportmonksVenue(match: SportmonksFixture, fallback: string): string {
  if (!match.venue?.name) return fallback;
  const place = [match.venue.city_name, match.venue.country_name].filter(Boolean).join(', ');
  return place ? `${match.venue.name} - ${place}` : match.venue.name;
}

function sportmonksEventType(event: SportmonksEvent): string {
  return event.type?.name ?? event.type?.code ?? (event.type_id ? `event-${event.type_id}` : 'event');
}

function sportmonksEvents(match: SportmonksFixture, fixture: Fixture): MatchState['events'] {
  return (match.events ?? []).map((event, index) => {
    const participant = match.participants?.find(item => item.id === event.participant_id);
    const team = participant?.meta?.location === 'home'
      ? 'home'
      : participant?.meta?.location === 'away'
        ? 'away'
        : 'neutral';
    const type = sportmonksEventType(event);
    const player = event.player_name;
    const commentary = [
      `${type} ${fixture.home.code} vs ${fixture.away.code}`,
      player,
      event.info,
    ].filter(Boolean).join(' - ');
    return {
      id: Number(event.id ?? index + 1),
      minute: Number(event.minute ?? 0),
      type,
      team,
      commentary,
      player,
      player2: event.related_player_name,
    };
  });
}

function overlaySportmonks(matches: SportmonksFixture[]): WorldCupFeed {
  const apiByTeam = new Map<string, SportmonksFixture>();
  for (const match of matches) {
    const home = sportmonksTeam(match, 'home');
    const away = sportmonksTeam(match, 'away');
    if (!home || !away) continue;
    apiByTeam.set(matchKey(home, away), match);
  }

  const matchStates: Record<string, MatchState> = {};
  const fixtures = REALTIME_FIXTURES.map(fixture => {
    const api = apiByTeam.get(matchKey(fixture.home, fixture.away));
    if (!api) return fixture;

    const homeScore = sportmonksScore(api, 'home');
    const awayScore = sportmonksScore(api, 'away');
    const status = sportmonksStatus(api);
    if (status === 'locked' || status === 'settled') {
      matchStates[fixture.id] = {
        fixtureId: fixture.id,
        status: status === 'settled' ? 'finished' : 'live',
        minute: status === 'settled' ? 90 : Math.max(1, ...sportmonksEvents(api, fixture).map(event => event.minute)),
        homeScore,
        awayScore,
        events: sportmonksEvents(api, fixture),
        simulatedKickoff: api.starting_at ?? fixture.kickoff,
        possession: 50,
        finishedAt: status === 'settled' ? Date.now() : undefined,
      };
    }

    return {
      ...fixture,
      kickoff: api.starting_at ?? fixture.kickoff,
      venue: sportmonksVenue(api, fixture.venue),
      status,
      result: status === 'settled'
        ? homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw'
        : fixture.result,
    } satisfies Fixture;
  });

  return {
    fixtures,
    matchStates,
    source: 'sportmonks',
    mode: 'live',
    updatedAt: Date.now(),
    freshnessSeconds: 0,
    providerConfigured: true,
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

  const token = WC2026_PROVIDER === 'sportmonks'
    ? process.env.SPORTMONKS_API_KEY
    : process.env.WC2026_API_KEY;
  if (!token) {
    cache = buildStaticFeed(`${WC2026_PROVIDER === 'sportmonks' ? 'SPORTMONKS_API_KEY' : 'WC2026_API_KEY'} is not configured`);
    return cache;
  }

  try {
    if (WC2026_PROVIDER === 'sportmonks') {
      const url = new URL(`${SPORTMONKS_BASE_URL.replace(/\/$/, '')}/livescores/inplay`);
      url.searchParams.set('api_token', token);
      url.searchParams.set('filters', `fixtureLeagues:${SPORTMONKS_WORLD_CUP_LEAGUE_ID}`);
      url.searchParams.set('include', 'scores;participants;events;state;venue');
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Sportmonks API ${res.status}`);
      const json = await res.json() as { data?: SportmonksFixture[] };
      cache = overlaySportmonks(Array.isArray(json.data) ? json.data : []);
      return cache;
    }

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
