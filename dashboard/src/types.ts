export type Outcome = 'home' | 'draw' | 'away';
export type FixtureStatus = 'upcoming' | 'open' | 'locked' | 'settled';
export type LogPrefix = 'RPC' | 'ORACLE' | 'METABOLISM' | 'STAKE' | 'SYSTEM';
export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface Team {
  name: string;
  code: string;
  flag: string;
  iso: string; // ISO 3166-1 alpha-2 lowercase — for flagcdn.com
}

export interface Fixture {
  id: string;
  matchday: number;
  group: string;
  home: Team;
  away: Team;
  kickoff: string;
  venue: string;
  status: FixtureStatus;
  result?: Outcome;
  baseOdds: { home: number; draw: number; away: number }; // pre-match % sum=100
}

export interface Pool {
  fixtureId: string;
  home: string;
  draw: string;
  away: string;
  fees: string;
  count: number;
}

export interface MetabolicState {
  okbBalance: string;
  okbBalanceFormatted: string;
  healthPercent: number;
  isRefuelNeeded: boolean;
  lastTxHash?: string;
  checkedAt: number;
}

export interface DaemonLog {
  id: number;
  ts: string;
  prefix: LogPrefix;
  level: LogLevel;
  message: string;
  txHash?: string;
}

export interface PayoutRecord {
  address: string;
  amountWei: string;
  txHash: string;
}

export interface SettlementResult {
  fixtureId: string;
  outcome: Outcome;
  totalPool: string;
  winnerCount: number;
  payouts: PayoutRecord[];
  blockNumber: number;
  explorerUrl: string;
}

export interface DaemonState {
  refereeAddress: string;
  metabolism: MetabolicState;
  fixtures: Fixture[];
  pools: Record<string, Pool>;
  recentLogs: DaemonLog[];
  lastBlock: number;
  wsConnected: boolean;
  settlements: SettlementResult[];
}

// Real FIFA World Cup 2026 Group Stage — Matchday 1 (confirmed draw, Dec 2024)
// Odds from Bet365 / Kalshi markets, normalized to sum 100
export const STATIC_FIXTURES: Fixture[] = [
  {
    id: 'grp-a-1', matchday: 1, group: 'A',
    home: { name: 'Mexico',       code: 'MEX', flag: '🇲🇽', iso: 'mx' },
    away: { name: 'South Africa', code: 'RSA', flag: '🇿🇦', iso: 'za' },
    kickoff: '2026-06-11T19:00:00Z', venue: 'Estadio Azteca · Mexico City', status: 'open',
    baseOdds: { home: 59, draw: 24, away: 17 },
  },
  {
    id: 'grp-b-1', matchday: 1, group: 'B',
    home: { name: 'Canada',            code: 'CAN', flag: '🇨🇦', iso: 'ca' },
    away: { name: 'Bosnia-Herzegovina', code: 'BIH', flag: '🇧🇦', iso: 'ba' },
    kickoff: '2026-06-12T19:00:00Z', venue: 'BMO Field · Toronto', status: 'open',
    baseOdds: { home: 48, draw: 27, away: 25 },
  },
  {
    id: 'grp-c-1', matchday: 1, group: 'C',
    home: { name: 'Brazil',  code: 'BRA', flag: '🇧🇷', iso: 'br' },
    away: { name: 'Morocco', code: 'MAR', flag: '🇲🇦', iso: 'ma' },
    kickoff: '2026-06-13T21:00:00Z', venue: 'MetLife Stadium · New Jersey', status: 'open',
    baseOdds: { home: 55, draw: 26, away: 19 },
  },
  {
    id: 'grp-d-1', matchday: 1, group: 'D',
    home: { name: 'USA',      code: 'USA', flag: '🇺🇸', iso: 'us' },
    away: { name: 'Paraguay', code: 'PAR', flag: '🇵🇾', iso: 'py' },
    kickoff: '2026-06-12T23:00:00Z', venue: 'SoFi Stadium · Los Angeles', status: 'open',
    baseOdds: { home: 51, draw: 27, away: 22 },
  },
  {
    id: 'grp-e-1', matchday: 1, group: 'E',
    home: { name: 'Germany',     code: 'GER', flag: '🇩🇪', iso: 'de' },
    away: { name: 'Ivory Coast', code: 'CIV', flag: '🇨🇮', iso: 'ci' },
    kickoff: '2026-06-13T17:00:00Z', venue: 'AT&T Stadium · Dallas', status: 'open',
    baseOdds: { home: 60, draw: 23, away: 17 },
  },
  {
    id: 'grp-f-1', matchday: 1, group: 'F',
    home: { name: 'Netherlands', code: 'NED', flag: '🇳🇱', iso: 'nl' },
    away: { name: 'Japan',       code: 'JPN', flag: '🇯🇵', iso: 'jp' },
    kickoff: '2026-06-14T17:00:00Z', venue: 'Rose Bowl · Los Angeles', status: 'open',
    baseOdds: { home: 49, draw: 28, away: 23 },
  },
  {
    id: 'grp-g-1', matchday: 1, group: 'G',
    home: { name: 'Belgium', code: 'BEL', flag: '🇧🇪', iso: 'be' },
    away: { name: 'Egypt',   code: 'EGY', flag: '🇪🇬', iso: 'eg' },
    kickoff: '2026-06-14T20:00:00Z', venue: 'Lumen Field · Seattle', status: 'open',
    baseOdds: { home: 66, draw: 21, away: 13 },
  },
  {
    id: 'grp-h-1', matchday: 1, group: 'H',
    home: { name: 'Spain',   code: 'ESP', flag: '🇪🇸', iso: 'es' },
    away: { name: 'Uruguay', code: 'URU', flag: '🇺🇾', iso: 'uy' },
    kickoff: '2026-06-15T17:00:00Z', venue: 'Hard Rock Stadium · Miami', status: 'open',
    baseOdds: { home: 48, draw: 28, away: 24 },
  },
  {
    id: 'grp-i-1', matchday: 1, group: 'I',
    home: { name: 'France',  code: 'FRA', flag: '🇫🇷', iso: 'fr' },
    away: { name: 'Senegal', code: 'SEN', flag: '🇸🇳', iso: 'sn' },
    kickoff: '2026-06-15T20:00:00Z', venue: 'Arrowhead Stadium · Kansas City', status: 'open',
    baseOdds: { home: 56, draw: 25, away: 19 },
  },
  {
    id: 'grp-j-1', matchday: 1, group: 'J',
    home: { name: 'Argentina', code: 'ARG', flag: '🇦🇷', iso: 'ar' },
    away: { name: 'Algeria',   code: 'ALG', flag: '🇩🇿', iso: 'dz' },
    kickoff: '2026-06-16T17:00:00Z', venue: 'Allegiant Stadium · Las Vegas', status: 'open',
    baseOdds: { home: 67, draw: 20, away: 13 },
  },
  {
    id: 'grp-k-1', matchday: 1, group: 'K',
    home: { name: 'Portugal', code: 'POR', flag: '🇵🇹', iso: 'pt' },
    away: { name: 'Colombia', code: 'COL', flag: '🇨🇴', iso: 'co' },
    kickoff: '2026-06-17T17:00:00Z', venue: 'NRG Stadium · Houston', status: 'open',
    baseOdds: { home: 47, draw: 28, away: 25 },
  },
  {
    id: 'grp-l-1', matchday: 1, group: 'L',
    home: { name: 'England', code: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', iso: 'gb-eng' },
    away: { name: 'Croatia', code: 'CRO', flag: '🇭🇷', iso: 'hr' },
    kickoff: '2026-06-18T17:00:00Z', venue: 'Gillette Stadium · Boston', status: 'open',
    baseOdds: { home: 50, draw: 28, away: 22 },
  },
];
