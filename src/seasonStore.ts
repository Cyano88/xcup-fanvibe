import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

const keyFor = (mode: SeasonStorageMode) => `fanvibe:season:${mode}`;
const fileFor = (mode: SeasonStorageMode) => join(STORE_DIR, `${keyFor(mode).replace(/:/g, '-')}.json`);
const engineKeyFor = () => 'fanvibe:referee:market';
const engineFileFor = () => join(STORE_DIR, 'fanvibe-referee-market.json');
const appDataKeyFor = () => 'fanvibe:app:data';
const appDataFileFor = () => join(STORE_DIR, 'fanvibe-app-data.json');

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
  status: 'captured' | 'qualified';
}

export interface PersistedAppData {
  version: 1;
  profiles: Record<string, PersistedFanProfile>;
  referrals: PersistedReferral[];
  pendingStakeReports: string[];
  updatedAt: number;
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

export async function readSeasonState(mode: SeasonStorageMode): Promise<PersistedSeasonState | null> {
  const raw = await upstash<string>(['GET', keyFor(mode)]);
  if (raw) return JSON.parse(raw) as PersistedSeasonState;

  try {
    const file = await readFile(fileFor(mode), 'utf8');
    return JSON.parse(file) as PersistedSeasonState;
  } catch {
    return null;
  }
}

export async function writeSeasonState(mode: SeasonStorageMode, state: PersistedSeasonState): Promise<void> {
  const payload = JSON.stringify({ ...state, mode, updatedAt: Date.now() });
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    await upstash(['SET', keyFor(mode), payload]);
    return;
  }

  const target = fileFor(mode);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, payload);
}

export async function clearSeasonState(mode: SeasonStorageMode): Promise<void> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    await upstash(['DEL', keyFor(mode)]);
    return;
  }

  try {
    await unlink(fileFor(mode));
  } catch {
    // No local snapshot to clear.
  }
}

export async function readRefereeMarket(): Promise<PersistedRefereeMarket | null> {
  const raw = await upstash<string>(['GET', engineKeyFor()]);
  if (raw) return JSON.parse(raw) as PersistedRefereeMarket;

  try {
    const file = await readFile(engineFileFor(), 'utf8');
    return JSON.parse(file) as PersistedRefereeMarket;
  } catch {
    return null;
  }
}

export async function writeRefereeMarket(state: PersistedRefereeMarket): Promise<void> {
  const payload = JSON.stringify({ ...state, updatedAt: Date.now() });
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    await upstash(['SET', engineKeyFor(), payload]);
    return;
  }

  const target = engineFileFor();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, payload);
}

export async function readAppData(): Promise<PersistedAppData> {
  const raw = await upstash<string>(['GET', appDataKeyFor()]);
  if (raw) return JSON.parse(raw) as PersistedAppData;

  try {
    const file = await readFile(appDataFileFor(), 'utf8');
    return JSON.parse(file) as PersistedAppData;
  } catch {
    return { version: 1, profiles: {}, referrals: [], pendingStakeReports: [], updatedAt: Date.now() };
  }
}

export async function writeAppData(state: PersistedAppData): Promise<void> {
  const payload = JSON.stringify({ ...state, updatedAt: Date.now() });
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    await upstash(['SET', appDataKeyFor(), payload]);
    return;
  }

  const target = appDataFileFor();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, payload);
}
