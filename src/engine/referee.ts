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
  ChampionStake,
  ChampionPool,
  LogPrefix,
  LogLevel,
} from '../types.js';

const PROTOCOL_FEE_BPS = 50n; // 0.5%
const METABOLISM_INTERVAL_MS = 60_000;
const OUTCOME_MAP: Record<number, Outcome> = { 0: 'home', 1: 'draw', 2: 'away' };
const OUTCOME_INDEX: Record<Outcome, number> = { home: 0, draw: 1, away: 2 };

// ── Champion prediction market ─────────────────────────────────────────────────
export const CHAMP_FIXTURE_ID = 'champion-2026';
export const CHAMP_TEAMS = [
  'BRA','ECU','FRA','TUR','ARG','KOR','ENG','NGA',
  'ESP','DEN','POR','CMR','GER','MEX','NED','AUS',
  'BEL','JPN','ITA','COL','CRO','CAN','MAR','USA',
  'URU','EGY','SRB','SUI','ALG','KSA','CIV','SEN',
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
  private pools = new Map<string, Pool>();
  private settlements: SettlementResult[] = [];
  private champStakes: ChampionStake[] = [];
  private champPool = new Map<string, bigint>(CHAMP_TEAMS.map(t => [t, 0n]));
  private champSettled = false;
  private champWinner?: string;
  private simulator: MatchSimulator;

  private logs: DaemonLog[] = [];
  private logId = 0;
  private lastBlock = 0;
  private wsConnected = false;
  private metabolicState: MetabolicState;

  public onLog?: (log: DaemonLog) => void;
  public onUpdate?: () => void;

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
      this.pools.set(f.id, { fixtureId: f.id, home: '0', draw: '0', away: '0', fees: '0', count: 0 });
    }

    this.simulator = new MatchSimulator(
      (_fixtureId, _state) => this.onUpdate?.(),
      async (fixtureId, outcome) => { await this.settleFixture(fixtureId, outcome); },
      this.log.bind(this),
    );
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.log('SYSTEM', 'info', `RefereeEngine starting — wallet ${this.account.address}`);
    await this.refreshMetabolism();
    this.startWebSocketListener();
    this.startMetabolismLoop();

    // Simulation mode: schedule compressed matches
    const simulated = this.fixtures.filter(f => f.mode === 'simulated');
    if (simulated.length > 0) {
      const delayMins    = parseInt(process.env.SIM_FIRST_KICKOFF_DELAY ?? '30');
      const intervalMins = parseInt(process.env.SIM_MATCH_INTERVAL_MINS ?? '60');
      const firstKickoff = Date.now() + delayMins * 60_000;
      this.simulator.schedule(simulated, firstKickoff, intervalMins * 60_000);
      this.log('SYSTEM', 'success', `Simulation scheduled — ${simulated.length} matches, first kickoff in ${delayMins} min, ${intervalMins} min intervals`);
    }

    this.log('SYSTEM', 'success', `Engine live on X Layer Mainnet (chain 196). Watching ${this.fixtures.length} fixtures.`);
  }

  // ── WebSocket block listener ─────────────────────────────────────────────────

  private httpPollerStarted = false;

  private startWebSocketListener(): void {
    // Always start HTTP poller as baseline — WS upgrades it if available
    this.startHttpPoller();

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
        this.onUpdate?.();
        return;
      }

      // ── Match stake ────────────────────────────────────────────────────────
      const { fixtureId, outcome } = decoded;
      const fixture = this.fixtures.find((f) => f.id === fixtureId);

      if (!fixture || fixture.status !== 'open') {
        this.log('STAKE', 'warn', `Rejected stake — fixture "${fixtureId}" not open (tx ${tx.hash.slice(0, 10)}...)`);
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

      this.onUpdate?.();
    } catch {
      // Not a stake transaction — plain OKB transfer or unrelated calldata
    }
  }

  // ── Champion settlement ──────────────────────────────────────────────────────

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

  private async settleChampion(winner: string): Promise<void> {
    if (this.champSettled) throw new Error('Champion market already settled');
    if (!CHAMP_TEAMS.includes(winner)) throw new Error(`Unknown team: ${winner}`);

    this.champSettled = true;
    this.champWinner  = winner;

    const totalPool = Array.from(this.champPool.values()).reduce((s, v) => s + v, 0n);
    const winPool   = this.champPool.get(winner) ?? 0n;
    const winners   = this.champStakes.filter(s => s.teamCode === winner);

    this.log('ORACLE', 'info', `Champion: ${winner} · total pool ${formatEther(totalPool)} OKB · ${winners.length} winner(s)`);

    if (winPool === 0n && this.champStakes.length > 0) {
      for (const s of this.champStakes) {
        const gross  = BigInt(s.amountWei);
        const refund = gross - (gross * PROTOCOL_FEE_BPS) / 10_000n;
        try {
          const txHash = await this.walletClient.sendTransaction({ account: this.account, to: s.staker as Address, value: refund, chain: xLayerMainnet });
          this.log('ORACLE', 'success', `Champion refund ${formatEther(refund)} OKB → ${s.staker.slice(0, 10)}...`, txHash);
        } catch (err: unknown) {
          this.log('ORACLE', 'error', `Champion refund failed → ${s.staker.slice(0, 10)}...: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else {
      for (const s of winners) {
        const stake  = BigInt(s.amountWei);
        const net    = stake - (stake * PROTOCOL_FEE_BPS) / 10_000n;
        const payout = winPool > 0n ? (net * totalPool) / winPool : 0n;
        if (payout === 0n) continue;
        try {
          const txHash = await this.walletClient.sendTransaction({ account: this.account, to: s.staker as Address, value: payout, chain: xLayerMainnet });
          this.log('ORACLE', 'success', `Champion payout ${formatEther(payout)} OKB → ${s.staker.slice(0, 10)}...`, txHash);
        } catch (err: unknown) {
          this.log('ORACLE', 'error', `Champion payout failed → ${s.staker.slice(0, 10)}...: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    this.onUpdate?.();
  }

  // ── Oracle Override ──────────────────────────────────────────────────────────

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

    const payouts: SettlementResult['payouts'] = [];

    // ── No-winner edge case: refund all stakers (principal minus fee) ──────
    if (winPool === 0n && allFixtureStakes.length > 0) {
      this.log('ORACLE', 'warn', `No stakes on winning outcome (${outcome}) — refunding ${allFixtureStakes.length} stakers`);
      for (const staker of allFixtureStakes) {
        const gross = BigInt(staker.amountWei);
        const fee   = (gross * PROTOCOL_FEE_BPS) / 10_000n;
        const refund = gross - fee;
        try {
          const txHash = await this.walletClient.sendTransaction({
            account: this.account,
            to: staker.staker as Address,
            value: refund,
            chain: xLayerMainnet,
          });
          payouts.push({ address: staker.staker, amountWei: refund.toString(), txHash });
          this.log('ORACLE', 'success', `Refund ${formatEther(refund)} OKB → ${staker.staker.slice(0, 10)}...`, txHash);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log('ORACLE', 'error', `Refund failed → ${staker.staker.slice(0, 10)}...: ${msg}`);
        }
      }
    } else {
      // ── Normal payout to winners ──────────────────────────────────────────
      for (const winner of winners) {
        const stake  = BigInt(winner.amountWei);
        const fee    = (stake * PROTOCOL_FEE_BPS) / 10_000n;
        const net    = stake - fee;
        const payout = winPool > 0n ? (net * totalPool) / winPool : 0n;
        if (payout === 0n) continue;
        try {
          const txHash = await this.walletClient.sendTransaction({
            account: this.account,
            to: winner.staker as Address,
            value: payout,
            chain: xLayerMainnet,
          });
          payouts.push({ address: winner.staker, amountWei: payout.toString(), txHash });
          this.log('ORACLE', 'success', `Payout ${formatEther(payout)} OKB → ${winner.staker.slice(0, 10)}...${winner.staker.slice(-4)}`, txHash);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log('ORACLE', 'error', `Payout failed → ${winner.staker.slice(0, 10)}...: ${msg}`);
        }
      }
    }

    fixture.status = 'settled';
    fixture.result = outcome;

    const result: SettlementResult = {
      fixtureId,
      outcome,
      totalPool: totalPool.toString(),
      winnerCount: winners.length,
      payouts,
      blockNumber: this.lastBlock,
      explorerUrl: payouts[0] ? explorerTx(payouts[0].txHash) : `https://www.okx.com/web3/explorer/xlayer/address/${this.account.address}`,
    };

    this.settlements.push(result);

    // Auto-settle champion market when the Final (f-1) completes
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
    return result;
  }

  // ── Metabolism loop ──────────────────────────────────────────────────────────

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
      matchStates:     this.simulator.getStates(),
      simulationMode:  this.fixtures.some(f => f.mode === 'simulated'),
      championPool,
    };
  }
}
