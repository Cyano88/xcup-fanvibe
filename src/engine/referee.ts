import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  formatEther,
  parseEther,
  hashMessage,
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
import type {
  Fixture,
  Stake,
  Pool,
  DaemonLog,
  DaemonState,
  MetabolicState,
  Outcome,
  SettlementResult,
  LogPrefix,
  LogLevel,
} from '../types.js';

const PROTOCOL_FEE_BPS = 50n; // 0.5%
const METABOLISM_INTERVAL_MS = 60_000;
const OUTCOME_MAP: Record<number, Outcome> = { 0: 'home', 1: 'draw', 2: 'away' };
const OUTCOME_INDEX: Record<Outcome, number> = { home: 0, draw: 1, away: 2 };

// ── Calldata codec ─────────────────────────────────────────────────────────────
export function encodeStake(fixtureId: string, outcome: Outcome): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint8' }],
    [toHex(fixtureId, { size: 32 }), OUTCOME_INDEX[outcome]],
  );
}

function decodeStakeTx(data: `0x${string}`): { fixtureId: string; outcome: Outcome } {
  if (!data || data.length < 66) throw new Error('insufficient calldata');
  const [fixtureBytes32, outcomeNum] = decodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint8' }],
    data,
  );
  const raw = Buffer.from(fixtureBytes32.slice(2), 'hex').toString('utf8').replace(/\0+$/, '');
  const outcome = OUTCOME_MAP[Number(outcomeNum)];
  if (!outcome) throw new Error(`invalid outcome index ${outcomeNum}`);
  return { fixtureId: raw, outcome };
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
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.log('SYSTEM', 'info', `RefereeEngine starting — wallet ${this.account.address}`);
    await this.refreshMetabolism();
    this.startWebSocketListener();
    this.startMetabolismLoop();
    this.log('SYSTEM', 'success', `Engine live on X Layer Mainnet (chain 196). Watching ${this.fixtures.length} fixtures.`);
  }

  // ── WebSocket block listener ─────────────────────────────────────────────────

  private startWebSocketListener(): void {
    try {
      const wsClient = createPublicClient({
        chain: xLayerMainnet,
        transport: webSocket('wss://rpc.xlayer.tech', { reconnect: { attempts: 10, delay: 3000 } }),
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
          this.log('RPC', 'warn', 'WebSocket disconnected — reconnecting...');
        },
      });

      this.log('RPC', 'info', 'WebSocket listener active — watching X Layer Mainnet blocks...');
    } catch {
      this.wsConnected = false;
      this.log('RPC', 'warn', 'WebSocket unavailable — running in HTTP poll mode');
      this.startHttpPoller();
    }
  }

  private startHttpPoller(): void {
    setInterval(async () => {
      try {
        const block = await this.httpClient.getBlock({ includeTransactions: true });
        if (Number(block.number) > this.lastBlock) {
          this.lastBlock = Number(block.number);
          this.scanBlock(block as Block & { transactions: Transaction[] });
        }
      } catch {
        this.log('RPC', 'warn', 'Block poll failed');
      }
    }, 12_000);
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

    try {
      const { fixtureId, outcome } = decodeStakeTx(tx.input ?? '0x');
      const fixture = this.fixtures.find((f) => f.id === fixtureId);

      if (!fixture || fixture.status !== 'open') {
        this.log('STAKE', 'warn', `Rejected stake — fixture "${fixtureId}" not open (tx ${tx.hash.slice(0, 10)}...)`);
        return;
      }

      const gross = tx.value;
      const fee = (gross * PROTOCOL_FEE_BPS) / 10_000n;
      const net = gross - fee;

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

    const winners = Array.from(this.stakes.values()).filter(
      (s) => s.fixtureId === fixtureId && s.outcome === outcome,
    );

    this.log('ORACLE', 'info', `Settling ${fixtureId}: pool ${formatEther(totalPool)} OKB · ${winners.length} winner(s)`);

    const payouts: SettlementResult['payouts'] = [];

    for (const winner of winners) {
      const stake = BigInt(winner.amountWei);
      const fee = (stake * PROTOCOL_FEE_BPS) / 10_000n;
      const net = stake - fee;
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
        this.log(
          'ORACLE',
          'success',
          `Payout ${formatEther(payout)} OKB → ${winner.staker.slice(0, 10)}...${winner.staker.slice(-4)}`,
          txHash,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log('ORACLE', 'error', `Payout failed → ${winner.staker.slice(0, 10)}...: ${msg}`);
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
  }

  // ── State snapshot ───────────────────────────────────────────────────────────

  getState(): DaemonState {
    return {
      refereeAddress: this.account.address,
      metabolism: this.metabolicState,
      fixtures: this.fixtures,
      pools: Object.fromEntries(this.pools),
      recentLogs: this.logs.slice(-120),
      lastBlock: this.lastBlock,
      wsConnected: this.wsConnected,
      settlements: this.settlements.slice(-20),
    };
  }
}
