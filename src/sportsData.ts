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
  description?: string;
}

interface SportmonksEvent {
  id?: number;
  minute?: number;
  type_id?: number;
  type?: { name?: string; code?: string };
  participant_id?: number;
  player_name?: string;
  related_player_name?: string;
  player?: { display_name?: string; name?: string; common_name?: string };
  related_player?: { display_name?: string; name?: string; common_name?: string };
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
  periods?: {
    ticking?: boolean;
    minutes?: number;
    seconds?: number;
    description?: string;
    sort_order?: number;
  }[];
  events?: SportmonksEvent[];
  venue?: { name?: string; city_name?: string; country_name?: string };
}

interface SportmonksResponse {
  data?: SportmonksFixture[] | SportmonksFixture;
  pagination?: {
    count?: number;
    per_page?: number;
    current_page?: number;
    next_page?: string | null;
    has_more?: boolean;
  };
}

const CACHE_MS = Number(process.env.SPORTS_DATA_CACHE_MS ?? '30000');
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
const TEAM_META: Array<Team & { group: string; aliases?: string[] }> = [
  { name: 'Mexico', code: 'MEX', flag: '🇲🇽', iso: 'mx', group: 'A' },
  { name: 'South Africa', code: 'RSA', flag: '🇿🇦', iso: 'za', group: 'A' },
  { name: 'South Korea', code: 'KOR', flag: '🇰🇷', iso: 'kr', group: 'A', aliases: ['Korea Republic'] },
  { name: 'Czech Republic', code: 'CZE', flag: '🇨🇿', iso: 'cz', group: 'A', aliases: ['Czechia'] },
  { name: 'Canada', code: 'CAN', flag: '🇨🇦', iso: 'ca', group: 'B' },
  { name: 'Bosnia & Herz.', code: 'BIH', flag: '🇧🇦', iso: 'ba', group: 'B', aliases: ['Bosnia and Herzegovina', 'Bosnia & Herzegovina'] },
  { name: 'Qatar', code: 'QAT', flag: '🇶🇦', iso: 'qa', group: 'B' },
  { name: 'Switzerland', code: 'SUI', flag: '🇨🇭', iso: 'ch', group: 'B' },
  { name: 'Brazil', code: 'BRA', flag: '🇧🇷', iso: 'br', group: 'C' },
  { name: 'Morocco', code: 'MAR', flag: '🇲🇦', iso: 'ma', group: 'C' },
  { name: 'Haiti', code: 'HAI', flag: '🇭🇹', iso: 'ht', group: 'C' },
  { name: 'Scotland', code: 'SCO', flag: '🏴', iso: 'gb-sct', group: 'C' },
  { name: 'United States', code: 'USA', flag: '🇺🇸', iso: 'us', group: 'D', aliases: ['USA'] },
  { name: 'Paraguay', code: 'PAR', flag: '🇵🇾', iso: 'py', group: 'D' },
  { name: 'Australia', code: 'AUS', flag: '🇦🇺', iso: 'au', group: 'D' },
  { name: 'Turkey', code: 'TUR', flag: '🇹🇷', iso: 'tr', group: 'D', aliases: ['Türkiye'] },
  { name: 'Germany', code: 'GER', flag: '🇩🇪', iso: 'de', group: 'E' },
  { name: 'Curaçao', code: 'CUW', flag: '🇨🇼', iso: 'cw', group: 'E', aliases: ['Curacao'] },
  { name: 'Ivory Coast', code: 'CIV', flag: '🇨🇮', iso: 'ci', group: 'E', aliases: ["Côte d'Ivoire", 'Cote d Ivoire'] },
  { name: 'Ecuador', code: 'ECU', flag: '🇪🇨', iso: 'ec', group: 'E' },
  { name: 'Netherlands', code: 'NED', flag: '🇳🇱', iso: 'nl', group: 'F' },
  { name: 'Japan', code: 'JPN', flag: '🇯🇵', iso: 'jp', group: 'F' },
  { name: 'Sweden', code: 'SWE', flag: '🇸🇪', iso: 'se', group: 'F' },
  { name: 'Tunisia', code: 'TUN', flag: '🇹🇳', iso: 'tn', group: 'F' },
  { name: 'Belgium', code: 'BEL', flag: '🇧🇪', iso: 'be', group: 'G' },
  { name: 'Egypt', code: 'EGY', flag: '🇪🇬', iso: 'eg', group: 'G' },
  { name: 'Iran', code: 'IRN', flag: '🇮🇷', iso: 'ir', group: 'G' },
  { name: 'New Zealand', code: 'NZL', flag: '🇳🇿', iso: 'nz', group: 'G' },
  { name: 'Spain', code: 'ESP', flag: '🇪🇸', iso: 'es', group: 'H' },
  { name: 'Cape Verde', code: 'CPV', flag: '🇨🇻', iso: 'cv', group: 'H' },
  { name: 'Saudi Arabia', code: 'KSA', flag: '🇸🇦', iso: 'sa', group: 'H' },
  { name: 'Uruguay', code: 'URU', flag: '🇺🇾', iso: 'uy', group: 'H' },
  { name: 'France', code: 'FRA', flag: '🇫🇷', iso: 'fr', group: 'I' },
  { name: 'Iraq', code: 'IRQ', flag: '🇮🇶', iso: 'iq', group: 'I' },
  { name: 'Senegal', code: 'SEN', flag: '🇸🇳', iso: 'sn', group: 'I' },
  { name: 'Norway', code: 'NOR', flag: '🇳🇴', iso: 'no', group: 'I' },
  { name: 'Argentina', code: 'ARG', flag: '🇦🇷', iso: 'ar', group: 'J' },
  { name: 'Algeria', code: 'ALG', flag: '🇩🇿', iso: 'dz', group: 'J' },
  { name: 'Austria', code: 'AUT', flag: '🇦🇹', iso: 'at', group: 'J' },
  { name: 'Jordan', code: 'JOR', flag: '🇯🇴', iso: 'jo', group: 'J' },
  { name: 'Portugal', code: 'POR', flag: '🇵🇹', iso: 'pt', group: 'K' },
  { name: 'DR Congo', code: 'COD', flag: '🇨🇩', iso: 'cd', group: 'K', aliases: ['Congo DR', 'Democratic Republic of the Congo'] },
  { name: 'Uzbekistan', code: 'UZB', flag: '🇺🇿', iso: 'uz', group: 'K' },
  { name: 'Colombia', code: 'COL', flag: '🇨🇴', iso: 'co', group: 'K' },
  { name: 'England', code: 'ENG', flag: '🏴', iso: 'gb-eng', group: 'L' },
  { name: 'Ghana', code: 'GHA', flag: '🇬🇭', iso: 'gh', group: 'L' },
  { name: 'Croatia', code: 'CRO', flag: '🇭🇷', iso: 'hr', group: 'L' },
  { name: 'Panama', code: 'PAN', flag: '🇵🇦', iso: 'pa', group: 'L' },
];
for (const team of TEAM_META) {
  TEAM_BY_NAME.set(normalize(team.name), team);
  TEAM_BY_CODE.set(normalize(team.code), team);
  for (const alias of team.aliases ?? []) TEAM_BY_NAME.set(normalize(alias), team);
  TEAM_GROUP_BY_CODE.set(team.code, team.group);
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

function parseProviderTime(value?: string): number {
  if (!value) return Number.NaN;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return Date.parse(normalized);
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

function buildProviderUnavailableFeed(error?: string): WorldCupFeed {
  return {
    fixtures: [],
    matchStates: {},
    source: WC2026_PROVIDER === 'sportmonks' ? 'sportmonks' : 'static',
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
  if (match.periods?.some(period => period.ticking)) return 'live';
  const state = normalize(match.state?.developer_name ?? match.state?.short_name ?? match.state?.name);
  if (['halftime', 'break'].includes(state)) return 'half_time';
  if (['inplay', 'live', '1sthalf', '2ndhalf'].includes(state)) return 'live';
  if (['finished', 'ft', 'afterextratime', 'afterpenalties', 'ended'].includes(state)) return 'finished';
  return null;
}

function sportmonksScore(match: SportmonksFixture, location: 'home' | 'away'): number {
  const participant = match.participants?.find(item => item.meta?.location === location);
  if (!participant?.id) return 0;
  const scores = match.scores?.filter(item => item.participant_id === participant.id) ?? [];
  const score = scores.find(item => normalize(item.description) === 'current') ?? scores[0];
  return Number(score?.score?.goals ?? 0);
}

function sportmonksMinute(match: SportmonksFixture, fallbackMinute: number): number {
  const periods = match.periods ?? [];
  const activePeriod = periods.find(period => period.ticking)
    ?? [...periods].sort((a, b) => Number(b.sort_order ?? 0) - Number(a.sort_order ?? 0))[0];
  const minute = Number(activePeriod?.minutes);
  return Number.isFinite(minute) && minute > 0 ? minute : fallbackMinute;
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

function sportmonksRound(match: SportmonksFixture, kickoff: string, fallback?: Fixture['round']): Fixture['round'] | undefined {
  if (fallback) return fallback;
  const kickoffMs = parseProviderTime(kickoff);
  if (Number.isFinite(kickoffMs)) {
    if (kickoffMs >= Date.parse('2026-07-19T00:00:00Z')) return 'F';
    if (kickoffMs >= Date.parse('2026-07-18T00:00:00Z')) return '3PL';
    if (kickoffMs >= Date.parse('2026-07-14T00:00:00Z')) return 'SF';
    if (kickoffMs >= Date.parse('2026-07-09T00:00:00Z')) return 'QF';
    if (kickoffMs >= Date.parse('2026-07-04T12:00:00Z')) return 'R16';
    if (kickoffMs >= Date.parse('2026-06-28T12:00:00Z')) return 'R32';
  }
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

function assignGroupMatchdays(fixtures: Fixture[]): void {
  const groups = new Set(fixtures.filter(fixture => !fixture.round).map(fixture => fixture.group));
  for (const group of groups) {
    fixtures
      .filter(fixture => !fixture.round && fixture.group === group)
      .sort((a, b) => parseProviderTime(a.kickoff) - parseProviderTime(b.kickoff))
      .forEach((fixture, index) => {
        fixture.matchday = Math.floor(index / 2) + 1;
      });
  }
}

function sportmonksStadium(match: SportmonksFixture, template?: Fixture): Fixture['stadium'] {
  if (!match.venue?.name) return template?.stadium;
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
    const player = event.player_name ?? event.player?.display_name ?? event.player?.common_name ?? event.player?.name;
    const player2 = event.related_player_name ?? event.related_player?.display_name ?? event.related_player?.common_name ?? event.related_player?.name;
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
      player2,
    };
  });
}

function buildMatchState(fixture: Fixture, source: SportmonksFixture | null, stateStatus: MatchState['status'] | null, homeScore: number, awayScore: number, events: MatchState['events'], kickoff: string): MatchState | null {
  if (!stateStatus) return null;
  const kickoffMs = parseProviderTime(kickoff);
  const elapsedMinute = Number.isFinite(kickoffMs) ? Math.floor((Date.now() - kickoffMs) / 60_000) + 1 : 1;
  const latestMinute = events.length ? Math.max(...events.map(event => event.minute ?? 0)) : elapsedMinute;
  const providerMinute = source ? sportmonksMinute(source, latestMinute) : latestMinute;
  return {
    fixtureId: fixture.id,
    status: stateStatus,
    minute: stateStatus === 'finished' ? 90 : Math.min(120, Math.max(1, providerMinute)),
    homeScore,
    awayScore,
    events,
    simulatedKickoff: kickoff,
    possession: 50,
    finishedAt: stateStatus === 'finished' && Number.isFinite(kickoffMs) ? kickoffMs + MATCH_SETTLED_FALLBACK_MS : undefined,
  };
}

function overlaySportmonks(matches: SportmonksFixture[]): WorldCupFeed {
  const matchStates: Record<string, MatchState> = {};
  const fixtures: Fixture[] = [];
  const seen = new Set<string>();
  for (const api of matches) {
    const home = sportmonksTeam(api, 'home');
    const away = sportmonksTeam(api, 'away');
    if (!home || !away) continue;
    const fixtureId = `sm-${api.id ?? normalize(`${home.code}-${away.code}-${api.starting_at ?? fixtures.length}`)}`;
    if (seen.has(fixtureId)) continue;
    seen.add(fixtureId);

    const homeScore = sportmonksScore(api, 'home');
    const awayScore = sportmonksScore(api, 'away');
    const status = sportmonksStatus(api);
    const kickoff = api.starting_at ?? new Date().toISOString();
    const fixture: Fixture = {
      id: fixtureId,
      matchday: sportmonksMatchday(api),
      group: sportmonksGroup(api, home, away),
      round: sportmonksRound(api, kickoff),
      home,
      away,
      kickoff,
      venue: sportmonksVenue(api, 'Venue TBC'),
      stadium: sportmonksStadium(api),
      status,
      baseOdds: { home: 34, draw: 32, away: 34 },
      mode: 'realtime',
      provider: 'sportmonks',
      providerId: api.id ? String(api.id) : undefined,
      result: status === 'settled'
        ? homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw'
        : undefined,
    };
    const events = sportmonksEvents(api, fixture);
    const matchState = buildMatchState(fixture, api, sportmonksMatchStateStatus(api), homeScore, awayScore, events, kickoff);
    if (matchState) matchStates[fixture.id] = matchState;
    fixtures.push(fixture);
  }
  assignGroupMatchdays(fixtures);

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

function buildSportmonksUrl(path: string, token: string, include: string, page = 1): URL {
  const url = new URL(`${SPORTMONKS_BASE_URL.replace(/\/$/, '')}${path}`);
  url.searchParams.set('api_token', token);
  url.searchParams.set('filters', `fixtureLeagues:${SPORTMONKS_WORLD_CUP_LEAGUE_ID}`);
  url.searchParams.set('include', include);
  url.searchParams.set('per_page', '100');
  url.searchParams.set('page', String(page));
  return url;
}

function scheduledMatchState(fixture: Fixture): MatchState {
  return {
    fixtureId: fixture.id,
    status: 'scheduled',
    minute: 0,
    homeScore: 0,
    awayScore: 0,
    events: [],
    simulatedKickoff: fixture.kickoff,
    possession: 50,
  };
}

function sportmonksFixtureIdFromFanVibeId(fixtureId: string, feed?: WorldCupFeed): string | null {
  if (fixtureId.startsWith('sm-')) return fixtureId.slice(3);
  const fixture = feed?.fixtures.find(item => item.id === fixtureId);
  return fixture?.provider === 'sportmonks' && fixture.providerId ? fixture.providerId : null;
}

export async function getWorldCupMatchDetail(fixtureId: string): Promise<{
  fixture: Fixture;
  matchState: MatchState;
  source: WorldCupFeed['source'];
  mode: WorldCupFeed['mode'];
  updatedAt: number;
  providerConfigured: boolean;
}> {
  const feed = await getWorldCupFeed(false);
  const feedFixture = feed.fixtures.find(fixture => fixture.id === fixtureId);
  if (WC2026_PROVIDER !== 'sportmonks') {
    if (!feedFixture) throw new Error('World Cup fixture not found');
    return {
      fixture: feedFixture,
      matchState: feed.matchStates[fixtureId] ?? scheduledMatchState(feedFixture),
      source: feed.source,
      mode: feed.mode,
      updatedAt: feed.updatedAt,
      providerConfigured: feed.providerConfigured,
    };
  }

  const token = process.env.SPORTMONKS_API_KEY;
  if (!token) throw new Error('SPORTMONKS_API_KEY is not configured');

  const providerId = sportmonksFixtureIdFromFanVibeId(fixtureId, feed);
  if (!providerId) {
    if (!feedFixture) throw new Error('World Cup fixture not found');
    return {
      fixture: feedFixture,
      matchState: feed.matchStates[fixtureId] ?? scheduledMatchState(feedFixture),
      source: feed.source,
      mode: feed.mode,
      updatedAt: feed.updatedAt,
      providerConfigured: feed.providerConfigured,
    };
  }

  const includes = [
    'participants;league;venue;state;scores;periods;events.type;events.period;events.player;statistics.type;sidelined.sideline.player;sidelined.sideline.type;weatherReport',
    'participants;league;venue;state;scores;periods;events.type;events.period;events.player',
  ];

  let detail: SportmonksFixture | null = null;
  for (const include of includes) {
    const res = await fetch(buildSportmonksUrl(`/fixtures/${providerId}`, token, include), {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const json = await res.json() as SportmonksResponse;
      detail = Array.isArray(json.data) ? json.data[0] ?? null : json.data ?? null;
      break;
    }
    if (res.status < 400 || res.status >= 500) throw new Error(`Sportmonks API ${res.status}`);
  }

  if (!detail) {
    if (!feedFixture) throw new Error('World Cup fixture not found');
    return {
      fixture: feedFixture,
      matchState: feed.matchStates[fixtureId] ?? scheduledMatchState(feedFixture),
      source: feed.source,
      mode: feed.mode,
      updatedAt: Date.now(),
      providerConfigured: true,
    };
  }

  const detailFeed = overlaySportmonks([detail]);
  const fixture = detailFeed.fixtures.find(item => item.id === fixtureId)
    ?? detailFeed.fixtures[0]
    ?? feedFixture;
  if (!fixture) throw new Error('World Cup fixture not found');
  const matchState = detailFeed.matchStates[fixture.id] ?? feed.matchStates[fixture.id] ?? feed.matchStates[fixtureId] ?? scheduledMatchState(fixture);
  const normalizedMatchState = matchState.fixtureId === fixtureId ? matchState : { ...matchState, fixtureId: fixture.id };
  return {
    fixture,
    matchState: normalizedMatchState,
    source: 'sportmonks',
    mode: 'live',
    updatedAt: Date.now(),
    providerConfigured: true,
  };
}

function overlayUnsupportedProvider(_matches: Wc2026Match[]): WorldCupFeed {
  return {
    fixtures: [],
    matchStates: {},
    source: WC2026_PROVIDER === 'balldontlie' ? 'balldontlie' : WC2026_PROVIDER === 'zafronix' ? 'zafronix' : 'wc2026api',
    mode: 'fallback',
    updatedAt: Date.now(),
    freshnessSeconds: 0,
    providerConfigured: false,
    error: 'World Cup live data is not configured',
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
    cache = buildProviderUnavailableFeed(`${WC2026_PROVIDER === 'sportmonks' ? 'SPORTMONKS_API_KEY' : 'WC2026_API_KEY'} is not configured`);
    return cache;
  }

  try {
    if (WC2026_PROVIDER === 'sportmonks') {
      const fetchAllSportmonksPages = async (path: string): Promise<SportmonksFixture[]> => {
        const fixtures: SportmonksFixture[] = [];
        let page = 1;
        for (;;) {
          const res = await fetch(buildSportmonksUrl(path, token, 'scores;participants;periods;events;state;venue;round;stage', page), { signal: AbortSignal.timeout(10000) });
          if (!res.ok) throw new Error(`Sportmonks API ${res.status}`);
          const json = await res.json() as SportmonksResponse;
          if (Array.isArray(json.data)) fixtures.push(...json.data);
          else if (json.data) fixtures.push(json.data);
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
        const res = await fetch(buildSportmonksUrl('/livescores/inplay', token, 'participants;scores;periods;events;league.country;round'), { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`Sportmonks API ${res.status}`);
        const json = await res.json() as SportmonksResponse;
        matches = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
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
    cache = overlayUnsupportedProvider(matches);
    return cache;
  } catch (err: unknown) {
    cache = buildProviderUnavailableFeed(err instanceof Error ? err.message : String(err));
    return cache;
  }
}
