import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { RefereeEngine, encodeStake, encodeChampionStake, CHAMP_TEAMS } from './engine/referee.js';
import type { DaemonLog, SettlementResult, Outcome, MatchState } from './types.js';
import { clearSeasonState, readAppData, readSeasonState, writeAppData, writeSeasonState, type PersistedAppData, type PersistedSeasonState, type SeasonStorageMode } from './seasonStore.js';
import { SeasonController } from './engine/seasonController.js';
import { getWorldCupFeed } from './sportsData.js';
import { getWorldCupNews } from './newsData.js';

// ── App bootstrap ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '10mb' }));
const defaultCorsOrigins = [
  'https://fanvibe.xyz',
  'https://www.fanvibe.xyz',
  'https://dashboard-one-zeta-45.vercel.app',
  'http://localhost:5173',
];

const corsOrigins = [
  ...defaultCorsOrigins,
  ...(process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean),
];
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : { origin: true }));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const engine = new RefereeEngine();
let seasonController: SeasonController;
let appData: PersistedAppData = { version: 1, profiles: {}, referrals: [], pendingStakeReports: [], updatedAt: Date.now() };

// ── WebSocket broadcast ───────────────────────────────────────────────────────

function broadcast(type: string, data: unknown): void {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function compactSeasonState(state: PersistedSeasonState | null): PersistedSeasonState | null {
  if (!state) return null;
  const compactMatchStates = (matchStates: Record<string, MatchState> = {}) =>
    Object.fromEntries(Object.entries(matchStates).map(([fixtureId, matchState]) => [
      fixtureId,
      { ...matchState, events: [] },
    ]));
  return {
    ...state,
    matchStates: compactMatchStates(state.matchStates),
    previousKnockoutResults: state.previousKnockoutResults
      ? {
        ...state.previousKnockoutResults,
        matchStates: compactMatchStates(state.previousKnockoutResults.matchStates),
      }
      : null,
  };
}

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

function profileKey(address: string): string {
  return address.toLowerCase();
}

function profileNameFor(address: string): string | undefined {
  return appData.profiles[profileKey(address)]?.name;
}

function qualifyReferralForTx(txHash: string): void {
  const staker = engine.stakerForTx(txHash);
  if (!staker) return;
  const referral = appData.referrals.find(item => item.referred.toLowerCase() === staker.toLowerCase());
  if (!referral || referral.status === 'qualified') return;
  referral.status = 'qualified';
  referral.firstTxHash = txHash;
}

async function persistAppData(): Promise<void> {
  await writeAppData(appData);
}

async function retryPendingStakeReports(): Promise<void> {
  const pending = [...new Set(appData.pendingStakeReports)].filter(hash => /^0x[0-9a-fA-F]{64}$/.test(hash));
  if (pending.length === 0) return;

  const remaining: string[] = [];
  for (const hash of pending) {
    const indexed = await engine.reportStakeTx(hash as `0x${string}`);
    if (indexed || engine.hasStakeTx(hash)) {
      qualifyReferralForTx(hash);
    } else {
      remaining.push(hash);
    }
  }
  if (remaining.length !== appData.pendingStakeReports.length) {
    appData = { ...appData, pendingStakeReports: remaining.slice(-100), updatedAt: Date.now() };
    await persistAppData();
    broadcast('state', engine.getState());
  }
}

engine.onLog = (log: DaemonLog) => broadcast('log', log);
engine.onUpdate = () => broadcast('state', engine.getState());

seasonController = new SeasonController(engine, (prefix, level, message, txHash) => {
  broadcast('log', {
    id: Date.now(),
    ts: new Date().toISOString(),
    prefix,
    level,
    message,
    txHash,
  } satisfies DaemonLog);
});
seasonController.onUpdate = state => {
  engine.syncChampionSeason(state.seasonNumber);
  broadcast('season', compactSeasonState(state));
};

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', data: engine.getState(), ts: Date.now() }));
  ws.send(JSON.stringify({ type: 'season', data: compactSeasonState(seasonController.getState()), ts: Date.now() }));
});

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    name: 'X Cup FanVibe API',
    status: 'ok',
    endpoints: {
      health: '/health',
      state: '/state',
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/state', (_req, res) => {
  res.json(engine.getState());
});

app.get('/positions/:address', (req, res) => {
  const parsed = addressSchema.safeParse(req.params.address);
  if (!parsed.success) return res.status(400).json({ error: 'invalid address' });
  res.json({ address: parsed.data, positions: engine.getPositions(parsed.data) });
});

app.get('/leaderboard', (req, res) => {
  const parsed = z.coerce.number().int().min(1).max(50).default(20).safeParse(req.query.limit);
  if (!parsed.success) return res.status(400).json({ error: 'invalid limit' });
  const entries = engine.getLeaderboard(parsed.data).map(entry => ({
    ...entry,
    displayName: profileNameFor(entry.address),
  }));
  res.json({ entries });
});

app.get('/profiles/:address', (req, res) => {
  const parsed = addressSchema.safeParse(req.params.address);
  if (!parsed.success) return res.status(400).json({ error: 'invalid address' });
  const profile = appData.profiles[profileKey(parsed.data)];
  res.json({ address: parsed.data, name: profile?.name ?? '', updatedAt: profile?.updatedAt ?? null });
});

app.put('/profiles/:address', async (req, res) => {
  const address = addressSchema.safeParse(req.params.address);
  const body = z.object({ name: z.string().trim().max(24) }).safeParse(req.body);
  if (!address.success || !body.success) return res.status(400).json({ error: 'invalid profile' });
  const key = profileKey(address.data);
  const name = body.data.name.replace(/[^\w .-]/g, '').trim().slice(0, 24);
  if (name) {
    appData.profiles[key] = { address: address.data, name, updatedAt: Date.now() };
  } else {
    delete appData.profiles[key];
  }
  await persistAppData();
  res.json({ address: address.data, name: appData.profiles[key]?.name ?? '' });
});

app.post('/referrals/claim', async (req, res) => {
  const parsed = z.object({
    referrer: addressSchema,
    referred: addressSchema,
    txHash: txHashSchema.optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid referral' });
  const referrer = parsed.data.referrer.toLowerCase();
  const referred = parsed.data.referred.toLowerCase();
  if (referrer === referred) return res.status(400).json({ error: 'self referral blocked' });

  const existing = appData.referrals.find(item => item.referred.toLowerCase() === referred);
  if (existing) return res.json({ ok: true, referral: existing });

  const referral = {
    referrer: parsed.data.referrer,
    referred: parsed.data.referred,
    firstTxHash: parsed.data.txHash,
    createdAt: Date.now(),
    status: parsed.data.txHash ? 'qualified' as const : 'captured' as const,
  };
  appData.referrals.push(referral);
  await persistAppData();
  res.json({ ok: true, referral });
});

app.get('/referrals/:address', (req, res) => {
  const parsed = addressSchema.safeParse(req.params.address);
  if (!parsed.success) return res.status(400).json({ error: 'invalid address' });
  const key = parsed.data.toLowerCase();
  const invited = appData.referrals.filter(item => item.referrer.toLowerCase() === key);
  const joinedBy = appData.referrals.find(item => item.referred.toLowerCase() === key) ?? null;
  res.json({
    address: parsed.data,
    invited,
    joinedBy,
    count: invited.length,
    qualified: invited.filter(item => item.status === 'qualified').length,
  });
});

app.get('/worldcup/feed', async (req, res) => {
  const force = req.query.force === '1';
  const feed = await getWorldCupFeed(force);
  engine.syncFixtures(feed.fixtures);
  for (const matchState of Object.values(feed.matchStates)) {
    if (matchState.status !== 'finished') continue;
    const result = await engine.settleSyncedFixture(matchState.fixtureId, outcomeFromMatchState(matchState));
    if (result) broadcast('settlement', result);
  }
  res.json(feed);
});

app.get('/worldcup/news', async (req, res) => {
  const force = req.query.force === '1';
  const feed = await getWorldCupNews(force);
  res.json(feed);
});

const SeasonModeSchema = z.object({ mode: z.enum(['prod', 'test']).default('prod') });
const QUALIFIED_OR_TBD = new Set([...CHAMP_TEAMS, 'TBD']);

const TeamSnapshotSchema = z.object({
  name: z.string().min(1).max(80),
  code: z.string().min(2).max(4),
  flag: z.string().max(16).optional(),
  iso: z.string().min(2).max(8),
}).passthrough();

const FixtureSnapshotSchema = z.object({
  id: z.string().min(1).max(48).regex(/^[a-z0-9-]+$/i),
  matchday: z.number().int().min(1).max(16),
  group: z.string().min(1).max(4),
  round: z.string().max(4).optional(),
  home: TeamSnapshotSchema,
  away: TeamSnapshotSchema,
  kickoff: z.string().min(10).max(40),
  venue: z.string().min(1).max(160),
  status: z.enum(['upcoming', 'open', 'locked', 'settled']),
  result: z.enum(['home', 'draw', 'away']).optional(),
  baseOdds: z.object({
    home: z.number().min(0).max(100),
    draw: z.number().min(0).max(100),
    away: z.number().min(0).max(100),
  }),
  mode: z.enum(['realtime', 'simulated']),
}).passthrough();

const MatchStateSnapshotSchema = z.object({
  fixtureId: z.string().min(1).max(48),
  status: z.enum(['scheduled', 'live', 'half_time', 'finished']),
  minute: z.number().int().min(0).max(130),
  homeScore: z.number().int().min(0).max(30),
  awayScore: z.number().int().min(0).max(30),
  events: z.array(z.any()).max(240),
  simulatedKickoff: z.string().max(40),
  possession: z.number().min(0).max(100),
  finishedAt: z.number().optional(),
}).passthrough();

const SeasonSnapshotStateSchema = z.object({
  version: z.number().int().min(1).max(3),
  mode: z.enum(['prod', 'test']),
  seasonNumber: z.number().int().min(1).max(100000),
  phase: z.enum(['preseason', 'playing', 'champion', 'interseason']),
  phaseEndsAt: z.number().min(0),
  phaseTimer: z.number().min(0).max(86400),
  fixtures: z.array(FixtureSnapshotSchema).min(1).max(128),
  matchStates: z.record(MatchStateSnapshotSchema).default({}),
  eliminatedTeams: z.array(z.string().min(2).max(4)).max(48).default([]),
  champion: TeamSnapshotSchema.nullish(),
  tournamentGen: z.number().int().min(0).max(1000000),
  timings: z.object({
    preseasonSeconds: z.number().min(1).max(3600),
    matchMs: z.number().min(10_000).max(7_200_000),
    matchdayGapMs: z.number().min(0).max(7_200_000),
    interseasonSeconds: z.number().min(1).max(7200),
    waveGapMs: z.number().min(0).max(600_000),
  }),
  updatedAt: z.number().min(0),
}).passthrough();

function validateSeasonSnapshotState(state: unknown): PersistedSeasonState {
  const parsed = SeasonSnapshotStateSchema.parse(state);
  const fixtureIds = new Set(parsed.fixtures.map(fixture => fixture.id));
  for (const fixture of parsed.fixtures) {
    if (!QUALIFIED_OR_TBD.has(fixture.home.code) || !QUALIFIED_OR_TBD.has(fixture.away.code)) {
      throw new Error(`invalid team in fixture ${fixture.id}`);
    }
    const totalOdds = fixture.baseOdds.home + fixture.baseOdds.draw + fixture.baseOdds.away;
    if (totalOdds < 95 || totalOdds > 105) throw new Error(`invalid odds in fixture ${fixture.id}`);
  }
  for (const [fixtureId, matchState] of Object.entries(parsed.matchStates)) {
    if (!fixtureIds.has(fixtureId) || matchState.fixtureId !== fixtureId) {
      throw new Error(`invalid match state fixture ${fixtureId}`);
    }
  }
  return parsed as PersistedSeasonState;
}

function outcomeFromMatchState(matchState: MatchState): Outcome {
  if (matchState.penaltyWinner) return matchState.penaltyWinner;
  if (matchState.homeScore > matchState.awayScore) return 'home';
  if (matchState.awayScore > matchState.homeScore) return 'away';
  return 'draw';
}

async function syncSeasonSnapshotWithReferee(state: PersistedSeasonState): Promise<void> {
  if (!Array.isArray(state.fixtures)) return;

  engine.syncChampionSeason(state.seasonNumber);
  engine.syncFixtures(state.fixtures);

  const finished = Object.values(state.matchStates ?? {})
    .filter((matchState): matchState is MatchState => matchState?.status === 'finished');

  for (const matchState of finished) {
    const result = await engine.settleSyncedFixture(matchState.fixtureId, outcomeFromMatchState(matchState));
    if (result) broadcast('settlement', result);
  }
}

async function syncStoredSeasonSnapshotsWithReferee(): Promise<void> {
  const testSnapshot = await readSeasonState('test');
  if (testSnapshot) await syncSeasonSnapshotWithReferee(testSnapshot);
}

app.get('/season/snapshot', async (req, res) => {
  const parsed = SeasonModeSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const state = parsed.data.mode === 'prod'
    ? seasonController.getState()
    : await readSeasonState(parsed.data.mode as SeasonStorageMode);
  res.json({ state: compactSeasonState(state), durable: !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN });
});

app.get('/season/match/:fixtureId', async (req, res) => {
  const parsed = SeasonModeSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const state = parsed.data.mode === 'prod'
    ? seasonController.getState()
    : await readSeasonState(parsed.data.mode as SeasonStorageMode);
  if (!state) return res.status(404).json({ error: 'season state not found' });
  const fixture = state.fixtures.find(item => item.id === req.params.fixtureId);
  if (!fixture) return res.status(404).json({ error: 'fixture not found' });
  res.json({
    fixture,
    matchState: state.matchStates[fixture.id] ?? null,
    phase: state.phase,
    updatedAt: state.updatedAt,
  });
});

app.post('/season/snapshot', async (req, res) => {
  const schema = z.object({
    mode: z.enum(['prod', 'test']).default('prod'),
    state: z.any(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.mode === 'prod') return res.status(403).json({ error: 'production season is server-owned' });
  let state: PersistedSeasonState;
  try {
    state = validateSeasonSnapshotState(parsed.data.state);
  } catch (err: unknown) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'invalid season snapshot' });
  }
  if (state.mode !== parsed.data.mode) return res.status(400).json({ error: 'snapshot mode mismatch' });
  await writeSeasonState(parsed.data.mode as SeasonStorageMode, state);
  await syncSeasonSnapshotWithReferee(state);
  res.json({ ok: true });
});

app.post('/season/reset', async (req, res) => {
  const schema = z.object({
    mode: z.enum(['prod', 'test']).default('test'),
    secret: z.string().optional(),
    resetMarket: z.boolean().default(false),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const expected = process.env.ADMIN_TEST_SECRET;
  if (!expected || parsed.data.secret !== expected) return res.status(401).json({ error: 'unauthorized' });
  if (parsed.data.mode === 'prod') {
    const currentSeason = seasonController.getState().seasonNumber;
    const nextSeason = parsed.data.resetMarket ? 1 : currentSeason + 1;
    const state = await seasonController.resetToFreshSeason(nextSeason);
    if (parsed.data.resetMarket) {
      await engine.resetMarketState(state.fixtures);
    }
    broadcast('season', state);
    broadcast('state', engine.getState());
    broadcast('season-reset', { mode: 'prod' });
    return res.json({ ok: true, state, marketReset: parsed.data.resetMarket, seasonNumber: nextSeason });
  }
  await clearSeasonState(parsed.data.mode);
  broadcast('season-reset', { mode: parsed.data.mode });
  res.json({ ok: true });
});

app.get('/encode-stake', (req, res) => {
  const schema = z.object({
    fixtureId: z.string().min(1),
    outcome: z.enum(['home', 'draw', 'away']),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { fixtureId, outcome } = parsed.data;
  res.json({ calldata: encodeStake(fixtureId, outcome as Outcome) });
});

const OracleSchema = z.object({
  fixtureId: z.string().min(1),
  outcome: z.enum(['home', 'draw', 'away']),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  nonce: z.number().int().min(0),
});

app.post('/oracle/override', async (req, res) => {
  const parsed = OracleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { fixtureId, outcome, signature, nonce } = parsed.data;

  try {
    const result: SettlementResult = await engine.oracleOverride(
      fixtureId as string,
      outcome as Outcome,
      signature as string,
      nonce as number,
    );
    broadcast('settlement', result);
    res.json({ success: true, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: message });
  }
});

app.get('/encode-champion-stake', (req, res) => {
  const schema = z.object({ teamCode: z.string().min(2).max(4) });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!CHAMP_TEAMS.includes(parsed.data.teamCode)) {
    return res.status(400).json({ error: `Unknown team: ${parsed.data.teamCode}` });
  }
  res.json({ calldata: encodeChampionStake(parsed.data.teamCode) });
});

const ChampionOracleSchema = z.object({
  teamCode: z.string().min(2).max(4),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  nonce: z.number().int().min(0),
});

app.post('/oracle/champion', async (req, res) => {
  const parsed = ChampionOracleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { teamCode, signature, nonce } = parsed.data;
  try {
    await engine.oracleChampion(teamCode, signature, nonce);
    broadcast('state', engine.getState());
    res.json({ success: true, winner: teamCode });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/stake/report', async (req, res) => {
  const schema = z.object({
    txHash: txHashSchema,
    referred: addressSchema.optional(),
    referrer: addressSchema.optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid txHash' });
  const indexed = await engine.reportStakeTx(parsed.data.txHash as `0x${string}`);
  if (indexed) qualifyReferralForTx(parsed.data.txHash);
  if (!indexed && !appData.pendingStakeReports.some(hash => hash.toLowerCase() === parsed.data.txHash.toLowerCase())) {
    appData.pendingStakeReports.push(parsed.data.txHash);
    appData.pendingStakeReports = appData.pendingStakeReports.slice(-100);
  }

  if (parsed.data.referrer && parsed.data.referred && parsed.data.referrer.toLowerCase() !== parsed.data.referred.toLowerCase()) {
    const referred = parsed.data.referred.toLowerCase();
    const existing = appData.referrals.find(item => item.referred.toLowerCase() === referred);
    if (!existing) {
      appData.referrals.push({
        referrer: parsed.data.referrer,
        referred: parsed.data.referred,
        firstTxHash: parsed.data.txHash,
        createdAt: Date.now(),
        status: indexed ? 'qualified' : 'captured',
      });
    } else if (indexed && existing.status !== 'qualified') {
      existing.status = 'qualified';
      existing.firstTxHash = parsed.data.txHash;
    }
  }

  await persistAppData();
  res.json({ ok: true, indexed, queued: !indexed });
});

app.get('/stake/status/:fixtureId', async (req, res) => {
  const fixture = engine.getState().fixtures.find(f => f.id === req.params.fixtureId);
  const canStake = !!fixture
    && fixture.home.code !== 'TBD'
    && fixture.away.code !== 'TBD'
    && fixture.status !== 'locked'
    && fixture.status !== 'settled';
  const reason = !fixture
    ? 'Fixture is not available yet.'
    : fixture.status === 'locked'
      ? 'This match is already live. Staking is closed.'
      : fixture.status === 'settled'
        ? 'This match has already settled.'
        : fixture.home.code === 'TBD' || fixture.away.code === 'TBD'
          ? 'Fixture teams are not resolved yet.'
          : 'Staking is open.';
  res.json({ fixtureId: req.params.fixtureId, canStake, status: fixture?.status ?? 'missing', reason });
});

app.post('/metabolism/refresh', async (_req, res) => {
  await engine.refreshMetabolism();
  res.json(engine.getState().metabolism);
});

// ── Comments ──────────────────────────────────────────────────────────────────

interface Comment {
  id: number;
  fixtureId: string;
  name: string;
  text: string;
  ts: string;
}

const commentsStore = new Map<string, Comment[]>();

app.get('/comments/:fixtureId', (req, res) => {
  res.json(commentsStore.get(req.params.fixtureId) ?? []);
});

app.post('/comments/:fixtureId', (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(32).trim(),
    text: z.string().min(1).max(300).trim(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid' });

  const fixtureId = req.params.fixtureId;
  const comment: Comment = {
    id: Date.now(),
    fixtureId,
    name: parsed.data.name,
    text: parsed.data.text,
    ts: new Date().toISOString(),
  };

  const list = commentsStore.get(fixtureId) ?? [];
  list.push(comment);
  commentsStore.set(fixtureId, list.slice(-150));

  broadcast('comment', comment);
  res.json(comment);
});

// ── Server start ──────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);

httpServer.listen(PORT, async () => {
  console.log(`[FanVibe] HTTP server on port ${PORT}`);
  console.log(`[FanVibe] WebSocket on ws://localhost:${PORT}`);

  try {
    appData = await readAppData();
    await engine.start();
    await seasonController.start();
    engine.syncChampionSeason(seasonController.getState().seasonNumber);
    await retryPendingStakeReports();
    setInterval(() => {
      retryPendingStakeReports().catch(err => {
        console.error(`[FanVibe] Pending stake retry failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, 15_000);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FanVibe] Engine start failed: ${msg}`);
    process.exit(1);
  }
});

process.on('SIGTERM', () => {
  console.log('[FanVibe] SIGTERM — shutting down');
  seasonController.stop();
  httpServer.close(() => process.exit(0));
});
