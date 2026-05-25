import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { RefereeEngine, encodeStake, encodeChampionStake, CHAMP_TEAMS } from './engine/referee.js';
import type { DaemonLog, SettlementResult, Outcome } from './types.js';

// ── App bootstrap ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const engine = new RefereeEngine();
const SEASON_STATE_KEY = 'fanvibe:season-state';
const kvRestUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const kvRestToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
let memorySeasonState: unknown = null;

// ── WebSocket broadcast ───────────────────────────────────────────────────────

function broadcast(type: string, data: unknown): void {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

engine.onLog = (log: DaemonLog) => broadcast('log', log);
engine.onUpdate = () => broadcast('state', engine.getState());

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', data: engine.getState(), ts: Date.now() }));
});

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    name: 'X Cup FanVibe API',
    status: 'ok',
    endpoints: {
      health: '/health',
      state: '/state',
      seasonState: '/season-state',
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/state', (_req, res) => {
  res.json(engine.getState());
});

const SeasonStateSchema = z.object({
  seasonNumber: z.number().int().min(1),
  phase: z.enum(['preseason', 'playing', 'champion', 'interseason']),
  phaseEndsAt: z.number().finite().positive(),
  fixtures: z.array(z.unknown()).min(1),
  matchStates: z.record(z.unknown()),
  eliminatedTeams: z.array(z.string()),
  champion: z.unknown().nullable(),
  tournamentGen: z.number().int().min(0),
  savedAt: z.number().int().positive().optional(),
});

type SeasonStatePayload = z.infer<typeof SeasonStateSchema>;

async function kvCommand<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  if (!kvRestUrl || !kvRestToken) throw new Error('KV not configured');
  const res = await fetch(`${kvRestUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${kvRestToken}`,
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`KV request failed: ${res.status}`);
  return await res.json() as T;
}

async function readSeasonState(): Promise<SeasonStatePayload | null> {
  if (!kvRestUrl || !kvRestToken) return memorySeasonState as SeasonStatePayload | null;
  const data = await kvCommand<{ result: string | null }>(`/get/${encodeURIComponent(SEASON_STATE_KEY)}`);
  if (!data.result) return null;
  return JSON.parse(data.result) as SeasonStatePayload;
}

async function writeSeasonState(state: SeasonStatePayload): Promise<void> {
  if (!kvRestUrl || !kvRestToken) {
    memorySeasonState = state;
    return;
  }
  await kvCommand(`/set/${encodeURIComponent(SEASON_STATE_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(state)),
  });
}

async function deleteSeasonState(): Promise<void> {
  if (!kvRestUrl || !kvRestToken) {
    memorySeasonState = null;
    return;
  }
  await kvCommand(`/del/${encodeURIComponent(SEASON_STATE_KEY)}`, { method: 'POST' });
}

app.get('/season-state', async (_req, res) => {
  try {
    const state = await readSeasonState();
    if (!state) return res.status(404).json({ state: null });
    res.json(state);
  } catch {
    res.status(404).json({ state: null });
  }
});

app.put('/season-state', async (req, res) => {
  const parsed = SeasonStateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const state = { ...parsed.data, savedAt: Date.now() };
  await writeSeasonState(state);
  broadcast('season-state', state);
  res.json({ ok: true, state });
});

app.delete('/season-state', async (_req, res) => {
  await deleteSeasonState();
  broadcast('season-state-reset', { ts: Date.now() });
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
  const schema = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid txHash' });
  await engine.reportStakeTx(parsed.data.txHash as `0x${string}`);
  res.json({ ok: true });
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
    await engine.start();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FanVibe] Engine start failed: ${msg}`);
    process.exit(1);
  }
});

process.on('SIGTERM', () => {
  console.log('[FanVibe] SIGTERM — shutting down');
  httpServer.close(() => process.exit(0));
});
