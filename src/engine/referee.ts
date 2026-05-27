import {
  createPublicClient,
  createWalletClient,
  http,
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
import { xLayerMainnet, explorerTx } from '../chain.js';
import { FIXTURES } from './fixtures.js';
import { checkAndRefuel } from './metabolism.js';
import { MatchSimulator } from './simulation.js';
import { readRefereeMarket, writeRefereeMarket, type PersistedSettlementJob } from '../seasonStore.js';
import type {
  Fixture,
  Team,
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

const TBD_TEAM: Team = { name: 'TBD', code: 'TBD', flag: '🏆', iso: 'un' };
const NEXT_SIM_KICKOFF_MS = Number(process.env.SIM_NEXT_KICKOFF_MS ?? '30000');

const BRACKET: Record<string, {
  winner: { matchId: string; slot: 'home' | 'away' };
  loser?: { matchId: string; slot: 'home' | 'away' };
}> = {
  'k32-1':  { winner: { matchId: 'k16-1', slot: 'home' } },
  'k32-2':  { winner: { matchId: 'k16-1', slot: 'away' } },
  'k32-3':  { winner: { matchId: 'k16-2', slot: 'home' } },
  'k32-4':  { winner: { matchId: 'k16-2', slot: 'away' } },
  'k32-5':  { winner: { matchId: 'k16-3', slot: 'home' } },
  'k32-6':  { winner: { matchId: 'k16-3', slot: 'away' } },
  'k32-7':  { winner: { matchId: 'k16-4', slot: 'home' } },
  'k32-8':  { winner: { matchId: 'k16-4', slot: 'away' } },
  'k32-9':  { winner: { matchId: 'k16-5', slot: 'home' } },
  'k32-10': { winner: { matchId: 'k16-5', slot: 'away' } },
  'k32-11': { winner: { matchId: 'k16-6', slot: 'home' } },
  'k32-12': { winner: { matchId: 'k16-6', slot: 'away' } },
  'k32-13': { winner: { matchId: 'k16-7', slot: 'home' } },
  'k32-14': { winner: { matchId: 'k16-7', slot: 'away' } },
  'k32-15': { winner: { matchId: 'k16-8', slot: 'home' } },
  'k32-16': { winner: { matchId: 'k16-8', slot: 'away' } },
  'k16-1':  { winner: { matchId: 'qf-1', slot: 'home' } },
  'k16-2':  { winner: { matchId: 'qf-1', slot: 'away' } },
  'k16-3':  { winner: { matchId: 'qf-2', slot: 'home' } },
  'k16-4':  { winner: { matchId: 'qf-2', slot: 'away' } },
  'k16-5':  { winner: { matchId: 'qf-3', slot: 'home' } },
  'k16-6':  { winner: { matchId: 'qf-3', slot: 'away' } },
  'k16-7':  { winner: { matchId: 'qf-4', slot: 'home' } },
  'k16-8':  { winner: { matchId: 'qf-4', slot: 'away' } },
  'qf-1':   { winner: { matchId: 'sf-1', slot: 'home' } },
  'qf-2':   { winner: { matchId: 'sf-1', slot: 'away' } },
  'qf-3':   { winner: { matchId: 'sf-2', slot: 'home' } },
  'qf-4':   { winner: { matchId: 'sf-2', slot: 'away' } },
  'sf-1':   { winner: { matchId: 'f-1', slot: 'home' }, loser: { matchId: '3pl-1', slot: 'home' } },
  'sf-2':   { winner: { matchId: 'f-1', slot: 'away' }, loser: { matchId: '3pl-1', slot: 'away' } },
};

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

  private fixtures: Fixture[] = structuredClone(FIXTURES);
  private stakes = new Map<string, Stake>();
  private rejectedStakeRefunds = new Map<string, RejectedStakeRefund>();
  private pools = new Map<string, Pool>();
  private settlements: SettlementResult[] = [];
  private settlementJobs = new Map<string, PersistedSettlementJob>();
  private champStakes: ChampionStake[] = [];
  private champPool = new Map<string, bigint>(CHAMP_TEAMS.map(t => [t, 0n]));
  private champSettled = false;
  private champWinner?: string;
  private championSeasonNumber?: number;
  private simulator: MatchSimulator;

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
    const rpc = process.env.X_LAYER_MAINNET_RPC ?? 'https://rpc.xlayer.tech';

    this.httpClient = createPublicClient({ chain: xLayerMainnet, transport: http(rpc) });
    this.walletClient = createWalletClient({ chain: xLayerMainnet, transport: http(rpc), account: this.account });

    this.metabolicState = {
      okbBalance: '0',
      okbBalanceFormatted: '0.000000',
      healthPercent: 0,
      isRefuelNeeded: false,
      checkedAt: Date.now(),
    };

    for (const f of this.fixtures) {
      if (f.mode === 'simulated' && f.round && f.round !== 'R32') {
        f.home = { ...TBD_TEAM };
        f.away = { ...TBD_TEAM };
        f.status = 'upcoming';
      }
      this.pools.set(f.id, { fixtureId: f.id, home: '0', draw: '0', away: '0', fees: '0', count: 0 });
    }

    this.simulator = new MatchSimulator(
      (_fixtureId, _state) => this.onUpdate?.(),
      async (fixtureId, outcome) => { await this.settleFixture(fixtureId, outcome); },
      this.log.bind(this),
    );
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  syncFixtures(fixtures: Fixture[]): void {
    let changed = false;

    for (const incoming of fixtures) {
      if (!incoming?.id || incoming.home?.code === 'TBD' || incoming.away?.code === 'TBD') continue;

      const existing = this.fixtures.find(f => f.id === incoming.id);
      if (existing) {
        const keepSettlement = existing.status === 'settled' && incoming.status === 'settled';
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

  async settleSyncedFixture(fixtureId: string, outcome: Outcome): Promise<SettlementResult | null> {
    const fixture = this.fixtures.find(f => f.id === fixtureId);
    if (!fixture || fixture.status === 'settled') return null;
    return this.settleFixture(fixtureId, outcome);
  }

  getPositions(address: string) {
    const wallet = address.toLowerCase();
    const stakePositions = Array.from(this.stakes.values())
      .filter(stake => stake.staker.toLowerCase() === wallet)
      .map(stake => {
        const fixture = this.fixtures.find(f => f.id === stake.fixtureId);
        const stakeMs = stake.timestamp > 10_000_000_000 ? stake.timestamp : stake.timestamp * 1000;
        const settlement = this.settlements.find(s => s.fixtureId === stake.fixtureId && s.settledAt >= stakeMs);
        const settledOutcome = settlement?.outcome ?? (fixture?.status === 'settled' ? fixture.result : undefined);
        const won = settledOutcome ? settledOutcome === stake.outcome : false;
        const payout = won ? settlement?.payouts.find(p => p.address.toLowerCase() === wallet) : undefined;
        return {
          type: 'match' as const,
          status: payout ? 'paid' : settledOutcome ? (won ? 'won_pending_payout' : 'lost') : 'active',
          stake,
          fixture,
          settlement,
          payout,
        };
      });

    const championPositions = this.champStakes
      .filter(stake => stake.staker.toLowerCase() === wallet)
      .map(stake => ({
        type: 'champion' as const,
        status: this.champSettled ? (this.champWinner === stake.teamCode ? 'settled_winner' : 'settled_lost') : 'active',
        stake,
        winner: this.champWinner,
      }));

    const refunds = Array.from(this.rejectedStakeRefunds.values())
      .filter(refund => refund.staker.toLowerCase() === wallet)
      .map(refund => ({ type: 'refund' as const, status: refund.status, refund }));

    return [...stakePositions, ...championPositions, ...refunds]
      .sort((a, b) => {
        const at = 'stake' in a ? a.stake.timestamp : a.refund.timestamp;
        const bt = 'stake' in b ? b.stake.timestamp : b.refund.timestamp;
        return bt - at;
      });
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

    this.championSeasonNumber = seasonNumber;
    this.champStakes = [];
    this.champPool = new Map(CHAMP_TEAMS.map(team => [team, 0n]));
    this.champSettled = false;
    this.champWinner = undefined;
    this.log('SYSTEM', 'info', `Champion market opened for Season ${seasonNumber}`);
    this.persistMarketState();
    this.onUpdate?.();
  }

  async start(): Promise<void> {
    this.log('SYSTEM', 'info', `RefereeEngine starting — wallet ${this.account.address}`);
    await this.loadMarketState();
    await this.resumeSettlementJobs();
    await this.refreshMetabolism();
    this.startWebSocketListener();
    this.startMetabolismLoop();

    // Simulation mode: schedule compressed matches
    const simulated = this.fixtures.filter(f => f.mode === 'simulated' && f.home.code !== 'TBD' && f.away.code !== 'TBD');
    if (simulated.length > 0) {
      const delayMins    = parseInt(process.env.SIM_FIRST_KICKOFF_DELAY ?? '5');
      const intervalMins = parseInt(process.env.SIM_MATCH_INTERVAL_MINS ?? '0');
      const firstKickoff = Date.now() + delayMins * 60_000;
      this.simulator.schedule(simulated, firstKickoff, intervalMins * 60_000);
      this.log('SYSTEM', 'success', `Simulation scheduled — ${simulated.length} matches, first kickoff in ${delayMins} min, ${intervalMins} min intervals`);
    }

    this.log('SYSTEM', 'success', `Engine live on X Layer Mainnet (chain 196). Watching ${this.fixtures.length} fixtures.`);
  }

  // ── WebSocket block listener ─────────────────────────────────────────────────

  private async loadMarketState(): Promise<void> {
    const stored = await readRefereeMarket();
    if (!stored) return;

    this.stakes = new Map(stored.stakes.map(stake => [stake.txHash, stake]));
    this.rejectedStakeRefunds = new Map(stored.rejectedStakeRefunds.map(refund => [refund.txHash, refund]));
    this.pools = new Map(stored.pools.map(pool => [pool.fixtureId, pool]));
    this.settlements = stored.settlements;
    this.settlementJobs = new Map((stored.settlementJobs ?? []).map(job => [job.id, job]));
    this.champStakes = stored.champStakes;
    this.champPool = new Map(CHAMP_TEAMS.map(team => [team, BigInt(stored.champPool[team] ?? '0')]));
    this.champSettled = stored.champSettled;
    this.champWinner = stored.champWinner;
    this.championSeasonNumber = stored.championSeasonNumber;
    this.lastBlock = stored.lastBlock;

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
        if (!this.settlements.some(s => s.fixtureId === job.fixtureId)) {
          this.settlements.push(this.resultFromSettlementJob(job));
        }
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
      settlements: this.settlements,
      settlementJobs: Array.from(this.settlementJobs.values()),
      champStakes: this.champStakes,
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

  async resetMarketState(fixtures = this.fixtures): Promise<void> {
    this.simulator.cancelAll();
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

        // Scan every missed block since last poll (cap at 20 to avoid overload)
        const from = this.lastBlock + 1;
        const to   = Math.min(latestNum, from + 20);

        for (let n = from; n <= to; n++) {
          const block = await this.httpClient.getBlock({ blockNumber: BigInt(n), includeTransactions: true });
          this.scanBlock(block as Block & { transactions: Transaction[] });
        }

        this.lastBlock = to;
        this.onUpdate?.();
      } catch {
        this.log('RPC', 'warn', 'Block range poll failed');
      }
    }, 12_000);
  }

  // Direct TX lookup — called when frontend reports a confirmed stake hash
  async reportStakeTx(txHash: `0x${string}`): Promise<void> {
    try {
      const tx = await this.httpClient.getTransaction({ hash: txHash });
      if (!tx) return;
      const block = await this.httpClient.getBlock({ blockNumber: tx.blockNumber!, includeTransactions: false });
      this.processStakeTx(tx as unknown as Transaction, Number(block.timestamp));
      this.onUpdate?.();
    } catch {
      this.log('RPC', 'warn', `Failed to look up reported TX ${txHash}`);
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

      if (!fixture || fixture.home.code === 'TBD' || fixture.away.code === 'TBD' || fixture.status === 'locked' || fixture.status === 'settled') {
        const reason = fixture?.status === 'locked'
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

    const record: RejectedStakeRefund = {
      txHash: tx.hash,
      staker: tx.from,
      fixtureId,
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
    const payouts = job.payouts
      .filter(payout => payout.status === 'sent' && payout.txHash)
      .map(payout => ({ address: payout.address, amountWei: payout.amountWei, txHash: payout.txHash! }));

    return {
      fixtureId: job.fixtureId,
      outcome: job.outcome,
      totalPool: job.totalPool,
      winnerCount: job.winnerCount,
      payouts,
      blockNumber: job.blockNumber,
      explorerUrl: payouts[0] ? explorerTx(payouts[0].txHash) : `https://www.okx.com/web3/explorer/xlayer/address/${this.account.address}`,
      settledAt: job.settledAt,
    };
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

  private async settleFixture(fixtureId: string, outcome: Outcome): Promise<SettlementResult> {
    const fixture = this.fixtures.find((f) => f.id === fixtureId);
    if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);
    if (fixture.status === 'settled') throw new Error(`Fixture ${fixtureId} already settled`);

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
    this.advanceBracket(fixture, outcome);

    const resumedResult = this.resultFromSettlementJob(job);
    if (!this.settlements.some(s => s.fixtureId === fixtureId)) {
      this.settlements.push(resumedResult);
      await this.persistMarketStateNow();
    }

    if (fixtureId === 'f-1' && !this.champSettled) {
      const champTeam = outcome === 'away' ? fixture.away : fixture.home;
      if (champTeam && CHAMP_TEAMS.includes(champTeam.code)) {
        this.settleChampion(champTeam.code).catch((err: unknown) => {
          this.log('ORACLE', 'error', `Champion auto-settle failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }

    this.onUpdate?.();
    await this.refreshMetabolism();
    return resumedResult;
  }

  // Metabolism loop ──────────────────────────────────────────────────────────

  private advanceBracket(fixture: Fixture, outcome: Outcome): void {
    if (fixture.mode !== 'simulated') return;
    const entry = BRACKET[fixture.id];
    if (!entry) return;

    const winner = outcome === 'away' ? fixture.away
      : outcome === 'home' ? fixture.home
      : Math.random() > 0.5 ? fixture.home : fixture.away;
    const loser = winner.code === fixture.home.code ? fixture.away : fixture.home;

    this.placeAdvancingTeam(entry.winner, winner);
    if (entry.loser) this.placeAdvancingTeam(entry.loser, loser);
  }

  private placeAdvancingTeam(target: { matchId: string; slot: 'home' | 'away' }, team: Team): void {
    const next = this.fixtures.find((f) => f.id === target.matchId);
    if (!next) return;

    next[target.slot] = team;
    const ready = next.home.code !== 'TBD' && next.away.code !== 'TBD';
    if (!ready || next.status === 'locked' || next.status === 'settled') return;

    next.status = 'upcoming';
    next.baseOdds = { home: 50, draw: 25, away: 25 };
    this.log('SYSTEM', 'info', `Qualified: ${team.code} -> ${next.id} ${target.slot}`);
    this.simulator.schedule([next], Date.now() + NEXT_SIM_KICKOFF_MS, 0);
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
      matchStates:     this.simulator.getStates(),
      simulationMode:  this.fixtures.some(f => f.mode === 'simulated'),
      championPool,
    };
  }
}
