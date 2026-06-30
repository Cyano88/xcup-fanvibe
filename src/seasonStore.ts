import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pg from 'pg';
import type { Fixture, MatchState, Team, Stake, Pool, SettlementResult, RejectedStakeRefund, ChampionStake } from './types.js';

export type SeasonPhase = 'preseason' | 'playing' | 'champion' | 'interseason';
export type SeasonStorageMode = 'prod' | 'test';

export interface SeasonTiming {
  preseasonSeconds: number;
  matchMs: number;
  matchdayGapMs: number;
  interseasonSeconds: number;
  waveGapMs: number;
}

export interface PersistedSeasonState {
  version: 1;
  mode: SeasonStorageMode;
  seasonNumber: number;
  phase: SeasonPhase;
  phaseEndsAt: number;
  phaseTimer: number;
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  eliminatedTeams: string[];
  champion: Team | null;
  previousKnockoutResults?: {
    seasonNumber: number;
    champion: Team | null;
    fixtures: Fixture[];
    matchStates: Record<string, MatchState>;
  } | null;
  seasonWinners?: Array<{
    seasonNumber: number;
    team: Team;
  }>;
  tournamentGen: number;
  timings: SeasonTiming;
  updatedAt: number;
}

const STORE_DIR = process.env.SEASON_STATE_DIR ?? join(process.cwd(), '.fanvibe-state');
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const POSTGRES_URL = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const configuredPostgresTable = process.env.FANVIBE_POSTGRES_TABLE ?? 'fanvibe_state';
const POSTGRES_TABLE = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(configuredPostgresTable)
  ? configuredPostgresTable
  : 'fanvibe_state';

const keyFor = (mode: SeasonStorageMode) => `fanvibe:season:${mode}`;
const fileFor = (mode: SeasonStorageMode) => join(STORE_DIR, `${keyFor(mode).replace(/:/g, '-')}.json`);
const engineKeyFor = () => 'fanvibe:referee:market';
const engineFileFor = () => join(STORE_DIR, 'fanvibe-referee-market.json');
const appDataKeyFor = () => 'fanvibe:app:data';
const appDataFileFor = () => join(STORE_DIR, 'fanvibe-app-data.json');

export function seasonStorageStatus() {
  const postgresConfigured = !!POSTGRES_URL;
  return {
    driver: postgresConfigured ? 'postgres' : UPSTASH_URL && UPSTASH_TOKEN ? 'upstash' : 'file',
    storeDir: postgresConfigured || (UPSTASH_URL && UPSTASH_TOKEN) ? null : STORE_DIR,
    postgresConfigured,
    upstashConfigured: !!(UPSTASH_URL && UPSTASH_TOKEN),
  };
}

export interface PersistedRefereeMarket {
  version: 1;
  stakes: Stake[];
  rejectedStakeRefunds: RejectedStakeRefund[];
  pools: Pool[];
  settlements: SettlementResult[];
  settlementJobs?: PersistedSettlementJob[];
  champStakes: ChampionStake[];
  champHistory?: PersistedChampionPosition[];
  champPool: Record<string, string>;
  champSettled: boolean;
  champWinner?: string;
  championSeasonNumber?: number;
  lastBlock: number;
  updatedAt: number;
}

export interface PersistedChampionPosition {
  stake: ChampionStake;
  winner: string;
  settledAt: number;
  seasonNumber?: number;
}

export interface PersistedSettlementPayout {
  id: string;
  address: string;
  amountWei: string;
  status: 'pending' | 'sent' | 'failed';
  txHash?: string;
  error?: string;
}

export interface PersistedSettlementJob {
  id: string;
  type: 'match' | 'champion';
  status: 'paying' | 'complete';
  fixtureId?: string;
  fixture?: Fixture;
  outcome?: SettlementResult['outcome'];
  teamCode?: string;
  totalPool: string;
  winnerCount: number;
  blockNumber: number;
  settledAt: number;
  payouts: PersistedSettlementPayout[];
}

export interface PersistedFanProfile {
  address: string;
  name: string;
  updatedAt: number;
}

export interface PersistedReferral {
  referrer: string;
  referred: string;
  firstTxHash?: string;
  createdAt: number;
  qualifiedAt?: number;
  qualifyingAmountWei?: string;
  rewardEpoch?: string;
  referrerRewardWei?: string;
  referredRewardWei?: string;
  rewardStatus?: 'pending' | 'claimable' | 'paid' | 'blocked';
  rewardPayoutTxHash?: string;
  referrerRewardStatus?: 'pending' | 'claimable' | 'paid' | 'blocked';
  referredRewardStatus?: 'pending' | 'claimable' | 'paid' | 'blocked';
  referrerRewardPayoutTxHash?: string;
  referredRewardPayoutTxHash?: string;
  referrerRewardPaidAt?: number;
  referredRewardPaidAt?: number;
  blockReason?: string;
  status: 'captured' | 'qualified';
}

export interface PersistedFvbTradeWallet {
  address: string;
  fvbVolumeWei: string;
  estimatedOkbVolumeWei: string;
  transfers: number;
  lastTradeAt: number;
  daily?: Record<string, PersistedFvbTradeDaily>;
}

export interface PersistedFvbTradeDaily {
  date: string;
  fvbVolumeWei: string;
  estimatedOkbVolumeWei: string;
  transfers: number;
  updatedAt: number;
}

export interface PersistedFvbTradeIndex {
  tokenAddress: string;
  lastScannedBlock: number;
  holderLastScannedBlock?: number;
  updatedAt: number;
  source: 'transfer_logs';
  scopedCounterparties: string[];
  holderCandidates?: Record<string, string>;
  wallets: Record<string, PersistedFvbTradeWallet>;
  daily?: Record<string, PersistedFvbTradeDaily>;
  processedLogs?: Record<string, string>;
  backfill?: {
    status: 'idle' | 'running' | 'complete' | 'failed';
    startedAt?: number;
    completedAt?: number;
    fromBlock?: number;
    toBlock?: number;
    lastScannedBlock?: number;
    logsIndexed?: number;
    error?: string;
  };
}

export interface PersistedAppData {
  version: 1;
  profiles: Record<string, PersistedFanProfile>;
  referrals: PersistedReferral[];
  pendingStakeReports: string[];
  fvbTradeIndex?: PersistedFvbTradeIndex;
  xProfiles?: Record<string, PersistedXProfile>;
  xDailyStats?: Record<string, PersistedXDailyStats>;
  xAuthStates?: Record<string, PersistedXAuthState>;
  updatedAt: number;
}

export interface PersistedXProfile {
  address: string;
  xUserId: string;
  handle: string;
  connectedAt: number;
  updatedAt: number;
  accessTokenCipher?: string;
  refreshTokenCipher?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
  lastSyncedAt?: number;
}

export interface PersistedXDailyStats {
  address: string;
  xUserId: string;
  handle: string;
  date: string;
  impressions: number;
  engagements: number;
  tweets: number;
  updatedAt: number;
}

export interface PersistedXAuthState {
  address: string;
  codeVerifier: string;
  createdAt: number;
  returnTo?: string;
}

async function upstash<T>(command: unknown[]): Promise<T | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const json = await res.json() as { result?: T };
  return json.result ?? null;
}

const { Pool: PgPool } = pg;
let pgPool: pg.Pool | null = null;
let pgReady: Promise<void> | null = null;

function postgresSsl() {
  if (process.env.PGSSL === '1' || process.env.PGSSLMODE === 'require') {
    return { rejectUnauthorized: false };
  }
  if (POSTGRES_URL?.includes('sslmode=require')) return { rejectUnauthorized: false };
  return undefined;
}

function postgresPool(): pg.Pool | null {
  if (!POSTGRES_URL) return null;
  if (!pgPool) {
    pgPool = new PgPool({
      connectionString: POSTGRES_URL,
      ssl: postgresSsl(),
      max: Number(process.env.POSTGRES_POOL_MAX ?? '4'),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pgPool;
}

async function ensurePostgres(): Promise<void> {
  const pool = postgresPool();
  if (!pool) return;
  pgReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS ${POSTGRES_TABLE} (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `).then(() => undefined);
  await pgReady;
}

async function readPostgres<T>(key: string): Promise<T | null> {
  const pool = postgresPool();
  if (!pool) return null;
  await ensurePostgres();
  const result = await pool.query<{ value: T }>(
    `SELECT value FROM ${POSTGRES_TABLE} WHERE key = $1 LIMIT 1`,
    [key],
  );
  return result.rows[0]?.value ?? null;
}

async function writePostgres(key: string, value: unknown): Promise<void> {
  const pool = postgresPool();
  if (!pool) return;
  await ensurePostgres();
  await pool.query(
    `INSERT INTO ${POSTGRES_TABLE} (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

async function deletePostgres(key: string): Promise<void> {
  const pool = postgresPool();
  if (!pool) return;
  await ensurePostgres();
  await pool.query(`DELETE FROM ${POSTGRES_TABLE} WHERE key = $1`, [key]);
}

async function readFallbackJson<T>(key: string, filePath: string): Promise<T | null> {
  try {
    const raw = await upstash<string>(['GET', key]);
    if (raw) return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[FanVibe] Upstash read failed for ${key}: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const file = await readFile(filePath, 'utf8');
    return JSON.parse(file) as T;
  } catch {
    return null;
  }
}

export async function readSeasonState(mode: SeasonStorageMode): Promise<PersistedSeasonState | null> {
  const key = keyFor(mode);
  const pgState = await readPostgres<PersistedSeasonState>(key);
  if (pgState) return pgState;

  const fallback = await readFallbackJson<PersistedSeasonState>(key, fileFor(mode));
  if (fallback && POSTGRES_URL) {
    await writePostgres(key, fallback);
  }
  return fallback;
}

export async function writeSeasonState(mode: SeasonStorageMode, state: PersistedSeasonState): Promise<void> {
  const payload = { ...state, mode, updatedAt: Date.now() };
  if (POSTGRES_URL) {
    await writePostgres(keyFor(mode), payload);
    return;
  }

  const serialized = JSON.stringify(payload);
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await upstash(['SET', keyFor(mode), serialized]);
      return;
    } catch (err) {
      console.warn(`[FanVibe] Upstash write failed for ${keyFor(mode)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const target = fileFor(mode);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialized);
}

export async function clearSeasonState(mode: SeasonStorageMode): Promise<void> {
  if (POSTGRES_URL) {
    await deletePostgres(keyFor(mode));
    return;
  }

  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await upstash(['DEL', keyFor(mode)]);
      return;
    } catch (err) {
      console.warn(`[FanVibe] Upstash delete failed for ${keyFor(mode)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    await unlink(fileFor(mode));
  } catch {
    // No local snapshot to clear.
  }
}

export async function readRefereeMarket(): Promise<PersistedRefereeMarket | null> {
  const key = engineKeyFor();
  const pgState = await readPostgres<PersistedRefereeMarket>(key);
  if (pgState) return pgState;

  const fallback = await readFallbackJson<PersistedRefereeMarket>(key, engineFileFor());
  if (fallback && POSTGRES_URL) {
    await writePostgres(key, fallback);
  }
  return fallback;
}

export async function writeRefereeMarket(state: PersistedRefereeMarket): Promise<void> {
  const payload = { ...state, updatedAt: Date.now() };
  if (POSTGRES_URL) {
    await writePostgres(engineKeyFor(), payload);
    return;
  }

  const serialized = JSON.stringify(payload);
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await upstash(['SET', engineKeyFor(), serialized]);
      return;
    } catch (err) {
      console.warn(`[FanVibe] Upstash write failed for ${engineKeyFor()}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const target = engineFileFor();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialized);
}

export async function readAppData(): Promise<PersistedAppData> {
  const key = appDataKeyFor();
  const pgState = await readPostgres<PersistedAppData>(key);
  if (pgState) return pgState;

  const fallback = await readFallbackJson<PersistedAppData>(key, appDataFileFor());
  if (fallback) {
    if (POSTGRES_URL) await writePostgres(key, fallback);
    return fallback;
  }

  return { version: 1, profiles: {}, referrals: [], pendingStakeReports: [], updatedAt: Date.now() };
}

export async function writeAppData(state: PersistedAppData): Promise<void> {
  const payload = { ...state, updatedAt: Date.now() };
  if (POSTGRES_URL) {
    await writePostgres(appDataKeyFor(), payload);
    return;
  }

  const serialized = JSON.stringify(payload);
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await upstash(['SET', appDataKeyFor(), serialized]);
      return;
    } catch (err) {
      console.warn(`[FanVibe] Upstash write failed for ${appDataKeyFor()}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const target = appDataFileFor();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialized);
}
