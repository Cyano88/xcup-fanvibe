export type Outcome = 'home' | 'draw' | 'away';
export type FixtureStatus = 'upcoming' | 'open' | 'locked' | 'settled';
export type LogPrefix = 'RPC' | 'ORACLE' | 'METABOLISM' | 'STAKE' | 'SYSTEM';
export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface Team {
  name: string;
  code: string;
  flag: string;
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

// Static fixtures shown when backend is offline
export const STATIC_FIXTURES: Fixture[] = [
  { id: 'grp-a-1', matchday: 1, group: 'A', home: { name: 'Mexico', code: 'MEX', flag: '🇲🇽' }, away: { name: 'Croatia', code: 'CRO', flag: '🇭🇷' }, kickoff: '2026-06-11T20:00:00Z', venue: 'AT&T Stadium · Dallas', status: 'open' },
  { id: 'grp-a-2', matchday: 1, group: 'A', home: { name: 'Belgium', code: 'BEL', flag: '🇧🇪' }, away: { name: 'Morocco', code: 'MAR', flag: '🇲🇦' }, kickoff: '2026-06-11T23:00:00Z', venue: "Levi's Stadium · San Francisco", status: 'open' },
  { id: 'grp-b-1', matchday: 1, group: 'B', home: { name: 'Brazil', code: 'BRA', flag: '🇧🇷' }, away: { name: 'Germany', code: 'GER', flag: '🇩🇪' }, kickoff: '2026-06-12T17:00:00Z', venue: 'MetLife Stadium · New York', status: 'open' },
  { id: 'grp-b-2', matchday: 1, group: 'B', home: { name: 'Switzerland', code: 'SUI', flag: '🇨🇭' }, away: { name: 'Canada', code: 'CAN', flag: '🇨🇦' }, kickoff: '2026-06-12T20:00:00Z', venue: 'Gillette Stadium · Boston', status: 'open' },
  { id: 'grp-c-1', matchday: 1, group: 'C', home: { name: 'France', code: 'FRA', flag: '🇫🇷' }, away: { name: 'Australia', code: 'AUS', flag: '🇦🇺' }, kickoff: '2026-06-13T17:00:00Z', venue: 'SoFi Stadium · Los Angeles', status: 'open' },
  { id: 'grp-d-1', matchday: 1, group: 'D', home: { name: 'England', code: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' }, away: { name: 'Spain', code: 'ESP', flag: '🇪🇸' }, kickoff: '2026-06-13T20:00:00Z', venue: 'Rose Bowl · Los Angeles', status: 'open' },
  { id: 'grp-e-1', matchday: 1, group: 'E', home: { name: 'Argentina', code: 'ARG', flag: '🇦🇷' }, away: { name: 'France', code: 'FRA', flag: '🇫🇷' }, kickoff: '2026-06-14T17:00:00Z', venue: 'Arrowhead · Kansas City', status: 'open' },
  { id: 'grp-f-1', matchday: 1, group: 'F', home: { name: 'Portugal', code: 'POR', flag: '🇵🇹' }, away: { name: 'Morocco', code: 'MAR', flag: '🇲🇦' }, kickoff: '2026-06-15T17:00:00Z', venue: 'Lumen Field · Seattle', status: 'open' },
  { id: 'grp-g-1', matchday: 1, group: 'G', home: { name: 'USA', code: 'USA', flag: '🇺🇸' }, away: { name: 'Netherlands', code: 'NED', flag: '🇳🇱' }, kickoff: '2026-06-15T20:00:00Z', venue: 'SoFi Stadium · Los Angeles', status: 'open' },
  { id: 'grp-h-1', matchday: 1, group: 'H', home: { name: 'Senegal', code: 'SEN', flag: '🇸🇳' }, away: { name: 'Nigeria', code: 'NGA', flag: '🇳🇬' }, kickoff: '2026-06-16T17:00:00Z', venue: 'AT&T Stadium · Dallas', status: 'open' },
];
