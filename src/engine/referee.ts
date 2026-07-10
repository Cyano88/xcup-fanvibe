import {
  createPublicClient,
  createWalletClient,
  webSocket,
  formatEther,
  parseEther,
  recoverMessageAddress,
  encodeAbiParameters,
  decodeAbiParameters,
  toHex,
  type PublicClient,
  type WalletClient,
  type PrivateKeyAccount,
  type Address,
  type Block,
  type Transaction,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { xLayerHttpTransport, xLayerMainnet, explorerTx } from '../chain.js';
import { checkAndRefuel } from './metabolism.js';
import { readRefereeMarket, writeRefereeMarket, type PersistedChampionPosition, type PersistedSettlementJob } from '../seasonStore.js';
import type {
  Fixture,
  Stake,
  Pool,
  DaemonLog,
  DaemonState,
  MatchState,
  MetabolicState,
  Outcome,
  SettlementResult,
  RejectedStakeRefund,
  ChampionStake,
  ChampionPool,
  LogPrefix,
  LogLevel,
} from '../types.js';

const PROTOCOL_FEE_BPS = 50n; // 0.5%
const METABOLISM_INTERVAL_MS = 60_000;
const OUTCOME_MAP: Record<number, Outcome> = { 0: 'home', 1: 'draw', 2: 'away' };
const OUTCOME_INDEX: Record<Outcome, number> = { home: 0, draw: 1, away: 2 };
const MAX_PERSISTED_SETTLEMENTS = Math.max(20, Number(process.env.MAX_PERSISTED_SETTLEMENTS ?? '200'));
const MAX_PERSISTED_SETTLEMENT_JOBS = Math.max(20, Number(process.env.MAX_PERSISTED_SETTLEMENT_JOBS ?? '200'));
const MATCHDAY_VOLUME_POINT_WEI = 1_000_000_000_000_000n; // 0.001 OKB
const MATCHDAY_WIN_BONUS_POINTS = 5_000;
const MATCHDAY_ACTIVE_BONUS_POINTS = 500;
const MATCHDAY_POSITION_BONUS_POINTS = 250;
const UNRESOLVED_TEAM_CODES = new Set(['TBD', '1ST', '2ND', '3RD', 'WIN', 'LOS']);
const REFEREE_BLOCK_POLL_INTERVAL_MS = Math.max(12_000, Number(process.env.REFEREE_BLOCK_POLL_INTERVAL_MS ?? '60000'));
const REFEREE_BLOCK_POLL_MAX_BLOCKS = Math.max(1, Number(process.env.REFEREE_BLOCK_POLL_MAX_BLOCKS ?? '6'));
const REFEREE_BLOCK_POLL_RECENT_BLOCKS = Math.max(0, Number(process.env.REFEREE_BLOCK_POLL_RECENT_BLOCKS ?? '0'));

// ── Champion prediction market ─────────────────────────────────────────────────
export const CHAMP_FIXTURE_ID = 'champion-2026';
export const CHAMP_TEAMS = [
  'CAN','MEX','USA','AUS','IRQ','IRN','JPN','JOR',
  'KOR','QAT','KSA','UZB','ALG','CPV','COD','CIV',
  'EGY','GHA','MAR','SEN','RSA','TUN','CUW','HAI',
  'PAN','ARG','BRA','COL','ECU','PAR','URU','NZL',
  'AUT','BEL','BIH','CRO','CZE','ENG','FRA','GER',
  'NED','NOR','POR','SCO','ESP','SWE','SUI','TUR',
];

// ── Calldata codec ─────────────────────────────────────────────────────────────
export function encodeStake(fixtureId: string, outcome: Outcome): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint8' }],
    [toHex(fixtureId, { size: 32 }), OUTCOME_INDEX[outcome]],
  );
}

export function encodeChampionStake(teamCode: string): `0x${string}` {
  const idx = CHAMP_TEAMS.indexOf(teamCode);
  if (idx === -1) throw new Error(`Unknown champion team: ${teamCode}`);
  return encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint8' }],
    [toHex(CHAMP_FIXTURE_ID, { size: 32 }), idx],
  );
}

type DecodedTx =
  | { kind: 'match';    fixtureId: string; outcome: Outcome }
  | { kind: 'champion'; teamCode: string };

function decodeStakeTx(data: `0x${string}`): DecodedTx {
  if (!data || data.length < 66) throw new Error('insufficient calldata');
  const [fixtureBytes32, secondParam] = decodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint8' }],
    data,
  );
  const raw = Buffer.from(fixtureBytes32.slice(2), 'hex').toString('utf8').replace(/\0+$/, '');

  if (raw === CHAMP_FIXTURE_ID) {
    const teamCode = CHAMP_TEAMS[Number(secondParam)];
    if (!teamCode) throw new Error(`invalid champion team index ${secondParam}`);
    return { kind: 'champion', teamCode };
  }

  const outcome = OUTCOME_MAP[Number(secondParam)];
  if (!outcome) throw new Error(`invalid outcome index ${secondParam}`);
  return { kind: 'match', fixtureId: raw, outcome };
}

// ── RefereeEngine ──────────────────────────────────────────────────────────────
export class RefereeEngine {
  private readonly account: PrivateKeyAccount;
  private readonly httpClient: PublicClient;
  private readonly walletClient: WalletClient;

  private fixtures: Fixture[] = [];
  private stakes = new Map<string, Stake>();
  private rejectedStakeRefunds = new Map<string, RejectedStakeRefund>();
  private pools = new Map<string, Pool>();
  private settlements: SettlementResult[] = [];
  private settlementJobs = new Map<string, PersistedSettlementJob>();
  private champStakes: ChampionStake[] = [];
  private champHistory: PersistedChampionPosition[] = [];
  private champPool = new Map<string, bigint>(CHAMP_TEAMS.map(t => [t, 0n]));
  private champSettled = false;
  private champWinner?: string;
  private championSeasonNumber?: number;
  private providerMatchStates = new Map<string, MatchState>();

  private logs: DaemonLog[] = [];
  private logId = 0;
  private lastBlock = 0;
  private wsConnected = false;
  private metabolicState: MetabolicState;

  public onLog?: (log: DaemonLog) => void;
  public onUpdate?: () => void;
  private saveQueued = false;

  constructor() {
    const pk = process.env.REFEREE_PRIVATE_KEY;
    if (!pk?.startsWith('0x')) throw new Error('REFEREE_PRIVATE_KEY missing or malformed');

    this.account = privateKeyToAccount(pk as `0x${string}`);
    const rpc = process.env.X_LAYER_MAINNET_RPC ?? process.env.X_LAYER_HTTP_RPC ?? process.env.X_LAYER_RPC_URL;

    this.httpClient = createPublicClient({ chain: xLayerMainnet, transport: xLayerHttpTransport(rpc) });
    this.walletClient = createWalletClient({ chain: xLayerMainnet, transport: xLayerHttpTransport(rpc), account: this.account });

    this.metabolicState = {
      okbBalance: '0',
      okbBalanceFormatted: '0.000000',
      healthPercent: 0,
      isRefuelNeeded: false,
      checkedAt: Date.now(),
    };

    for (const f of this.fixtures) {
      this.pools.set(f.id, { fixtureId: f.id, home: '0', draw: '0', away: '0', fees: '0', count: 0 });
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  syncFixtures(fixtures: Fixture[]): void {
    let changed = false;

    for (const incoming of fixtures) {
      if (!incoming?.id || UNRESOLVED_TEAM_CODES.has(incoming.home?.code) || UNRESOLVED_TEAM_CODES.has(incoming.away?.code)) continue;

      const existing = this.fixtures.find(f => f.id === incoming.id);
      if (existing) {
        const keepSettlement = existing.status === 'settled';
        Object.assign(existing, incoming, {
          status: keepSettlement ? existing.status : incoming.status,
          result: keepSettlement ? existing.result : incoming.result,
        });
      } else {
        this.fixtures.push(structuredClone(incoming));
        changed = true;
      }

      if (!this.pools.has(incoming.id)) {
        this.pools.set(incoming.id, { fixtureId: incoming.id, home: '0', draw: '0', away: '0', fees: '0', count: 0 });
        changed = true;
      }
    }

    if (changed) {
      this.log('SYSTEM', 'info', `Season fixtures synced - watching ${this.fixtures.length} fixtures.`);
      this.onUpdate?.();
    }
  }

  syncMatchStates(matchStates: Record<string, MatchState>): void {
    let changed = false;

    for (const [fixtureId, matchState] of Object.entries(matchStates)) {
      if (!fixtureId || !matchState) continue;
      const fixture = this.fixtures.find(f => f.id === fixtureId);
      if (!fixture || fixture.mode !== 'realtime') continue;

      const next = { ...matchState, fixtureId };
      const prev = this.providerMatchStates.get(fixtureId);
      if (JSON.stringify(prev) === JSON.stringify(next)) continue;

      this.providerMatchStates.set(fixtureId, next);
      changed = true;
    }

    if (changed) this.onUpdate?.();
  }

  async settleSyncedFixture(fixtureId: string, outcome: Outcome): Promise<SettlementResult | null> {
    const fixture = this.fixtures.find(f => f.id === fixtureId);
    if (!fixture) return null;
    if (fixture.mode !== 'realtime') {
      this.log('ORACLE', 'warn', `Synced settlement skipped for non-realtime fixture ${fixtureId}`);
      return null;
    }
    const existingSettlement = this.settlements.find(s => s.fixtureId === fixtureId);
    const existingJob = this.settlementJobs.get(`match:${fixtureId}`);
    if (fixture.status === 'settled') {
      if (existingSettlement) {
        if (existingJob?.status === 'paying') {
          await this.processSettlementJob(existingJob, 'Payout');
          return this.upsertMatchSettlementResult(existingJob);
        }
        if (existingJob?.status === 'complete') {
          return this.upsertMatchSettlementResult(existingJob);
        }
        return null;
      }
      if (fixture.result && fixture.result !== outcome) {
        this.log('ORACLE', 'warn', `Synced settlement repair skipped for ${fixtureId}: fixture result ${fixture.result}, provider result ${outcome}`);
        return null;
      }
      this.log('ORACLE', 'warn', `Repairing missing settlement ledger for ${fixtureId}`);
      return this.settleFixture(fixtureId, outcome, { repairSettled: true });
    }
    return this.settleFixture(fixtureId, outcome);
  }

  private realtimeFixtureFor(fixtureId?: string, fixture?: Fixture): Fixture | undefined {
    if (fixture?.mode === 'realtime') return fixture;
    const current = fixtureId ? this.fixtures.find(f => f.id === fixtureId) : undefined;
    return current?.mode === 'realtime' ? current : undefined;
  }

  private hasRealtimeFixtureEvidence(fixtureId?: string, fixture?: Fixture): boolean {
    if (this.realtimeFixtureFor(fixtureId, fixture)) return true;
    if (!fixtureId) return false;
    return Array.from(this.stakes.values()).some(stake => stake.fixtureId === fixtureId && this.realtimeFixtureFor(stake.fixtureId, stake.fixture))
      || Array.from(this.rejectedStakeRefunds.values()).some(refund => refund.fixtureId === fixtureId && this.realtimeFixtureFor(refund.fixtureId, refund.fixture))
      || this.settlements.some(settlement => settlement.fixtureId === fixtureId && this.realtimeFixtureFor(settlement.fixtureId, settlement.fixture))
      || Array.from(this.settlementJobs.values()).some(job => job.fixtureId === fixtureId && this.realtimeFixtureFor(job.fixtureId, job.fixture));
  }

  getTotalStakePositions(): number {
    return this.stakes.size + this.champStakes.length + this.champHistory.length;
  }

  getPositions(address: string) {
    const wallet = address.toLowerCase();
    const stakePositions = Array.from(this.stakes.values())
      .filter(stake => stake.staker.toLowerCase() === wallet)
      .map(stake => {
        const fixture = this.realtimeFixtureFor(stake.fixtureId, stake.fixture);
        if (!fixture) return null;
        const stakeMs = stake.timestamp > 10_000_000_000 ? stake.timestamp : stake.timestamp * 1000;
        const settlement = this.settlements.find(s => s.fixtureId === stake.fixtureId && s.settledAt >= stakeMs);
        const settledOutcome = settlement?.outcome ?? (fixture?.status === 'settled' ? fixture.result : undefined);
        const won = settledOutcome ? settledOutcome === stake.outcome : false;
        const payout = won ? settlement?.payouts.find(p => p.address.toLowerCase() === wallet) : undefined;
        return {
          type: 'match' as const,
          status: payout ? 'paid' : settledOutcome ? (won ? 'won_pending_payout' : 'lost') : 'active',
          stake,
          fixture: fixture ?? settlement?.fixture,
          settlement,
          payout,
        };
      })
      .filter((position): position is NonNullable<typeof position> => Boolean(position));

    const archivedChampionTxs = new Set(this.champHistory.map(position => position.stake.txHash));
    const championPositions = this.champStakes
      .filter(stake => stake.staker.toLowerCase() === wallet)
      .filter(stake => !archivedChampionTxs.has(stake.txHash))
      .map(stake => {
        const championJob = this.champWinner ? this.settlementJobs.get(`champion:${this.champWinner}`) : undefined;
        const payout = championJob?.payouts.find(p => p.address.toLowerCase() === wallet && p.status === 'sent' && p.txHash);
        return {
          type: 'champion' as const,
          status: this.champSettled ? (this.champWinner === stake.teamCode ? 'settled_winner' : 'settled_lost') : 'active',
          stake,
          winner: this.champWinner,
          seasonNumber: this.championSeasonNumber,
          payout,
        };
      });

    const championHistoryPositions = this.champHistory
      .filter(position => position.stake.staker.toLowerCase() === wallet)
      .map(position => {
        const championJob = this.settlementJobs.get(`champion:${position.winner}`);
        const payout = championJob?.payouts.find(p => p.address.toLowerCase() === wallet && p.status === 'sent' && p.txHash);
        return {
          type: 'champion' as const,
          status: position.winner === position.stake.teamCode ? 'settled_winner' : 'settled_lost',
          stake: position.stake,
          winner: position.winner,
          settledAt: position.settledAt,
          seasonNumber: position.seasonNumber,
          payout,
        };
      });

    const refunds = Array.from(this.rejectedStakeRefunds.values())
      .filter(refund => refund.staker.toLowerCase() === wallet)
      .filter(refund => this.hasRealtimeFixtureEvidence(refund.fixtureId, refund.fixture))
      .map(refund => ({ type: 'refund' as const, status: refund.status, refund }));

    return [...stakePositions, ...championPositions, ...championHistoryPositions, ...refunds]
      .sort((a, b) => {
        const at = 'stake' in a ? a.stake.timestamp : a.refund.timestamp;
        const bt = 'stake' in b ? b.stake.timestamp : b.refund.timestamp;
        return bt - at;
      });
  }

  getLeaderboard(limit = 20) {
    type LeaderboardEntry = {
      address: string;
      volumeWei: bigint;
      returnedWei: bigint;
      wins: number;
      losses: number;
      active: number;
      refunded: number;
      positions: number;
      dailyPositions: number;
      lastActiveAt: number;
    };

    const entries = new Map<string, LeaderboardEntry>();
    const entryFor = (address: string) => {
      const key = address.toLowerCase();
      const existing = entries.get(key);
      if (existing) return existing;
      const created: LeaderboardEntry = {
        address,
        volumeWei: 0n,
        returnedWei: 0n,
        wins: 0,
        losses: 0,
        active: 0,
        refunded: 0,
        positions: 0,
        dailyPositions: 0,
        lastActiveAt: 0,
      };
      entries.set(key, created);
      return created;
    };

    for (const stake of this.stakes.values()) {
      const entry = entryFor(stake.staker);
      const amount = BigInt(stake.amountWei);
      entry.volumeWei += amount;
      entry.positions += 1;
      entry.lastActiveAt = Math.max(entry.lastActiveAt, stake.timestamp);

      const fixture = stake.fixture ?? this.fixtures.find(f => f.id === stake.fixtureId);
      const stakeMs = stake.timestamp > 10_000_000_000 ? stake.timestamp : stake.timestamp * 1000;
      const settlement = this.settlements.find(s => s.fixtureId === stake.fixtureId && s.settledAt >= stakeMs);
      const outcome = settlement?.outcome ?? (fixture?.status === 'settled' ? fixture.result : undefined);
      if (!outcome) {
        entry.active += 1;
        continue;
      }

      if (outcome === stake.outcome) {
        entry.wins += 1;
        const payout = settlement?.payouts.find(p => p.address.toLowerCase() === stake.staker.toLowerCase());
        if (payout) entry.returnedWei += BigInt(payout.amountWei);
      } else {
        entry.losses += 1;
      }
    }

    const archivedChampionTxs = new Set(this.champHistory.map(position => position.stake.txHash.toLowerCase()));
    const championPositions = [
      ...this.champStakes.filter(stake => !archivedChampionTxs.has(stake.txHash.toLowerCase())).map(stake => ({
        stake,
        winner: this.champWinner,
        settled: this.champSettled,
      })),
      ...this.champHistory.map(position => ({
        stake: position.stake,
        winner: position.winner,
        settled: true,
      })),
    ];

    for (const position of championPositions) {
      const entry = entryFor(position.stake.staker);
      entry.volumeWei += BigInt(position.stake.amountWei);
      entry.positions += 1;
      entry.lastActiveAt = Math.max(entry.lastActiveAt, position.stake.timestamp);
      if (!position.settled || !position.winner) {
        entry.active += 1;
        continue;
      }
      if (position.winner === position.stake.teamCode) {
        entry.wins += 1;
        const championJob = this.settlementJobs.get(`champion:${position.winner}`);
        const payout = championJob?.payouts.find(p => p.address.toLowerCase() === position.stake.staker.toLowerCase() && p.status === 'sent' && p.txHash);
        if (payout) entry.returnedWei += BigInt(payout.amountWei);
      } else {
        entry.losses += 1;
      }
    }

    for (const refund of this.rejectedStakeRefunds.values()) {
      const entry = entryFor(refund.staker);
      entry.refunded += refund.status === 'refunded' ? 1 : 0;
      entry.returnedWei += refund.status === 'refunded' ? BigInt(refund.amountWei) : 0n;
      entry.lastActiveAt = Math.max(entry.lastActiveAt, refund.timestamp);
    }

    return Array.from(entries.values())
      .filter(entry => entry.positions > 0)
      .sort((a, b) => {
        const leftScore = a.wins * 1_000_000 + a.positions * 1_000 + Number(a.volumeWei / 1_000_000_000_000_000n);
        const rightScore = b.wins * 1_000_000 + b.positions * 1_000 + Number(b.volumeWei / 1_000_000_000_000_000n);
        if (leftScore !== rightScore) return rightScore - leftScore;
        return b.lastActiveAt - a.lastActiveAt;
      })
      .slice(0, limit)
      .map((entry, index) => ({
        rank: index + 1,
        address: entry.address,
        volumeWei: entry.volumeWei.toString(),
        returnedWei: entry.returnedWei.toString(),
        wins: entry.wins,
        losses: entry.losses,
        active: entry.active,
        refunded: entry.refunded,
        positions: entry.positions,
        winRate: entry.wins + entry.losses > 0 ? entry.wins / (entry.wins + entry.losses) : null,
        lastActiveAt: entry.lastActiveAt,
      }));
  }

  getMatchdayCupLeaderboard(limit = 20) {
    type LeaderboardEntry = {
      address: string;
      volumeWei: bigint;
      returnedWei: bigint;
      wins: number;
      losses: number;
      active: number;
      refunded: number;
      positions: number;
      dailyPositions: number;
      lastActiveAt: number;
    };

    const scoreFor = (entry: LeaderboardEntry) => {
      const volumePoints = Number(entry.volumeWei / MATCHDAY_VOLUME_POINT_WEI);
      const winPoints = entry.wins * MATCHDAY_WIN_BONUS_POINTS;
      const activePoints = entry.active * MATCHDAY_ACTIVE_BONUS_POINTS;
      const participationPoints = entry.positions * MATCHDAY_POSITION_BONUS_POINTS;
      return {
        total: volumePoints + winPoints + activePoints + participationPoints,
        volumePoints,
        winPoints,
        activePoints,
        participationPoints,
      };
    };

    const entries = new Map<string, LeaderboardEntry>();
    const entryFor = (address: string) => {
      const key = address.toLowerCase();
      const existing = entries.get(key);
      if (existing) return existing;
      const created: LeaderboardEntry = {
        address,
        volumeWei: 0n,
        returnedWei: 0n,
        wins: 0,
        losses: 0,
        active: 0,
        refunded: 0,
        positions: 0,
        dailyPositions: 0,
        lastActiveAt: 0,
      };
      entries.set(key, created);
      return created;
    };

    for (const stake of this.stakes.values()) {
      const fixture = stake.fixture ?? this.fixtures.find(f => f.id === stake.fixtureId);
      if (fixture?.mode !== 'realtime') continue;

      const entry = entryFor(stake.staker);
      const amount = BigInt(stake.amountWei);
      entry.volumeWei += amount;
      entry.positions += 1;
      entry.lastActiveAt = Math.max(entry.lastActiveAt, stake.timestamp);

      const stakeMs = stake.timestamp > 10_000_000_000 ? stake.timestamp : stake.timestamp * 1000;
      if (new Date(stakeMs).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)) {
        entry.dailyPositions += 1;
      }
      const settlement = this.settlements.find(s => s.fixtureId === stake.fixtureId && s.settledAt >= stakeMs);
      const outcome = settlement?.outcome ?? (fixture.status === 'settled' ? fixture.result : undefined);
      if (!outcome) {
        entry.active += 1;
        continue;
      }

      if (outcome === stake.outcome) {
        entry.wins += 1;
        const payout = settlement?.payouts.find(p => p.address.toLowerCase() === stake.staker.toLowerCase());
        if (payout) entry.returnedWei += BigInt(payout.amountWei);
      } else {
        entry.losses += 1;
      }
    }

    return Array.from(entries.values())
      .filter(entry => entry.positions > 0)
      .sort((a, b) => {
        const leftScore = scoreFor(a).total;
        const rightScore = scoreFor(b).total;
        if (leftScore !== rightScore) return rightScore - leftScore;
        return b.lastActiveAt - a.lastActiveAt;
      })
      .slice(0, limit)
      .map((entry, index) => {
        const score = scoreFor(entry);
        return {
          rank: index + 1,
          address: entry.address,
          volumeWei: entry.volumeWei.toString(),
          returnedWei: entry.returnedWei.toString(),
          wins: entry.wins,
          losses: entry.losses,
          active: entry.active,
          refunded: entry.refunded,
          positions: entry.positions,
          dailyPositions: entry.dailyPositions,
          winRate: entry.wins + entry.losses > 0 ? entry.wins / (entry.wins + entry.losses) : null,
          lastActiveAt: entry.lastActiveAt,
          score: score.total,
          scoreComponents: {
            volume: score.volumePoints,
            wins: score.winPoints,
            active: score.activePoints,
            participation: score.participationPoints,
          },
          scoreRules: {
            volumePointWei: MATCHDAY_VOLUME_POINT_WEI.toString(),
            winBonus: MATCHDAY_WIN_BONUS_POINTS,
            activeBonus: MATCHDAY_ACTIVE_BONUS_POINTS,
            positionBonus: MATCHDAY_POSITION_BONUS_POINTS,
          },
        };
      });
  }

  getMatchdayCupScoreRules() {
    return {
      volumePointWei: MATCHDAY_VOLUME_POINT_WEI.toString(),
      volumePointOKB: '0.001',
      winBonus: MATCHDAY_WIN_BONUS_POINTS,
      activeBonus: MATCHDAY_ACTIVE_BONUS_POINTS,
      positionBonus: MATCHDAY_POSITION_BONUS_POINTS,
    };
  }

  getMatchdayCountrySupport(limit = 12, eligibleAddresses?: Set<string>) {
    type CountrySupportEntry = {
      code: string;
      name: string;
      iso: string;
      volumeWei: bigint;
      positions: number;
      supporters: Set<string>;
      lastActiveAt: number;
    };

    const entries = new Map<string, CountrySupportEntry>();
    const entryFor = (team: { code: string; name: string; iso: string }) => {
      const existing = entries.get(team.code);
      if (existing) return existing;
      const created: CountrySupportEntry = {
        code: team.code,
        name: team.name,
        iso: team.iso,
        volumeWei: 0n,
        positions: 0,
        supporters: new Set<string>(),
        lastActiveAt: 0,
      };
      entries.set(team.code, created);
      return created;
    };

    for (const stake of this.stakes.values()) {
      const fixture = stake.fixture ?? this.fixtures.find(f => f.id === stake.fixtureId);
      if (fixture?.mode !== 'realtime') continue;
      if (stake.outcome === 'draw') continue;
      if (eligibleAddresses && !eligibleAddresses.has(stake.staker.toLowerCase())) continue;

      const team = stake.outcome === 'home' ? fixture.home : fixture.away;
      if (UNRESOLVED_TEAM_CODES.has(team.code) || team.iso === 'tbd') continue;

      const entry = entryFor(team);
      entry.volumeWei += BigInt(stake.amountWei);
      entry.positions += 1;
      entry.supporters.add(stake.staker.toLowerCase());
      entry.lastActiveAt = Math.max(entry.lastActiveAt, stake.timestamp);
    }

    return Array.from(entries.values())
      .sort((a, b) => {
        const volumeDiff = b.volumeWei - a.volumeWei;
        if (volumeDiff !== 0n) return volumeDiff > 0n ? 1 : -1;
        if (a.supporters.size !== b.supporters.size) return b.supporters.size - a.supporters.size;
        return b.lastActiveAt - a.lastActiveAt;
      })
      .slice(0, limit)
      .map((entry, index) => ({
        rank: index + 1,
        code: entry.code,
        name: entry.name,
        iso: entry.iso,
        volumeWei: entry.volumeWei.toString(),
        positions: entry.positions,
        supporters: entry.supporters.size,
        lastActiveAt: entry.lastActiveAt,
      }));
  }

  syncChampionSeason(seasonNumber: number): void {
    if (!Number.isFinite(seasonNumber) || seasonNumber < 1) return;

    if (this.championSeasonNumber === seasonNumber) return;

    const hasOpenChampionExposure = this.champStakes.length > 0 || Array.from(this.champPool.values()).some(value => value > 0n);
    if (this.championSeasonNumber === undefined && hasOpenChampionExposure && !this.champSettled) {
      this.championSeasonNumber = seasonNumber;
      this.persistMarketState();
      return;
    }

    this.archiveSettledChampionStakes();
    this.championSeasonNumber = seasonNumber;
    this.champStakes = [];
    this.champPool = new Map(CHAMP_TEAMS.map(team => [team, 0n]));
    this.champSettled = false;
    this.champWinner = undefined;
    this.log('SYSTEM', 'info', `Champion market opened for Season ${seasonNumber}`);
    this.persistMarketState();
    this.onUpdate?.();
  }

  private archiveSettledChampionStakes(settledAt = Date.now()): void {
    if (!this.champSettled || !this.champWinner || this.champStakes.length === 0) return;

    const existing = new Set(this.champHistory.map(position => position.stake.txHash));
    for (const stake of this.champStakes) {
      if (existing.has(stake.txHash)) continue;
      this.champHistory.push({
        stake,
        winner: this.champWinner,
        settledAt,
        seasonNumber: this.championSeasonNumber,
      });
      existing.add(stake.txHash);
    }
  }

  async start(): Promise<void> {
    this.log('SYSTEM', 'info', `RefereeEngine starting — wallet ${this.account.address}`);
    await this.loadMarketState();
    await this.resumeSettlementJobs();
    await this.refreshMetabolism();
    this.startWebSocketListener();
    this.startMetabolismLoop();

    this.log('SYSTEM', 'success', `Engine live on X Layer Mainnet (chain 196). Watching ${this.fixtures.length} fixtures.`);
  }

  // ── WebSocket block listener ─────────────────────────────────────────────────

  private async loadMarketState(): Promise<void> {
    const stored = await readRefereeMarket();
    if (!stored) return;

    this.stakes = new Map(stored.stakes.map(stake => [stake.txHash, stake]));
    this.rejectedStakeRefunds = new Map(stored.rejectedStakeRefunds.map(refund => [refund.txHash, refund]));
    this.pools = new Map(stored.pools.map(pool => [pool.fixtureId, pool]));
    this.settlements = this.compactSettlements(stored.settlements ?? []);
    this.settlementJobs = new Map(this.compactSettlementJobs(stored.settlementJobs ?? []).map(job => [job.id, job]));
    this.champStakes = stored.champStakes;
    this.champHistory = stored.champHistory ?? [];
    this.champPool = new Map(CHAMP_TEAMS.map(team => [team, BigInt(stored.champPool[team] ?? '0')]));
    this.champSettled = stored.champSettled;
    this.champWinner = stored.champWinner;
    this.championSeasonNumber = stored.championSeasonNumber;
    this.lastBlock = stored.lastBlock;

    const sanitized = this.removeNonRealtimeMatchHistory();

    for (const fixture of this.fixtures) {
      if (!this.pools.has(fixture.id)) {
        this.pools.set(fixture.id, { fixtureId: fixture.id, home: '0', draw: '0', away: '0', fees: '0', count: 0 });
      }
      const settlement = this.settlements.find(s => s.fixtureId === fixture.id);
      if (settlement) {
        fixture.status = 'settled';
        fixture.result = settlement.outcome;
      }
    }

    const settlementDropCount = Math.max(0, (stored.settlements?.length ?? 0) - this.settlements.length);
    const jobDropCount = Math.max(0, (stored.settlementJobs?.length ?? 0) - this.settlementJobs.size);
    if (settlementDropCount || jobDropCount) {
      this.log('SYSTEM', 'warn', `Compacted referee market history - dropped ${settlementDropCount} old settlements and ${jobDropCount} old settlement jobs.`);
    }
    const sanitizedCount = sanitized.stakes + sanitized.refunds + sanitized.pools + sanitized.settlements + sanitized.jobs;
    if (sanitizedCount > 0) {
      this.log('SYSTEM', 'warn', `Sanitized legacy non-realtime match history - removed ${sanitized.stakes} stakes, ${sanitized.refunds} refunds, ${sanitized.pools} pools, ${sanitized.settlements} settlements, ${sanitized.jobs} jobs.`);
      await this.persistMarketStateNow();
    }
    this.log('SYSTEM', 'success', `Loaded referee market history - ${this.stakes.size} stakes, ${this.settlements.length} settlements.`);
  }

  private async resumeSettlementJobs(): Promise<void> {
    for (const job of this.settlementJobs.values()) {
      if (job.type === 'match' && job.status === 'complete' && job.fixtureId && !this.settlements.some(s => s.fixtureId === job.fixtureId)) {
        this.settlements.push(this.resultFromSettlementJob(job));
      }
    }

    const pendingJobs = Array.from(this.settlementJobs.values()).filter(job => job.status === 'paying');
    if (pendingJobs.length === 0) {
      if (this.settlements.length) await this.persistMarketStateNow();
      return;
    }

    this.log('ORACLE', 'warn', `Resuming ${pendingJobs.length} interrupted settlement job(s)`);
    for (const job of pendingJobs) {
      if (job.winnerCount === 0 && job.payouts.length > 0) {
        job.payouts = job.payouts.filter(payout => payout.status === 'sent');
        if (job.payouts.length === 0) job.status = 'complete';
        await this.saveSettlementJob(job);
      }

      const verb = job.type === 'champion'
        ? 'Champion payout'
        : 'Payout';
      await this.processSettlementJob(job, verb);

      if (job.type === 'match' && job.fixtureId && job.outcome) {
        const fixture = this.fixtures.find(f => f.id === job.fixtureId);
        if (fixture) {
          fixture.status = 'settled';
          fixture.result = job.outcome;
        }
        await this.upsertMatchSettlementResult(job);
      }
    }

    await this.persistMarketStateNow();
    this.onUpdate?.();
  }

  private marketSnapshot() {
    const champPool: Record<string, string> = {};
    this.champPool.forEach((value, team) => { champPool[team] = value.toString(); });
    return {
      version: 1 as const,
      stakes: Array.from(this.stakes.values()),
      rejectedStakeRefunds: Array.from(this.rejectedStakeRefunds.values()),
      pools: Array.from(this.pools.values()),
      settlements: this.compactSettlements(this.settlements),
      settlementJobs: this.compactSettlementJobs(Array.from(this.settlementJobs.values())),
      champStakes: this.champStakes,
      champHistory: this.champHistory,
      champPool,
      champSettled: this.champSettled,
      champWinner: this.champWinner,
      championSeasonNumber: this.championSeasonNumber,
      lastBlock: this.lastBlock,
      updatedAt: Date.now(),
    };
  }

  private async persistMarketStateNow(): Promise<void> {
    await writeRefereeMarket(this.marketSnapshot());
  }

  private compactSettlements(settlements: SettlementResult[]): SettlementResult[] {
    const currentFixtureIds = new Set(this.fixtures.map(fixture => fixture.id));
    const currentFixtureSettlements = new Map<string, SettlementResult>();

    for (const settlement of settlements) {
      if (!currentFixtureIds.has(settlement.fixtureId)) continue;
      const existing = currentFixtureSettlements.get(settlement.fixtureId);
      if (!existing || settlement.settledAt > existing.settledAt) {
        currentFixtureSettlements.set(settlement.fixtureId, settlement);
      }
    }

    const recent = [...settlements]
      .sort((a, b) => b.settledAt - a.settledAt)
      .slice(0, MAX_PERSISTED_SETTLEMENTS);

    return [...new Map([...recent, ...currentFixtureSettlements.values()]
      .map(settlement => [`${settlement.fixtureId}:${settlement.settledAt}`, settlement])).values()]
      .sort((a, b) => a.settledAt - b.settledAt);
  }

  private compactSettlementJobs(jobs: PersistedSettlementJob[]): PersistedSettlementJob[] {
    const paying = jobs.filter(job => job.status === 'paying');
    const complete = jobs
      .filter(job => job.status === 'complete')
      .sort((a, b) => b.settledAt - a.settledAt)
      .slice(0, MAX_PERSISTED_SETTLEMENT_JOBS);

    return [...new Map([...paying, ...complete].map(job => [job.id, job])).values()]
      .sort((a, b) => a.settledAt - b.settledAt);
  }

  private removeNonRealtimeMatchHistory(): { stakes: number; refunds: number; pools: number; settlements: number; jobs: number } {
    const before = {
      stakes: this.stakes.size,
      refunds: this.rejectedStakeRefunds.size,
      pools: this.pools.size,
      settlements: this.settlements.length,
      jobs: this.settlementJobs.size,
    };

    this.stakes = new Map(
      Array.from(this.stakes.entries())
        .filter(([, stake]) => this.realtimeFixtureFor(stake.fixtureId, stake.fixture)),
    );
    this.rejectedStakeRefunds = new Map(
      Array.from(this.rejectedStakeRefunds.entries())
        .filter(([, refund]) => this.hasRealtimeFixtureEvidence(refund.fixtureId, refund.fixture)),
    );
    this.settlements = this.settlements
      .filter(settlement => this.hasRealtimeFixtureEvidence(settlement.fixtureId, settlement.fixture));
    this.settlementJobs = new Map(
      Array.from(this.settlementJobs.entries())
        .filter(([, job]) => job.type !== 'match' || this.hasRealtimeFixtureEvidence(job.fixtureId, job.fixture)),
    );

    const keepPoolIds = new Set<string>([
      ...this.fixtures.filter(fixture => fixture.mode === 'realtime').map(fixture => fixture.id),
      ...Array.from(this.stakes.values()).map(stake => stake.fixtureId),
      ...Array.from(this.rejectedStakeRefunds.values()).map(refund => refund.fixtureId),
      ...this.settlements.map(settlement => settlement.fixtureId),
      ...Array.from(this.settlementJobs.values()).map(job => job.fixtureId).filter((fixtureId): fixtureId is string => Boolean(fixtureId)),
    ]);
    this.pools = new Map(
      Array.from(this.pools.entries())
        .filter(([fixtureId]) => keepPoolIds.has(fixtureId)),
    );

    return {
      stakes: before.stakes - this.stakes.size,
      refunds: before.refunds - this.rejectedStakeRefunds.size,
      pools: before.pools - this.pools.size,
      settlements: before.settlements - this.settlements.length,
      jobs: before.jobs - this.settlementJobs.size,
    };
  }

  async resetMarketState(fixtures = this.fixtures): Promise<void> {
    this.fixtures = structuredClone(fixtures);
    this.stakes.clear();
    this.rejectedStakeRefunds.clear();
    this.pools.clear();
    for (const fixture of this.fixtures) {
      this.pools.set(fixture.id, { fixtureId: fixture.id, home: '0', draw: '0', away: '0', fees: '0', count: 0 });
    }
    this.settlements = [];
    this.settlementJobs.clear();
    this.champStakes = [];
    this.champHistory = [];
    this.champPool = new Map(CHAMP_TEAMS.map(team => [team, 0n]));
    this.champSettled = false;
    this.champWinner = undefined;
    this.championSeasonNumber = undefined;
    this.logs = [];
    this.logId = 0;
    this.log('SYSTEM', 'success', 'Referee market state reset to a clean slate');
    await this.persistMarketStateNow();
    this.onUpdate?.();
  }

  private persistMarketState(): void {
    if (this.saveQueued) return;
    this.saveQueued = true;
    setTimeout(() => {
      this.saveQueued = false;
      writeRefereeMarket(this.marketSnapshot()).catch((err: unknown) => {
        this.log('SYSTEM', 'warn', `Referee market persistence failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, 250);
  }

  private httpPollerStarted = false;

  private startWebSocketListener(): void {
    // Always start HTTP poller as baseline — WS upgrades it if available
    this.startHttpPoller();

    if (process.env.ENABLE_XLAYER_WS !== 'true') {
      this.wsConnected = false;
      this.log('RPC', 'info', 'HTTP poller active - WebSocket listener disabled');
      return;
    }

    try {
      const wsClient = createPublicClient({
        chain: xLayerMainnet,
        transport: webSocket('wss://rpc.xlayer.tech', { reconnect: { attempts: 5, delay: 3000 } }),
      });

      wsClient.watchBlocks({
        includeTransactions: true,
        onBlock: (block) => {
          this.wsConnected = true;
          this.lastBlock = Number(block.number ?? 0n);
          this.scanBlock(block as Block & { transactions: Transaction[] });
          this.onUpdate?.();
        },
        onError: () => {
          this.wsConnected = false;
          this.log('RPC', 'warn', 'WebSocket disconnected — HTTP poller active as fallback');
        },
      });

      this.log('RPC', 'info', 'WebSocket listener active — watching X Layer Mainnet blocks...');
    } catch {
      this.wsConnected = false;
      this.log('RPC', 'warn', 'WebSocket unavailable — running in HTTP poll mode');
    }
  }

  private startHttpPoller(): void {
    setInterval(async () => {
      try {
        const latest = await this.httpClient.getBlockNumber();
        const latestNum = Number(latest);

        if (this.lastBlock === 0) {
          this.lastBlock = latestNum - 1;
        }

        // Scan missed blocks with a conservative cap. Explicit stake reports
        // cover fast confirmation paths, so full recent-window rescans are
        // opt-in to keep RPC usage predictable.
        const from = this.lastBlock + 1;
        const to   = Math.min(latestNum, from + REFEREE_BLOCK_POLL_MAX_BLOCKS - 1);

        for (let n = from; n <= to; n++) {
          const block = await this.httpClient.getBlock({ blockNumber: BigInt(n), includeTransactions: true });
          this.scanBlock(block as Block & { transactions: Transaction[] });
        }

        if (REFEREE_BLOCK_POLL_RECENT_BLOCKS > 0) {
          const recentFrom = Math.max(to + 1, latestNum - REFEREE_BLOCK_POLL_RECENT_BLOCKS + 1);
          for (let n = recentFrom; n <= latestNum; n++) {
            const block = await this.httpClient.getBlock({ blockNumber: BigInt(n), includeTransactions: true });
            this.scanBlock(block as Block & { transactions: Transaction[] });
          }
        }

        this.lastBlock = Math.max(to, latestNum - REFEREE_BLOCK_POLL_RECENT_BLOCKS);
        this.onUpdate?.();
      } catch {
        this.log('RPC', 'warn', 'Block range poll failed');
      }
    }, REFEREE_BLOCK_POLL_INTERVAL_MS);
  }

  // Direct TX lookup — called when frontend reports a confirmed stake hash
  hasStakeTx(txHash: string): boolean {
    const normalized = txHash.toLowerCase();
    return this.stakes.has(txHash)
      || Array.from(this.stakes.keys()).some(hash => hash.toLowerCase() === normalized)
      || this.champStakes.some(stake => stake.txHash.toLowerCase() === normalized)
      || this.champHistory.some(position => position.stake.txHash.toLowerCase() === normalized)
      || Array.from(this.rejectedStakeRefunds.keys()).some(hash => hash.toLowerCase() === normalized);
  }

  stakerForTx(txHash: string): string | undefined {
    const normalized = txHash.toLowerCase();
    const stake = Array.from(this.stakes.values()).find(item => item.txHash.toLowerCase() === normalized);
    if (stake) return stake.staker;
    const championStake = this.champStakes.find(item => item.txHash.toLowerCase() === normalized)
      ?? this.champHistory.find(item => item.stake.txHash.toLowerCase() === normalized)?.stake;
    if (championStake) return championStake.staker;
    return Array.from(this.rejectedStakeRefunds.values()).find(item => item.txHash.toLowerCase() === normalized)?.staker;
  }

  validStakeForTx(txHash: string): { staker: string; amountWei: string; kind: 'match' | 'champion' } | undefined {
    const normalized = txHash.toLowerCase();
    const stake = Array.from(this.stakes.values()).find(item => item.txHash.toLowerCase() === normalized);
    if (stake) return { staker: stake.staker, amountWei: stake.amountWei, kind: 'match' };
    const championStake = this.champStakes.find(item => item.txHash.toLowerCase() === normalized)
      ?? this.champHistory.find(item => item.stake.txHash.toLowerCase() === normalized)?.stake;
    if (championStake) return { staker: championStake.staker, amountWei: championStake.amountWei, kind: 'champion' };
    return undefined;
  }

  async reportStakeTx(txHash: `0x${string}`): Promise<boolean> {
    try {
      const tx = await this.httpClient.getTransaction({ hash: txHash });
      if (!tx) return false;
      const block = await this.httpClient.getBlock({ blockNumber: tx.blockNumber!, includeTransactions: false });
      this.processStakeTx(tx as unknown as Transaction, Number(block.timestamp));
      this.onUpdate?.();
      return this.hasStakeTx(txHash);
    } catch {
      this.log('RPC', 'warn', `Failed to look up reported TX ${txHash}`);
      return false;
    }
  }

  private scanBlock(block: Block & { transactions: Transaction[] }): void {
    const refereeAddr = this.account.address.toLowerCase();
    for (const tx of block.transactions) {
      if (typeof tx !== 'object' || !tx.to) continue;
      if (tx.to.toLowerCase() !== refereeAddr) continue;
      if (!tx.value || tx.value === 0n) continue;
      this.processStakeTx(tx, Number(block.timestamp ?? 0n));
    }
  }

  private processStakeTx(tx: Transaction, timestamp: number): void {
    if (this.stakes.has(tx.hash)) return;
    if (this.champStakes.some(s => s.txHash === tx.hash)) return;

    try {
      const decoded = decodeStakeTx(tx.input ?? '0x');
      const gross   = tx.value;
      const fee     = (gross * PROTOCOL_FEE_BPS) / 10_000n;
      const net     = gross - fee;

      if (decoded.kind === 'champion') {
        if (this.champSettled) {
          this.log('STAKE', 'warn', `Rejected champion stake — market already settled (tx ${tx.hash.slice(0, 10)}...)`);
          return;
        }
        const { teamCode } = decoded;
        this.champPool.set(teamCode, (this.champPool.get(teamCode) ?? 0n) + net);
        this.champStakes.push({
          txHash: tx.hash,
          staker: tx.from,
          teamCode,
          amountWei: gross.toString(),
          blockNumber: Number(tx.blockNumber ?? 0n),
          timestamp,
        });
        this.log('STAKE', 'success', `+${parseFloat(formatEther(gross)).toFixed(4)} OKB · Champion → ${teamCode}`, tx.hash);
        this.persistMarketState();
        this.onUpdate?.();
        return;
      }

      // ── Match stake ────────────────────────────────────────────────────────
      const { fixtureId, outcome } = decoded;
      const fixture = this.fixtures.find((f) => f.id === fixtureId);

      if (!fixture && fixtureId.startsWith('season-')) {
        this.log('STAKE', 'warn', `Pending stake import - waiting for season fixture sync "${fixtureId}"`, tx.hash);
        return;
      }

      if (
        !fixture
        || UNRESOLVED_TEAM_CODES.has(fixture.home.code)
        || UNRESOLVED_TEAM_CODES.has(fixture.away.code)
        || (fixture.status === 'locked' && fixture.mode !== 'realtime')
        || fixture.status === 'settled'
      ) {
        const reason = fixture?.status === 'locked' && fixture.mode !== 'realtime'
          ? `fixture "${fixtureId}" already live`
          : fixture?.status === 'settled'
            ? `fixture "${fixtureId}" already settled`
            : `fixture "${fixtureId}" not open`;
        this.refundRejectedStake(tx, fixtureId, outcome, reason);
        return;
      }

      const pool = this.pools.get(fixtureId)!;
      pool[outcome] = (BigInt(pool[outcome]) + net).toString();
      pool.fees = (BigInt(pool.fees) + fee).toString();
      pool.count += 1;

      this.stakes.set(tx.hash, {
        txHash: tx.hash,
        staker: tx.from,
        fixtureId,
        fixture: structuredClone(fixture),
        outcome,
        amountWei: gross.toString(),
        blockNumber: Number(tx.blockNumber ?? 0n),
        timestamp,
      });

      this.log(
        'STAKE',
        'success',
        `+${parseFloat(formatEther(gross)).toFixed(4)} OKB · ${fixture.home.code} vs ${fixture.away.code} · ${outcome.toUpperCase()}`,
        tx.hash,
      );

      this.persistMarketState();
      this.onUpdate?.();
    } catch {
      // Not a stake transaction — plain OKB transfer or unrelated calldata
    }
  }

  // ── Champion settlement ──────────────────────────────────────────────────────

  private refundRejectedStake(tx: Transaction, fixtureId: string, outcome: Outcome, reason: string): void {
    if (this.rejectedStakeRefunds.has(tx.hash)) return;
    const fixture = this.fixtures.find(f => f.id === fixtureId);

    const record: RejectedStakeRefund = {
      txHash: tx.hash,
      staker: tx.from,
      fixtureId,
      fixture: fixture ? structuredClone(fixture) : undefined,
      outcome,
      amountWei: tx.value.toString(),
      reason,
      status: 'queued',
      timestamp: Date.now(),
    };
    this.rejectedStakeRefunds.set(tx.hash, record);
    this.persistMarketState();

    this.log('STAKE', 'warn', `Rejected stake - ${reason}; refund queued`, tx.hash);

    this.walletClient.sendTransaction({
      account: this.account,
      to: tx.from as Address,
      value: tx.value,
      chain: xLayerMainnet,
    }).then((txHash) => {
      this.rejectedStakeRefunds.set(tx.hash, { ...record, status: 'refunded', refundTxHash: txHash });
      this.persistMarketState();
      this.log('ORACLE', 'success', `Rejected stake refunded ${formatEther(tx.value)} OKB -> ${tx.from.slice(0, 10)}...`, txHash);
      this.refreshMetabolism().then(() => this.onUpdate?.()).catch(() => this.onUpdate?.());
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.rejectedStakeRefunds.set(tx.hash, { ...record, status: 'failed', error: msg });
      this.persistMarketState();
      this.log('ORACLE', 'error', `Rejected stake refund failed -> ${tx.from.slice(0, 10)}...: ${msg}`, tx.hash);
      this.onUpdate?.();
    });
  }

  async oracleChampion(teamCode: string, signature: string, nonce: number): Promise<void> {
    const message = `X-Cup-Champion:${teamCode}:${nonce}`;
    const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
    const adminAddr = (process.env.ADMIN_ADDRESS ?? '').toLowerCase();
    if (recovered.toLowerCase() !== adminAddr) {
      throw new Error(`Invalid oracle signature — recovered ${recovered}, expected ${adminAddr}`);
    }
    if (process.env.ALLOW_CHAMPION_ORACLE_OVERRIDE !== 'true') {
      throw new Error('Champion override disabled; settle from the official World Cup final result');
    }
    this.log('ORACLE', 'warn', `Champion override: ${teamCode} (nonce ${nonce})`);
    await this.settleChampion(teamCode);
  }

  private async saveSettlementJob(job: PersistedSettlementJob): Promise<void> {
    this.settlementJobs.set(job.id, job);
    await this.persistMarketStateNow();
  }

  private async processSettlementJob(job: PersistedSettlementJob, verb: 'Payout' | 'Refund' | 'Champion payout' | 'Champion refund'): Promise<void> {
    for (const payout of job.payouts) {
      if (payout.status === 'sent' && payout.txHash) continue;
      try {
        const txHash = await this.walletClient.sendTransaction({
          account: this.account,
          to: payout.address as Address,
          value: BigInt(payout.amountWei),
          chain: xLayerMainnet,
        });
        payout.status = 'sent';
        payout.txHash = txHash;
        delete payout.error;
        await this.saveSettlementJob(job);
        this.log('ORACLE', 'success', `${verb} ${formatEther(BigInt(payout.amountWei))} OKB -> ${payout.address.slice(0, 10)}...`, txHash);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        payout.status = 'failed';
        payout.error = msg;
        await this.saveSettlementJob(job);
        this.log('ORACLE', 'error', `${verb} failed -> ${payout.address.slice(0, 10)}...: ${msg}`);
      }
    }

    job.status = job.payouts.some(payout => payout.status === 'failed') ? 'paying' : 'complete';
    await this.saveSettlementJob(job);
  }

  private resultFromSettlementJob(job: PersistedSettlementJob): SettlementResult {
    if (!job.fixtureId || !job.outcome) throw new Error(`Invalid match settlement job ${job.id}`);
    const fixture = job.fixture ?? this.fixtures.find(f => f.id === job.fixtureId);
    const payouts = job.payouts
      .filter(payout => payout.status === 'sent' && payout.txHash)
      .map(payout => ({ address: payout.address, amountWei: payout.amountWei, txHash: payout.txHash! }));

    return {
      fixtureId: job.fixtureId,
      fixture: fixture ? structuredClone(fixture) : undefined,
      outcome: job.outcome,
      totalPool: job.totalPool,
      winnerCount: job.winnerCount,
      payouts,
      blockNumber: job.blockNumber,
      explorerUrl: payouts[0] ? explorerTx(payouts[0].txHash) : `https://www.okx.com/web3/explorer/xlayer/address/${this.account.address}`,
      settledAt: job.settledAt,
    };
  }

  private async upsertMatchSettlementResult(job: PersistedSettlementJob): Promise<SettlementResult | null> {
    if (job.type !== 'match' || !job.fixtureId || !job.outcome) return null;
    const result = this.resultFromSettlementJob(job);
    const index = this.settlements.findIndex(settlement => settlement.fixtureId === job.fixtureId);
    if (index >= 0) {
      this.settlements[index] = result;
    } else {
      this.settlements.push(result);
    }
    await this.persistMarketStateNow();
    return result;
  }

  private async settleChampion(winner: string): Promise<void> {
    if (!CHAMP_TEAMS.includes(winner)) throw new Error(`Unknown team: ${winner}`);

    const jobId = `champion:${winner}`;
    const existingJob = this.settlementJobs.get(jobId);
    if (this.champSettled && (!existingJob || existingJob.status === 'complete')) {
      throw new Error('Champion market already settled');
    }

    this.champSettled = true;
    this.champWinner  = winner;

    const totalPool = Array.from(this.champPool.values()).reduce((s, v) => s + v, 0n);
    const winPool   = this.champPool.get(winner) ?? 0n;
    const winners   = this.champStakes.filter(s => s.teamCode === winner);

    this.log('ORACLE', 'info', `Champion: ${winner} · total pool ${formatEther(totalPool)} OKB · ${winners.length} winner(s)`);

    let job = existingJob;
    if (!job) {
      const payouts = winners.map((s, idx) => {
        const stake = BigInt(s.amountWei);
        const net = stake - (stake * PROTOCOL_FEE_BPS) / 10_000n;
        const amount = winPool > 0n ? (net * totalPool) / winPool : 0n;
        return {
          id: `${s.txHash}:${idx}`,
          address: s.staker,
          amountWei: amount.toString(),
          status: 'pending' as const,
        };
      }).filter(payout => BigInt(payout.amountWei) > 0n);

      job = {
        id: jobId,
        type: 'champion',
        status: 'paying',
        teamCode: winner,
        totalPool: totalPool.toString(),
        winnerCount: winners.length,
        blockNumber: this.lastBlock,
        settledAt: Date.now(),
        payouts,
      };
      await this.saveSettlementJob(job);
    }

    if (winPool === 0n && this.champStakes.length > 0) {
      this.log('ORACLE', 'warn', `No stakes on champion winner (${winner}) - settled pool retained by treasury`);
    }
    await this.processSettlementJob(job, 'Champion payout');
    this.archiveSettledChampionStakes(job.settledAt);
    await this.persistMarketStateNow();
    this.onUpdate?.();
  }

  // Oracle Override ──────────────────────────────────────────────────────────

  async oracleOverride(
    fixtureId: string,
    outcome: Outcome,
    signature: string,
    nonce: number,
  ): Promise<SettlementResult> {
    const message = `X-Cup-Oracle:${fixtureId}:${outcome}:${nonce}`;
    const recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });

    const adminAddr = (process.env.ADMIN_ADDRESS ?? '').toLowerCase();
    if (recovered.toLowerCase() !== adminAddr) {
      throw new Error(`Invalid oracle signature — recovered ${recovered}, expected ${adminAddr}`);
    }

    this.log('ORACLE', 'warn', `Override received: ${fixtureId} → ${outcome.toUpperCase()} (nonce ${nonce})`);
    return this.settleFixture(fixtureId, outcome);
  }

  private async settleFixture(fixtureId: string, outcome: Outcome, options: { repairSettled?: boolean } = {}): Promise<SettlementResult> {
    const fixture = this.fixtures.find((f) => f.id === fixtureId);
    if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);
    if (fixture.status === 'settled' && !options.repairSettled) throw new Error(`Fixture ${fixtureId} already settled`);

    fixture.status = 'locked';

    const pool = this.pools.get(fixtureId)!;
    const totalPool = BigInt(pool.home) + BigInt(pool.draw) + BigInt(pool.away);
    const winPool = BigInt(pool[outcome]);

    const allFixtureStakes = Array.from(this.stakes.values()).filter(s => s.fixtureId === fixtureId);
    const winners = allFixtureStakes.filter(s => s.outcome === outcome);

    this.log('ORACLE', 'info', `Settling ${fixtureId}: pool ${formatEther(totalPool)} OKB · ${winners.length} winner(s)`);

    const jobId = `match:${fixtureId}`;
    let job = this.settlementJobs.get(jobId);
    if (!job) {
      const payoutPlan = winners.map((stake, idx) => {
        const gross = BigInt(stake.amountWei);
        const fee = (gross * PROTOCOL_FEE_BPS) / 10_000n;
        const net = gross - fee;
        const amount = winPool > 0n ? (net * totalPool) / winPool : 0n;
        return {
          id: `${stake.txHash}:${idx}`,
          address: stake.staker,
          amountWei: amount.toString(),
          status: 'pending' as const,
        };
      }).filter(payout => BigInt(payout.amountWei) > 0n);

      job = {
        id: jobId,
        type: 'match',
        status: 'paying',
        fixtureId,
        fixture: structuredClone(fixture),
        outcome,
        totalPool: totalPool.toString(),
        winnerCount: winners.length,
        blockNumber: this.lastBlock,
        settledAt: Date.now(),
        payouts: payoutPlan,
      };
      await this.saveSettlementJob(job);
    }

    if (winPool === 0n && allFixtureStakes.length > 0) {
      this.log('ORACLE', 'warn', `No stakes on winning outcome (${outcome}) - settled pool retained by treasury`);
    }
    await this.processSettlementJob(job, 'Payout');

    fixture.status = 'settled';
    fixture.result = outcome;

    const resumedResult = await this.upsertMatchSettlementResult(job) ?? this.resultFromSettlementJob(job);

    this.settleChampionFromFinalFixture(fixture, outcome).catch((err: unknown) => {
      this.log('ORACLE', 'error', `Champion auto-settle failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    this.onUpdate?.();
    await this.refreshMetabolism();
    return resumedResult;
  }

  // Metabolism loop ──────────────────────────────────────────────────────────

  private async settleChampionFromFinalFixture(fixture: Fixture, outcome: Outcome): Promise<void> {
    if (this.champSettled) return;
    if (fixture.mode !== 'realtime' || fixture.round !== 'F') return;
    if (outcome === 'draw') {
      this.log('ORACLE', 'warn', 'Champion auto-settle skipped - final settled as draw');
      return;
    }
    const champTeam = outcome === 'away' ? fixture.away : fixture.home;
    if (!champTeam || !CHAMP_TEAMS.includes(champTeam.code)) {
      this.log('ORACLE', 'warn', `Champion auto-settle skipped - unresolved final winner ${champTeam?.code ?? 'unknown'}`);
      return;
    }
    await this.settleChampion(champTeam.code);
  }

  private startMetabolismLoop(): void {
    setInterval(async () => {
      await this.refreshMetabolism();
      const { okbBalanceFormatted, healthPercent, isRefuelNeeded } = this.metabolicState;

      this.log(
        'METABOLISM',
        isRefuelNeeded ? 'warn' : 'info',
        `[60s] OKB ${okbBalanceFormatted} · Health ${healthPercent}% · ${isRefuelNeeded ? 'REFUEL TRIGGERED' : 'Nominal'}`,
      );

      if (isRefuelNeeded) {
        const txHash = await checkAndRefuel(this.account, this.log.bind(this));
        if (txHash) {
          this.metabolicState.lastTxHash = txHash;
          await this.refreshMetabolism();
        }
      }
    }, METABOLISM_INTERVAL_MS);
  }

  async refreshMetabolism(): Promise<void> {
    try {
      const balance = await this.httpClient.getBalance({ address: this.account.address });
      const threshold = parseEther(process.env.MIN_GAS_LEVEL ?? '0.02');
      // 1 OKB = 100% health; 0.02 OKB threshold = 2%
      const maxForHealth = parseEther('0.5');
      const healthPercent = Math.min(100, Number((balance * 100n) / maxForHealth));

      this.metabolicState = {
        okbBalance: balance.toString(),
        okbBalanceFormatted: parseFloat(formatEther(balance)).toFixed(6),
        healthPercent,
        isRefuelNeeded: balance < threshold,
        lastTxHash: this.metabolicState.lastTxHash,
        checkedAt: Date.now(),
      };
    } catch {
      this.log('RPC', 'warn', 'Balance fetch failed — node congestion');
    }
  }

  // ── Internal logging ─────────────────────────────────────────────────────────

  private log(prefix: LogPrefix, level: LogLevel, message: string, txHash?: string): void {
    const entry: DaemonLog = {
      id: ++this.logId,
      ts: new Date().toISOString(),
      prefix,
      level,
      message,
      txHash,
    };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift();
    this.onLog?.(entry);

    // Mirror to console for terminal visibility
    const tag = `[${prefix}]`.padEnd(13);
    const tx  = txHash ? ` → ${txHash.slice(0, 14)}...` : '';
    console.log(`${entry.ts.slice(11, 19)} ${tag} ${message}${tx}`);
  }

  // ── State snapshot ───────────────────────────────────────────────────────────

  getDefiLlamaMetrics(startTimestamp: number, endTimestamp: number): {
    startTimestamp: number;
    endTimestamp: number;
    acceptedStakeCount: number;
    matchStakeCount: number;
    championStakeCount: number;
    dailyVolumeWei: string;
    dailyFeesWei: string;
    dailyRevenueWei: string;
    protocolFeeBps: number;
  } {
    const startMs = startTimestamp * 1000;
    const endMs = endTimestamp * 1000;
    const seen = new Set<string>();
    let acceptedStakeCount = 0;
    let matchStakeCount = 0;
    let championStakeCount = 0;
    let dailyVolumeWei = 0n;

    const includeStake = (stake: { txHash: string; amountWei: string; timestamp: number }, kind: 'match' | 'champion') => {
      const stakeMs = stake.timestamp > 10_000_000_000 ? stake.timestamp : stake.timestamp * 1000;
      if (stakeMs < startMs || stakeMs >= endMs) return;
      const txHash = stake.txHash.toLowerCase();
      if (seen.has(txHash)) return;
      seen.add(txHash);

      acceptedStakeCount += 1;
      if (kind === 'match') matchStakeCount += 1;
      else championStakeCount += 1;
      dailyVolumeWei += BigInt(stake.amountWei);
    };

    for (const stake of this.stakes.values()) {
      includeStake(stake, 'match');
    }
    for (const stake of this.champStakes) {
      includeStake(stake, 'champion');
    }
    for (const position of this.champHistory) {
      includeStake(position.stake, 'champion');
    }

    const dailyFeesWei = (dailyVolumeWei * PROTOCOL_FEE_BPS) / 10_000n;
    return {
      startTimestamp,
      endTimestamp,
      acceptedStakeCount,
      matchStakeCount,
      championStakeCount,
      dailyVolumeWei: dailyVolumeWei.toString(),
      dailyFeesWei: dailyFeesWei.toString(),
      dailyRevenueWei: dailyFeesWei.toString(),
      protocolFeeBps: Number(PROTOCOL_FEE_BPS),
    };
  }

  getState(): DaemonState {
    const byTeam: Record<string, string> = {};
    this.champPool.forEach((v, k) => { byTeam[k] = v.toString(); });
    const totalWei = Array.from(this.champPool.values()).reduce((s, v) => s + v, 0n).toString();

    const championPool: ChampionPool = {
      byTeam,
      totalWei,
      count: this.champStakes.length,
      settled: this.champSettled,
      winner: this.champWinner,
    };

    return {
      refereeAddress:  this.account.address,
      metabolism:      this.metabolicState,
      fixtures:        this.fixtures,
      pools:           Object.fromEntries(this.pools),
      recentLogs:      this.logs.slice(-120),
      lastBlock:       this.lastBlock,
      wsConnected:     this.wsConnected,
      settlements:     this.settlements.slice(-20),
      rejectedStakeRefunds: Array.from(this.rejectedStakeRefunds.values()).slice(-50),
      matchStates:     Object.fromEntries(this.providerMatchStates),
      championPool,
    };
  }
}
