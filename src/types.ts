export type Outcome = 'home' | 'draw' | 'away';
export type FixtureStatus = 'upcoming' | 'open' | 'locked' | 'settled';
export type TournamentRound = 'R32' | 'R16' | 'QF' | 'SF' | '3PL' | 'F';
export type LogPrefix = 'RPC' | 'ORACLE' | 'METABOLISM' | 'STAKE' | 'SYSTEM';
export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface Team {
  name: string;
  code: string;
  flag: string;
  iso: string;
  players?: string[];
}

export interface Stadium {
  name: string;
  city: string;
  country: string;
  capacity: number;
}

export interface Fixture {
  id: string;
  matchday: number;
  group: string;
  round?: TournamentRound;
  home: Team;
  away: Team;
  kickoff: string;
  venue: string;
  stadium?: Stadium;
  status: FixtureStatus;
  result?: Outcome;
  baseOdds: { home: number; draw: number; away: number };
  simulatedKickoff?: string;
  mode: 'realtime' | 'simulated';
}

export interface MatchEvent {
  id: number;
  minute: number;
  type: string;
  team: 'home' | 'away' | 'neutral';
  commentary: string;
  player?: string;
  player2?: string;
  lx?: number;
  ly?: number;
}

export interface MatchState {
  fixtureId: string;
  status: 'scheduled' | 'live' | 'finished';
  minute: number;
  homeScore: number;
  awayScore: number;
  events: MatchEvent[];
  simulatedKickoff: string;
  possession: number;
}

export interface Stake {
  txHash: string;
  staker: string;
  fixtureId: string;
  outcome: Outcome;
  amountWei: string;
  blockNumber: number;
  timestamp: number;
}

export interface Pool {
  fixtureId: string;
  home: string;
  draw: string;
  away: string;
  fees: string;
  count: number;
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

export interface ChampionStake {
  txHash: string;
  staker: string;
  teamCode: string;
  amountWei: string;
  blockNumber: number;
  timestamp: number;
}

export interface ChampionPool {
  byTeam: Record<string, string>; // teamCode → net wei staked
  totalWei: string;
  count: number;
  settled: boolean;
  winner?: string;
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
  matchStates: Record<string, MatchState>;
  simulationMode: boolean;
  championPool: ChampionPool;
}
