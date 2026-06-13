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
  round?: { name?: string };
  stage?: { name?: string };
  participants?: SportmonksParticipant[];
  scores?: SportmonksScore[];
  events?: SportmonksEvent[];
  venue?: { name?: string; city_name?: string; country_name?: string };
}

interface SportmonksResponse {
  data?: SportmonksFixture[];
  pagination?: {
    count?: number;
    per_page?: number;
    current_page?: number;
    next_page?: string | null;
    has_more?: boolean;
  };
}

const CACHE_MS = Number(process.env.SPORTS_DATA_CACHE_MS ?? '120000');
const WC2026_URL = process.env.WC2026_API_URL ?? 'https://api.wc2026api.com/matches';
const WC2026_PROVIDER = process.env.WC2026_API_PROVIDER
  ?? (process.env.SPORTMONKS_API_KEY ? 'sportmonks' : undefined)
  ?? (WC2026_URL.includes('balldontlie') ? 'balldontlie' : WC2026_URL.includes('zafronix') ? 'zafronix' : 'wc2026api');
const SPORTMONKS_BASE_URL = process.env.SPORTMONKS_API_URL ?? 'https://api.sportmonks.com/v3/football';
const SPORTMONKS_WORLD_CUP_LEAGUE_ID = process.env.SPORTMONKS_WORLD_CUP_LEAGUE_ID ?? '732';
const SPORTMONKS_WORLD_CUP_START_DATE = process.env.SPORTMONKS_WORLD_CUP_START_DATE ?? '2026-06-11';
const SPORTMONKS_WORLD_CUP_END_DATE = process.env.SPORTMONKS_WORLD_CUP_END_DATE ?? '2026-07-20';
const MATCH_SETTLED_FALLBACK_MS = Number(process.env.WORLD_CUP_MATCH_SETTLED_FALLBACK_MS ?? `${135 * 60 * 1000}`);

let cache: WorldCupFeed | null = null;

const TEAM_BY_NAME = new Map<string, Team>();
const TEAM_BY_CODE = new Map<string, Team>();
const TEAM_GROUP_BY_CODE = new Map<string, string>();
for (const fixture of REALTIME_FIXTURES) {
  for (const team of [fixture.home, fixture.away]) {
    TEAM_BY_NAME.set(normalize(team.name), team);
    TEAM_BY_CODE.set(normalize(team.code), team);
    TEAM_GROUP_BY_CODE.set(team.code, fixture.group);
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

function teamFromSportmonksParticipant(participant?: SportmonksParticipant): Team | null {
  const known = teamFromName(participant?.short_code) ?? teamFromName(participant?.name);
  if (known) return known;
  const name = participant?.name?.trim();
  const code = participant?.short_code?.trim().toUpperCase() ?? name?.slice(0, 3).toUpperCase();
  if (!name || !code) return null;
  return { name, code, flag: '', iso: code.toLowerCase() };
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

function matchStateStatusFromProvider(status?: string): MatchState['status'] | null {
  const value = normalize(status);
  if (['halftime'].includes(value)) return 'half_time';
  if (['live', 'inplay', 'firsthalf', 'secondhalf'].includes(value)) return 'live';
  if (['finished', 'fulltime', 'ft', 'completed'].includes(value)) return 'finished';
  return null;
}

function matchKey(home?: Team | null, away?: Team | null, group?: string): string {
  return `${home?.code ?? ''}:${away?.code ?? ''}:${group ?? ''}`;
}

function buildStaticFeed(error?: string): WorldCupFeed {
  return {
    fixtures: [],
    matchStates: {},
    source: 'static',
    mode: 'fallback',
    updatedAt: Date.now(),
    freshnessSeconds: 0,
    providerConfigured: false,
    error,
  };
}

function sportmonksTeam(match: SportmonksFixture, location: 'home' | 'away'): Team | null {
  const participant = match.participants?.find(item => item.meta?.location === location);
  return teamFromSportmonksParticipant(participant);
}

function sportmonksStatus(match: SportmonksFixture): FixtureStatus {
  const state = normalize(match.state?.developer_name ?? match.state?.short_name ?? match.state?.name);
  if (['inplay', 'live', '1sthalf', '2ndhalf', 'halftime', 'break'].includes(state)) return 'locked';
  if (['finished', 'ft', 'afterextratime', 'afterpenalties', 'ended'].includes(state)) return 'settled';
  if (['postponed', 'cancelled', 'suspended', 'interrupted'].includes(state)) return 'locked';
  return 'open';
}

function sportmonksMatchStateStatus(match: SportmonksFixture): MatchState['status'] | null {
  const state = normalize(match.state?.developer_name ?? match.state?.short_name ?? match.state?.name);
  if (['halftime', 'break'].includes(state)) return 'half_time';
  if (['inplay', 'live', '1sthalf', '2ndhalf'].includes(state)) return 'live';
  if (['finished', 'ft', 'afterextratime', 'afterpenalties', 'ended'].includes(state)) return 'finished';
  return null;
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

function sportmonksGroup(match: SportmonksFixture, home: Team, away: Team, fallback?: string): string {
  if (fallback) return fallback;
  const homeGroup = TEAM_GROUP_BY_CODE.get(home.code);
  const awayGroup = TEAM_GROUP_BY_CODE.get(away.code);
  if (homeGroup && homeGroup === awayGroup) return homeGroup;
  const source = [match.stage?.name, match.round?.name, match.name].filter(Boolean).join(' ');
  const group = source.match(/\bGroup\s+([A-L])\b/i)?.[1]?.toUpperCase();
  return group ?? 'WC';
}

function sportmonksRound(match: SportmonksFixture, fallback?: Fixture['round']): Fixture['round'] | undefined {
  if (fallback) return fallback;
  const source = normalize([match.stage?.name, match.round?.name, match.name].filter(Boolean).join(' '));
  if (source.includes('roundof16') || source.includes('last16')) return 'R16';
  if (source.includes('roundof32') || source.includes('last32')) return 'R32';
  if (source.includes('quarterfinal')) return 'QF';
  if (source.includes('semifinal')) return 'SF';
  if (source.includes('thirdplace')) return '3PL';
  if (source.includes('final')) return 'F';
  return undefined;
}

function sportmonksMatchday(match: SportmonksFixture, fallback?: number): number {
  if (fallback) return fallback;
  const roundText = match.round?.name ?? '';
  const numeric = Number(roundText.match(/\d+/)?.[0]);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

function sportmonksStadium(match: SportmonksFixture, template?: Fixture): Fixture['stadium'] {
  if (template?.stadium) return template.stadium;
  if (!match.venue?.name) return undefined;
  return {
    name: match.venue.name,
    city: match.venue.city_name ?? '',
    country: match.venue.country_name ?? '',
    capacity: 0,
  };
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

function buildMatchState(fixture: Fixture, stateStatus: MatchState['status'] | null, homeScore: number, awayScore: number, events: MatchState['events'], kickoff: string): MatchState | null {
  if (!stateStatus) return null;
  const latestMinute = events.length ? Math.max(...events.map(event => event.minute ?? 0)) : 1;
  return {
    fixtureId: fixture.id,
    status: stateStatus,
    minute: stateStatus === 'finished' ? 90 : Math.max(1, latestMinute),
    homeScore,
    awayScore,
    events,
    simulatedKickoff: kickoff,
    possession: 50,
    finishedAt: stateStatus === 'finished' ? Date.parse(kickoff) + MATCH_SETTLED_FALLBACK_MS : undefined,
  };
}

function overlaySportmonks(matches: SportmonksFixture[]): WorldCupFeed {
  const templatesByTeam = new Map(REALTIME_FIXTURES.map(fixture => [matchKey(fixture.home, fixture.away), fixture]));

  const matchStates: Record<string, MatchState> = {};
  const fixtures: Fixture[] = [];
  const seen = new Set<string>();
  for (const api of matches) {
    const home = sportmonksTeam(api, 'home');
    const away = sportmonksTeam(api, 'away');
    if (!home || !away) continue;
    const template = templatesByTeam.get(matchKey(home, away));
    const fixtureId = template?.id ?? `sm-${api.id ?? normalize(`${home.code}-${away.code}-${api.starting_at ?? fixtures.length}`)}`;
    if (seen.has(fixtureId)) continue;
    seen.add(fixtureId);

    const homeScore = sportmonksScore(api, 'home');
    const awayScore = sportmonksScore(api, 'away');
    const status = sportmonksStatus(api);
    const kickoff = api.starting_at ?? template?.kickoff ?? new Date().toISOString();
    const fixture: Fixture = {
      id: fixtureId,
      matchday: sportmonksMatchday(api, template?.matchday),
      group: sportmonksGroup(api, home, away, template?.group),
      round: sportmonksRound(api, template?.round),
      home,
      away,
      kickoff,
      venue: sportmonksVenue(api, template?.venue ?? 'Venue TBC'),
      stadium: sportmonksStadium(api, template),
      status,
      baseOdds: template?.baseOdds ?? { home: 34, draw: 32, away: 34 },
      mode: 'realtime',
      result: status === 'settled'
        ? homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw'
        : template?.result,
    };
    const events = sportmonksEvents(api, fixture);
    const matchState = buildMatchState(fixture, sportmonksMatchStateStatus(api), homeScore, awayScore, events, kickoff);
    if (matchState) matchStates[fixture.id] = matchState;
    fixtures.push(fixture);
  }

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
  const templatesByTeam = new Map(REALTIME_FIXTURES.flatMap(fixture => [
    [matchKey(fixture.home, fixture.away, fixture.group), fixture],
    [matchKey(fixture.home, fixture.away), fixture],
  ]));

  const matchStates: Record<string, MatchState> = {};
  const fixtures: Fixture[] = [];
  const seen = new Set<string>();
  for (const api of matches) {
    const home = teamFromName(teamName(api.home_team));
    const away = teamFromName(teamName(api.away_team));
    if (!home || !away) continue;
    const fixture = templatesByTeam.get(matchKey(home, away, groupName(api)))
      ?? templatesByTeam.get(matchKey(home, away));
    if (!fixture || seen.has(fixture.id)) continue;
    seen.add(fixture.id);

    const homeScore = scoreValue(api.home_score, api.home_goals);
    const awayScore = scoreValue(api.away_score, api.away_goals);
    const status = statusFromProvider(api.status);
    const kickoff = kickoffTime(api, fixture.kickoff);
    const matchState = buildMatchState(
      fixture,
      matchStateStatusFromProvider(api.status),
      homeScore,
      awayScore,
      [],
      kickoff
    );
    if (matchState) matchStates[fixture.id] = matchState;

    fixtures.push({
      ...fixture,
      kickoff,
      venue: venueName(api, fixture.venue),
      status,
      result: status === 'settled'
        ? homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw'
        : fixture.result,
    } satisfies Fixture);
  }

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
      const buildSportmonksUrl = (path: string, page = 1) => {
        const url = new URL(`${SPORTMONKS_BASE_URL.replace(/\/$/, '')}${path}`);
        url.searchParams.set('api_token', token);
        url.searchParams.set('filters', `fixtureLeagues:${SPORTMONKS_WORLD_CUP_LEAGUE_ID}`);
        url.searchParams.set('include', 'scores;participants;events;state;venue;round;stage');
        url.searchParams.set('per_page', '100');
        url.searchParams.set('page', String(page));
        return url;
      };

      const fetchAllSportmonksPages = async (path: string): Promise<SportmonksFixture[]> => {
        const fixtures: SportmonksFixture[] = [];
        let page = 1;
        for (;;) {
          const res = await fetch(buildSportmonksUrl(path, page), { signal: AbortSignal.timeout(10000) });
          if (!res.ok) throw new Error(`Sportmonks API ${res.status}`);
          const json = await res.json() as SportmonksResponse;
          if (Array.isArray(json.data)) fixtures.push(...json.data);
          const hasMore = json.pagination?.has_more === true || !!json.pagination?.next_page;
          if (!hasMore) break;
          page += 1;
          if (page > 10) break;
        }
        return fixtures;
      };

      let matches: SportmonksFixture[] = [];
      try {
        matches = await fetchAllSportmonksPages(`/fixtures/between/${SPORTMONKS_WORLD_CUP_START_DATE}/${SPORTMONKS_WORLD_CUP_END_DATE}`);
      } catch {
        const res = await fetch(buildSportmonksUrl('/livescores/inplay'), { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`Sportmonks API ${res.status}`);
        const json = await res.json() as SportmonksResponse;
        matches = Array.isArray(json.data) ? json.data : [];
      }
      cache = overlaySportmonks(matches);
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
