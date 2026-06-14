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
  provider?: 'sportmonks' | 'wc2026api' | 'balldontlie' | 'zafronix' | 'static';
  providerId?: string;
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

export interface PenaltyKick {
  team: 'home' | 'away';
  player: string;
  scored: boolean;
  round: number;
}

export interface MatchState {
  fixtureId: string;
  status: 'scheduled' | 'live' | 'half_time' | 'finished';
  minute: number;
  homeScore: number;
  awayScore: number;
  events: MatchEvent[];
  simulatedKickoff: string;
  possession: number;
  finishedAt?: number;
  penaltyShootout?: {
    homeScore: number;
    awayScore: number;
    kicks: PenaltyKick[];
  };
  penaltyWinner?: 'home' | 'away';
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
  fixture?: Fixture;
  outcome: Outcome;
  totalPool: string;
  winnerCount: number;
  payouts: PayoutRecord[];
  blockNumber: number;
  explorerUrl: string;
  settledAt: number;
}

export interface Stake {
  txHash: string;
  staker: string;
  fixtureId: string;
  fixture?: Fixture;
  outcome: Outcome;
  amountWei: string;
  blockNumber: number;
  timestamp: number;
}

export interface ChampionStake {
  txHash: string;
  staker: string;
  teamCode: string;
  amountWei: string;
  blockNumber: number;
  timestamp: number;
}

export interface RejectedStakeRefund {
  txHash: string;
  staker: string;
  fixtureId: string;
  fixture?: Fixture;
  outcome: Outcome;
  amountWei: string;
  reason: string;
  status: 'queued' | 'refunded' | 'failed';
  refundTxHash?: string;
  error?: string;
  timestamp: number;
}

export type UserPosition =
  | {
      type: 'match';
      status: 'active' | 'paid' | 'won_pending_payout' | 'lost';
      stake: Stake;
      fixture?: Fixture;
      settlement?: SettlementResult;
      payout?: PayoutRecord;
    }
  | {
      type: 'champion';
      status: 'active' | 'settled_winner' | 'settled_lost';
      stake: ChampionStake;
      winner?: string;
      settledAt?: number;
      seasonNumber?: number;
      payout?: PayoutRecord;
    }
  | {
      type: 'refund';
      status: 'queued' | 'refunded' | 'failed';
      refund: RejectedStakeRefund;
    };

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
  rejectedStakeRefunds?: RejectedStakeRefund[];
  matchStates: Record<string, MatchState>;
  simulationMode: boolean;
  championPool?: ChampionPool;
}

// ── Retired local fixture exports ────────────────────────────────────────────

export const STATIC_FIXTURES: Fixture[] = [];

// Realtime World Cup fixtures are supplied at runtime.

export const REALTIME_FIXTURES: Fixture[] = [];
