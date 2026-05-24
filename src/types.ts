export type Outcome = 'home' | 'draw' | 'away';
export type FixtureStatus = 'upcoming' | 'open' | 'locked' | 'settled';
export type LogPrefix = 'RPC' | 'ORACLE' | 'METABOLISM' | 'STAKE' | 'SYSTEM';
export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface Team {
  name: string;
  code: string;
  flag: string;
  iso: string;
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
  baseOdds: { home: number; draw: number; away: number };
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
