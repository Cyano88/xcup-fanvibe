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

// ── Static fallback fixtures (shown when daemon is offline) ──────────────────

const S = (name: string, city: string, country: string, capacity: number) => ({ name, city, country, capacity });
const T = (name: string, code: string, flag: string, iso: string) => ({ name, code, flag, iso });

export const STATIC_FIXTURES: Fixture[] = [];

// ── Official FIFA WC 2026 fixtures — all 12 groups, MD1 + MD2 ─────────────────
// Groups A-L per the official draw. Staking open now, settle on match day.

export const REALTIME_FIXTURES: Fixture[] = [
  // ── Group A: MEX · RSA · KOR · CZE ──────────────────────────────────────────
  { id:'wc-a1', matchday:1, group:'A', mode:'realtime', home:T('Mexico','MEX','🇲🇽','mx'),          away:T('South Africa','RSA','🇿🇦','za'),      kickoff:'2026-06-11T18:00:00Z', venue:'Estadio Azteca · Mexico City',       stadium:S('Estadio Azteca','Mexico City','Mexico',87523),           status:'open', baseOdds:{ home:55, draw:26, away:19 } },
  { id:'wc-a2', matchday:1, group:'A', mode:'realtime', home:T('South Korea','KOR','🇰🇷','kr'),      away:T('Czech Republic','CZE','🇨🇿','cz'),    kickoff:'2026-06-11T21:00:00Z', venue:'NRG Stadium · Houston',              stadium:S('NRG Stadium','Houston, TX','USA',72220),                 status:'open', baseOdds:{ home:44, draw:29, away:27 } },
  { id:'wc-a3', matchday:2, group:'A', mode:'realtime', home:T('Mexico','MEX','🇲🇽','mx'),          away:T('South Korea','KOR','🇰🇷','kr'),        kickoff:'2026-06-20T18:00:00Z', venue:'MetLife Stadium · East Rutherford',   stadium:S('MetLife Stadium','East Rutherford, NJ','USA',82500),     status:'open', baseOdds:{ home:48, draw:27, away:25 } },
  { id:'wc-a4', matchday:2, group:'A', mode:'realtime', home:T('South Africa','RSA','🇿🇦','za'),     away:T('Czech Republic','CZE','🇨🇿','cz'),    kickoff:'2026-06-20T21:00:00Z', venue:'AT&T Stadium · Arlington',           stadium:S('AT&T Stadium','Arlington, TX','USA',80000),              status:'open', baseOdds:{ home:38, draw:28, away:34 } },
  // ── Group B: CAN · BIH · QAT · SUI ─────────────────────────────────────────
  { id:'wc-b1', matchday:1, group:'B', mode:'realtime', home:T('Canada','CAN','🇨🇦','ca'),           away:T('Bosnia & Herz.','BIH','🇧🇦','ba'),    kickoff:'2026-06-12T00:00:00Z', venue:'BMO Field · Toronto',                 stadium:S('BMO Field','Toronto','Canada',45000),                    status:'open', baseOdds:{ home:52, draw:26, away:22 } },
  { id:'wc-b2', matchday:1, group:'B', mode:'realtime', home:T('Qatar','QAT','🇶🇦','qa'),            away:T('Switzerland','SUI','🇨🇭','ch'),       kickoff:'2026-06-12T03:00:00Z', venue:'Allegiant Stadium · Las Vegas',       stadium:S('Allegiant Stadium','Las Vegas, NV','USA',65000),         status:'open', baseOdds:{ home:35, draw:27, away:38 } },
  { id:'wc-b3', matchday:2, group:'B', mode:'realtime', home:T('Canada','CAN','🇨🇦','ca'),           away:T('Qatar','QAT','🇶🇦','qa'),             kickoff:'2026-06-21T00:00:00Z', venue:'BC Place · Vancouver',                stadium:S('BC Place','Vancouver','Canada',54500),                   status:'open', baseOdds:{ home:56, draw:25, away:19 } },
  { id:'wc-b4', matchday:2, group:'B', mode:'realtime', home:T('Bosnia & Herz.','BIH','🇧🇦','ba'),  away:T('Switzerland','SUI','🇨🇭','ch'),       kickoff:'2026-06-21T03:00:00Z', venue:'Arrowhead Stadium · Kansas City',    stadium:S('Arrowhead Stadium','Kansas City, MO','USA',76416),       status:'open', baseOdds:{ home:40, draw:28, away:32 } },
  // ── Group C: BRA · MAR · HAI · SCO ─────────────────────────────────────────
  { id:'wc-c1', matchday:1, group:'C', mode:'realtime', home:T('Brazil','BRA','🇧🇷','br'),           away:T('Morocco','MAR','🇲🇦','ma'),           kickoff:'2026-06-12T18:00:00Z', venue:'Rose Bowl Stadium · Pasadena',        stadium:S('Rose Bowl Stadium','Pasadena, CA','USA',88565),          status:'open', baseOdds:{ home:56, draw:24, away:20 } },
  { id:'wc-c2', matchday:1, group:'C', mode:'realtime', home:T('Haiti','HAI','🇭🇹','ht'),            away:T('Scotland','SCO','🏴󠁧󠁢󠁳󠁣󠁴󠁿','gb-sct'), kickoff:'2026-06-12T21:00:00Z', venue:'Hard Rock Stadium · Miami Gardens',   stadium:S('Hard Rock Stadium','Miami Gardens, FL','USA',64767),     status:'open', baseOdds:{ home:34, draw:27, away:39 } },
  { id:'wc-c3', matchday:2, group:'C', mode:'realtime', home:T('Brazil','BRA','🇧🇷','br'),           away:T('Haiti','HAI','🇭🇹','ht'),             kickoff:'2026-06-21T18:00:00Z', venue:'SoFi Stadium · Inglewood',            stadium:S('SoFi Stadium','Inglewood, CA','USA',70240),              status:'open', baseOdds:{ home:78, draw:15, away:7 } },
  { id:'wc-c4', matchday:2, group:'C', mode:'realtime', home:T('Morocco','MAR','🇲🇦','ma'),          away:T('Scotland','SCO','🏴󠁧󠁢󠁳󠁣󠁴󠁿','gb-sct'), kickoff:'2026-06-21T21:00:00Z', venue:'Lumen Field · Seattle',               stadium:S('Lumen Field','Seattle, WA','USA',68740),                 status:'open', baseOdds:{ home:50, draw:27, away:23 } },
  // ── Group D: USA · PAR · AUS · TUR ─────────────────────────────────────────
  { id:'wc-d1', matchday:1, group:'D', mode:'realtime', home:T('United States','USA','🇺🇸','us'),    away:T('Paraguay','PAR','🇵🇾','py'),          kickoff:'2026-06-13T00:00:00Z', venue:'Gillette Stadium · Foxborough',       stadium:S('Gillette Stadium','Foxborough, MA','USA',65878),         status:'open', baseOdds:{ home:50, draw:26, away:24 } },
  { id:'wc-d2', matchday:1, group:'D', mode:'realtime', home:T('Australia','AUS','🇦🇺','au'),        away:T('Turkey','TUR','🇹🇷','tr'),            kickoff:'2026-06-13T03:00:00Z', venue:'Mercedes-Benz Stadium · Atlanta',     stadium:S('Mercedes-Benz Stadium','Atlanta, GA','USA',75000),       status:'open', baseOdds:{ home:43, draw:28, away:29 } },
  { id:'wc-d3', matchday:2, group:'D', mode:'realtime', home:T('United States','USA','🇺🇸','us'),    away:T('Australia','AUS','🇦🇺','au'),         kickoff:'2026-06-22T00:00:00Z', venue:'MetLife Stadium · East Rutherford',   stadium:S('MetLife Stadium','East Rutherford, NJ','USA',82500),     status:'open', baseOdds:{ home:47, draw:28, away:25 } },
  { id:'wc-d4', matchday:2, group:'D', mode:'realtime', home:T('Paraguay','PAR','🇵🇾','py'),         away:T('Turkey','TUR','🇹🇷','tr'),            kickoff:'2026-06-22T03:00:00Z', venue:'Lincoln Financial Field · Philadelphia', stadium:S('Lincoln Financial Field','Philadelphia, PA','USA',69328), status:'open', baseOdds:{ home:41, draw:28, away:31 } },
  // ── Group E: GER · CUW · CIV · ECU ─────────────────────────────────────────
  { id:'wc-e1', matchday:1, group:'E', mode:'realtime', home:T('Germany','GER','🇩🇪','de'),          away:T('Curaçao','CUW','🇨🇼','cw'),           kickoff:'2026-06-13T18:00:00Z', venue:'AT&T Stadium · Arlington',           stadium:S('AT&T Stadium','Arlington, TX','USA',80000),              status:'open', baseOdds:{ home:76, draw:16, away:8 } },
  { id:'wc-e2', matchday:1, group:'E', mode:'realtime', home:T('Ivory Coast','CIV','🇨🇮','ci'),      away:T('Ecuador','ECU','🇪🇨','ec'),           kickoff:'2026-06-13T21:00:00Z', venue:'Estadio BBVA · Monterrey',           stadium:S('Estadio BBVA','Monterrey','Mexico',51348),               status:'open', baseOdds:{ home:46, draw:28, away:26 } },
  { id:'wc-e3', matchday:2, group:'E', mode:'realtime', home:T('Germany','GER','🇩🇪','de'),          away:T('Ivory Coast','CIV','🇨🇮','ci'),       kickoff:'2026-06-22T18:00:00Z', venue:'NRG Stadium · Houston',              stadium:S('NRG Stadium','Houston, TX','USA',72220),                 status:'open', baseOdds:{ home:56, draw:24, away:20 } },
  { id:'wc-e4', matchday:2, group:'E', mode:'realtime', home:T('Curaçao','CUW','🇨🇼','cw'),         away:T('Ecuador','ECU','🇪🇨','ec'),           kickoff:'2026-06-22T21:00:00Z', venue:'Empower Field · Denver',             stadium:S('Empower Field at Mile High','Denver, CO','USA',76125),   status:'open', baseOdds:{ home:32, draw:27, away:41 } },
  // ── Group F: NED · JPN · SWE · TUN ─────────────────────────────────────────
  { id:'wc-f1', matchday:1, group:'F', mode:'realtime', home:T('Netherlands','NED','🇳🇱','nl'),      away:T('Japan','JPN','🇯🇵','jp'),             kickoff:'2026-06-14T00:00:00Z', venue:"Levi's Stadium · Santa Clara",        stadium:S("Levi's Stadium",'Santa Clara, CA','USA',68500),          status:'open', baseOdds:{ home:52, draw:26, away:22 } },
  { id:'wc-f2', matchday:1, group:'F', mode:'realtime', home:T('Sweden','SWE','🇸🇪','se'),           away:T('Tunisia','TUN','🇹🇳','tn'),           kickoff:'2026-06-14T03:00:00Z', venue:'Rose Bowl Stadium · Pasadena',        stadium:S('Rose Bowl Stadium','Pasadena, CA','USA',88565),          status:'open', baseOdds:{ home:54, draw:25, away:21 } },
  { id:'wc-f3', matchday:2, group:'F', mode:'realtime', home:T('Netherlands','NED','🇳🇱','nl'),      away:T('Sweden','SWE','🇸🇪','se'),            kickoff:'2026-06-23T00:00:00Z', venue:'MetLife Stadium · East Rutherford',   stadium:S('MetLife Stadium','East Rutherford, NJ','USA',82500),     status:'open', baseOdds:{ home:47, draw:27, away:26 } },
  { id:'wc-f4', matchday:2, group:'F', mode:'realtime', home:T('Japan','JPN','🇯🇵','jp'),            away:T('Tunisia','TUN','🇹🇳','tn'),           kickoff:'2026-06-23T03:00:00Z', venue:'Estadio Akron · Guadalajara',        stadium:S('Estadio Akron','Guadalajara','Mexico',49850),            status:'open', baseOdds:{ home:51, draw:26, away:23 } },
  // ── Group G: BEL · EGY · IRN · NZL ─────────────────────────────────────────
  { id:'wc-g1', matchday:1, group:'G', mode:'realtime', home:T('Belgium','BEL','🇧🇪','be'),          away:T('Egypt','EGY','🇪🇬','eg'),             kickoff:'2026-06-14T18:00:00Z', venue:'Mercedes-Benz Stadium · Atlanta',    stadium:S('Mercedes-Benz Stadium','Atlanta, GA','USA',75000),       status:'open', baseOdds:{ home:56, draw:24, away:20 } },
  { id:'wc-g2', matchday:1, group:'G', mode:'realtime', home:T('Iran','IRN','🇮🇷','ir'),             away:T('New Zealand','NZL','🇳🇿','nz'),       kickoff:'2026-06-14T21:00:00Z', venue:'Gillette Stadium · Foxborough',       stadium:S('Gillette Stadium','Foxborough, MA','USA',65878),         status:'open', baseOdds:{ home:52, draw:26, away:22 } },
  { id:'wc-g3', matchday:2, group:'G', mode:'realtime', home:T('Belgium','BEL','🇧🇪','be'),          away:T('Iran','IRN','🇮🇷','ir'),              kickoff:'2026-06-23T18:00:00Z', venue:'SoFi Stadium · Inglewood',            stadium:S('SoFi Stadium','Inglewood, CA','USA',70240),              status:'open', baseOdds:{ home:57, draw:24, away:19 } },
  { id:'wc-g4', matchday:2, group:'G', mode:'realtime', home:T('Egypt','EGY','🇪🇬','eg'),            away:T('New Zealand','NZL','🇳🇿','nz'),       kickoff:'2026-06-23T21:00:00Z', venue:'Allegiant Stadium · Las Vegas',       stadium:S('Allegiant Stadium','Las Vegas, NV','USA',65000),         status:'open', baseOdds:{ home:56, draw:24, away:20 } },
  // ── Group H: ESP · CPV · KSA · URU ─────────────────────────────────────────
  { id:'wc-h1', matchday:1, group:'H', mode:'realtime', home:T('Spain','ESP','🇪🇸','es'),            away:T('Cape Verde','CPV','🇨🇻','cv'),        kickoff:'2026-06-15T00:00:00Z', venue:'Estadio Azteca · Mexico City',        stadium:S('Estadio Azteca','Mexico City','Mexico',87523),           status:'open', baseOdds:{ home:70, draw:20, away:10 } },
  { id:'wc-h2', matchday:1, group:'H', mode:'realtime', home:T('Saudi Arabia','KSA','🇸🇦','sa'),     away:T('Uruguay','URU','🇺🇾','uy'),           kickoff:'2026-06-15T03:00:00Z', venue:'BC Place · Vancouver',                stadium:S('BC Place','Vancouver','Canada',54500),                   status:'open', baseOdds:{ home:40, draw:27, away:33 } },
  { id:'wc-h3', matchday:2, group:'H', mode:'realtime', home:T('Spain','ESP','🇪🇸','es'),            away:T('Saudi Arabia','KSA','🇸🇦','sa'),      kickoff:'2026-06-24T00:00:00Z', venue:'AT&T Stadium · Arlington',            stadium:S('AT&T Stadium','Arlington, TX','USA',80000),              status:'open', baseOdds:{ home:60, draw:23, away:17 } },
  { id:'wc-h4', matchday:2, group:'H', mode:'realtime', home:T('Cape Verde','CPV','🇨🇻','cv'),       away:T('Uruguay','URU','🇺🇾','uy'),           kickoff:'2026-06-24T03:00:00Z', venue:'BMO Field · Toronto',                 stadium:S('BMO Field','Toronto','Canada',45000),                    status:'open', baseOdds:{ home:33, draw:27, away:40 } },
  // ── Group I: FRA · SEN · IRQ · NOR ─────────────────────────────────────────
  { id:'wc-i1', matchday:1, group:'I', mode:'realtime', home:T('France','FRA','🇫🇷','fr'),           away:T('Iraq','IRQ','🇮🇶','iq'),              kickoff:'2026-06-15T18:00:00Z', venue:'Rose Bowl Stadium · Pasadena',        stadium:S('Rose Bowl Stadium','Pasadena, CA','USA',88565),          status:'open', baseOdds:{ home:70, draw:19, away:11 } },
  { id:'wc-i2', matchday:1, group:'I', mode:'realtime', home:T('Senegal','SEN','🇸🇳','sn'),          away:T('Norway','NOR','🇳🇴','no'),            kickoff:'2026-06-15T21:00:00Z', venue:'Arrowhead Stadium · Kansas City',    stadium:S('Arrowhead Stadium','Kansas City, MO','USA',76416),       status:'open', baseOdds:{ home:44, draw:30, away:26 } },
  { id:'wc-i3', matchday:2, group:'I', mode:'realtime', home:T('France','FRA','🇫🇷','fr'),           away:T('Senegal','SEN','🇸🇳','sn'),           kickoff:'2026-06-24T18:00:00Z', venue:'Lumen Field · Seattle',               stadium:S('Lumen Field','Seattle, WA','USA',68740),                 status:'open', baseOdds:{ home:55, draw:24, away:21 } },
  { id:'wc-i4', matchday:2, group:'I', mode:'realtime', home:T('Iraq','IRQ','🇮🇶','iq'),             away:T('Norway','NOR','🇳🇴','no'),            kickoff:'2026-06-24T21:00:00Z', venue:'Lincoln Financial Field · Philadelphia', stadium:S('Lincoln Financial Field','Philadelphia, PA','USA',69328), status:'open', baseOdds:{ home:36, draw:27, away:37 } },
  // ── Group J: ARG · ALG · AUT · JOR ─────────────────────────────────────────
  { id:'wc-j1', matchday:1, group:'J', mode:'realtime', home:T('Argentina','ARG','🇦🇷','ar'),        away:T('Jordan','JOR','🇯🇴','jo'),            kickoff:'2026-06-16T00:00:00Z', venue:'Estadio Akron · Guadalajara',        stadium:S('Estadio Akron','Guadalajara','Mexico',49850),            status:'open', baseOdds:{ home:72, draw:17, away:11 } },
  { id:'wc-j2', matchday:1, group:'J', mode:'realtime', home:T('Algeria','ALG','🇩🇿','dz'),          away:T('Austria','AUT','🇦🇹','at'),           kickoff:'2026-06-16T03:00:00Z', venue:'Empower Field · Denver',             stadium:S('Empower Field at Mile High','Denver, CO','USA',76125),   status:'open', baseOdds:{ home:43, draw:28, away:29 } },
  { id:'wc-j3', matchday:2, group:'J', mode:'realtime', home:T('Argentina','ARG','🇦🇷','ar'),        away:T('Algeria','ALG','🇩🇿','dz'),           kickoff:'2026-06-25T00:00:00Z', venue:'MetLife Stadium · East Rutherford',   stadium:S('MetLife Stadium','East Rutherford, NJ','USA',82500),     status:'open', baseOdds:{ home:62, draw:22, away:16 } },
  { id:'wc-j4', matchday:2, group:'J', mode:'realtime', home:T('Austria','AUT','🇦🇹','at'),          away:T('Jordan','JOR','🇯🇴','jo'),            kickoff:'2026-06-25T03:00:00Z', venue:'NRG Stadium · Houston',              stadium:S('NRG Stadium','Houston, TX','USA',72220),                 status:'open', baseOdds:{ home:57, draw:25, away:18 } },
  // ── Group K: POR · COD · UZB · COL ─────────────────────────────────────────
  { id:'wc-k1', matchday:1, group:'K', mode:'realtime', home:T('Portugal','POR','🇵🇹','pt'),         away:T('DR Congo','COD','🇨🇩','cd'),          kickoff:'2026-06-16T18:00:00Z', venue:'Estadio BBVA · Monterrey',           stadium:S('Estadio BBVA','Monterrey','Mexico',51348),               status:'open', baseOdds:{ home:62, draw:23, away:15 } },
  { id:'wc-k2', matchday:1, group:'K', mode:'realtime', home:T('Uzbekistan','UZB','🇺🇿','uz'),       away:T('Colombia','COL','🇨🇴','co'),          kickoff:'2026-06-16T21:00:00Z', venue:'Hard Rock Stadium · Miami Gardens',   stadium:S('Hard Rock Stadium','Miami Gardens, FL','USA',64767),     status:'open', baseOdds:{ home:37, draw:27, away:36 } },
  { id:'wc-k3', matchday:2, group:'K', mode:'realtime', home:T('Portugal','POR','🇵🇹','pt'),         away:T('Uzbekistan','UZB','🇺🇿','uz'),        kickoff:'2026-06-25T18:00:00Z', venue:"Levi's Stadium · Santa Clara",        stadium:S("Levi's Stadium",'Santa Clara, CA','USA',68500),          status:'open', baseOdds:{ home:66, draw:21, away:13 } },
  { id:'wc-k4', matchday:2, group:'K', mode:'realtime', home:T('DR Congo','COD','🇨🇩','cd'),         away:T('Colombia','COL','🇨🇴','co'),          kickoff:'2026-06-25T21:00:00Z', venue:'Mercedes-Benz Stadium · Atlanta',     stadium:S('Mercedes-Benz Stadium','Atlanta, GA','USA',75000),       status:'open', baseOdds:{ home:42, draw:27, away:31 } },
  // ── Group L: ENG · CRO · GHA · PAN ─────────────────────────────────────────
  { id:'wc-l1', matchday:1, group:'L', mode:'realtime', home:T('England','ENG','🏴󠁧󠁢󠁥󠁮󠁧󠁿','gb-eng'),   away:T('Ghana','GHA','🇬🇭','gh'),             kickoff:'2026-06-17T00:00:00Z', venue:'Gillette Stadium · Foxborough',       stadium:S('Gillette Stadium','Foxborough, MA','USA',65878),         status:'open', baseOdds:{ home:62, draw:22, away:16 } },
  { id:'wc-l2', matchday:1, group:'L', mode:'realtime', home:T('Croatia','CRO','🇭🇷','hr'),          away:T('Panama','PAN','🇵🇦','pa'),            kickoff:'2026-06-17T03:00:00Z', venue:'Lincoln Financial Field · Philadelphia', stadium:S('Lincoln Financial Field','Philadelphia, PA','USA',69328), status:'open', baseOdds:{ home:60, draw:24, away:16 } },
  { id:'wc-l3', matchday:2, group:'L', mode:'realtime', home:T('England','ENG','🏴󠁧󠁢󠁥󠁮󠁧󠁿','gb-eng'),   away:T('Croatia','CRO','🇭🇷','hr'),           kickoff:'2026-06-26T00:00:00Z', venue:'Allegiant Stadium · Las Vegas',       stadium:S('Allegiant Stadium','Las Vegas, NV','USA',65000),         status:'open', baseOdds:{ home:47, draw:27, away:26 } },
  { id:'wc-l4', matchday:2, group:'L', mode:'realtime', home:T('Ghana','GHA','🇬🇭','gh'),            away:T('Panama','PAN','🇵🇦','pa'),            kickoff:'2026-06-26T03:00:00Z', venue:'BC Place · Vancouver',                stadium:S('BC Place','Vancouver','Canada',54500),                   status:'open', baseOdds:{ home:53, draw:25, away:22 } },
];
