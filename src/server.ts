import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { createPublicClient, createWalletClient, formatEther, http, parseAbiItem, parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { RefereeEngine, encodeStake, encodeChampionStake, CHAMP_TEAMS } from './engine/referee.js';
import type { DaemonLog, SettlementResult, Outcome, MatchState } from './types.js';
import { clearSeasonState, readAppData, readSeasonState, seasonStorageStatus, writeAppData, writeSeasonState, type PersistedAppData, type PersistedFvbTradeDaily, type PersistedFvbTradeWallet, type PersistedReferral, type PersistedSeasonState, type SeasonStorageMode } from './seasonStore.js';
import { SeasonController } from './engine/seasonController.js';
import { getWorldCupFeed, getWorldCupMatchDetail } from './sportsData.js';
import { getWorldCupNews } from './newsData.js';
import { explorerTx, xLayerMainnet } from './chain.js';

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

const REFERRAL_MIN_STAKE_WEI = parseEther('0.001');
const REFERRER_REWARD_WEI = parseEther('0.0005');
const REFERRED_REWARD_WEI = parseEther('0.0002');
const REFERRAL_DAILY_CAP = 10;
const UNRESOLVED_TEAM_CODES = new Set(['TBD', '1ST', '2ND', '3RD', 'WIN', 'LOS']);

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

function rewardEpochFor(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

type ReferralRewardStatus = 'pending' | 'claimable' | 'paid' | 'blocked';
type ReferralRewardSide = 'referrer' | 'referred';

const REFERRAL_REWARDS_ENABLED = process.env.REFERRAL_REWARDS_ENABLED !== '0';
const REFERRAL_CLAIMS_ENABLED = process.env.REFERRAL_CLAIMS_ENABLED !== '0';
const REWARD_MAX_CLAIM_WEI = parseEther(process.env.REWARD_MAX_CLAIM_OKB ?? '0.01');
const REWARD_DAILY_PAYOUT_CAP_WEI = parseEther(process.env.REWARD_DAILY_PAYOUT_CAP_OKB ?? '0.05');
const REWARD_RPC_URL = process.env.REWARD_RPC_URL
  ?? process.env.X_LAYER_HTTP_RPC
  ?? process.env.X_LAYER_RPC_URL
  ?? xLayerMainnet.rpcUrls.default.http[0];
const FANVIBE_TOKEN_ADDRESS = (process.env.FANVIBE_TOKEN_ADDRESS ?? '0x35a676Ca9347499f97819813a38ED14e6a7C5e3F') as Address;
const FANVIBE_TOKEN_API_URL = process.env.FANVIBE_TOKEN_API_URL
  ?? 'https://api-prod.eulr.fun/api/tokens/0x35a676ca9347499f97819813a38ed14e6a7c5e3f?network=xlayer';
const FVB_ENTRY_MIN_USD = Number(process.env.FVB_ENTRY_MIN_USD ?? '10');
const OKB_USD_FALLBACK = Number(process.env.OKB_USD_PRICE ?? '88');
const OKB_USD_CACHE_TTL_MS = Number(process.env.OKB_USD_CACHE_TTL_MS ?? '1800000');
const PRIVATE_X_LAYER_RPC_URL = process.env.FVB_RPC_URL
  ?? process.env.X_LAYER_HTTP_RPC
  ?? process.env.X_LAYER_RPC_URL
  ?? process.env.REWARD_RPC_URL;
const FVB_RPC_URLS = [
  PRIVATE_X_LAYER_RPC_URL,
  'https://xlayer.drpc.org',
  'https://rpc.xlayer.tech',
  'https://xlayerrpc.okx.com',
  xLayerMainnet.rpcUrls.default.http[0],
].filter((url, index, urls): url is string => Boolean(url) && urls.indexOf(url) === index);
const fvbPublicClients = FVB_RPC_URLS.map(url => createPublicClient({ chain: xLayerMainnet, transport: http(url) }));
const FVB_PRICE_QUOTE_AMOUNT_WEI = 10n ** 18n;
const FVB_PRICE_CACHE_TTL_MS = Number(process.env.FVB_PRICE_CACHE_TTL_MS ?? '30000');
const FVB_OKX_QUOTE_ENABLED = process.env.FVB_OKX_QUOTE_ENABLED !== '0';
const FVB_V4_MIGRATION_TX = (process.env.FVB_V4_MIGRATION_TX ?? '0x446fa4a18c6e84b8959db1b15892720348ed98c1f72983f487ee79b8c08e9e08') as `0x${string}`;
const FVB_TRADE_INDEX_ENABLED = process.env.FVB_TRADE_INDEX_ENABLED !== '0';
const FVB_TRADE_SCAN_INTERVAL_MS = Number(process.env.FVB_TRADE_SCAN_INTERVAL_MS ?? '60000');
const FVB_TRADE_SCAN_CHUNK_BLOCKS = BigInt(Math.max(25, Number(process.env.FVB_TRADE_SCAN_CHUNK_BLOCKS ?? '100')));
const FVB_TRADE_SCAN_LOOKBACK_BLOCKS = BigInt(Math.max(1000, Number(process.env.FVB_TRADE_SCAN_LOOKBACK_BLOCKS ?? '10000')));
const FVB_TRADE_MAX_CHUNKS_PER_SCAN = Math.max(1, Number(process.env.FVB_TRADE_MAX_CHUNKS_PER_SCAN ?? '20'));
const FVB_TRADE_BACKFILL_MAX_CHUNKS = Math.max(1, Number(process.env.FVB_TRADE_BACKFILL_MAX_CHUNKS ?? '1000'));
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN ?? process.env.FANVIBE_ADMIN_TOKEN ?? '';
const FVB_HOLDER_START_BLOCK = BigInt(Math.max(0, Number(process.env.FVB_HOLDER_START_BLOCK ?? '62489676')));
const FVB_HOLDER_SCAN_CHUNK_BLOCKS = BigInt(Math.max(25, Number(process.env.FVB_HOLDER_SCAN_CHUNK_BLOCKS ?? '1000')));
const FVB_HOLDER_MAX_CHUNKS_PER_SCAN = Math.max(1, Number(process.env.FVB_HOLDER_MAX_CHUNKS_PER_SCAN ?? '20'));
const FVB_V4_POOL_MANAGER_ADDRESS = (process.env.FVB_V4_POOL_MANAGER_ADDRESS ?? '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32').toLowerCase();
const FVB_TRADE_COUNTERPARTIES = new Set(
  [FVB_V4_POOL_MANAGER_ADDRESS, ...(process.env.FVB_TRADE_COUNTERPARTY_ADDRESSES ?? '').split(',')]
    .join(',')
    .split(',')
    .map(address => address.trim().toLowerCase())
    .filter(address => /^0x[0-9a-f]{40}$/.test(address)),
);
let cachedFvbPrice: { priceOkbWei: string; source: 'eulr' | 'okx' | 'env'; updatedAt: number } | null = null;
let cachedOkbUsd: { price: number; updatedAt: number; source: 'coingecko' | 'env' } | null = null;
let fvbTradeScanRunning = false;
let fvbTradeBackfillRunning = false;
let fvbHolderScanRunning = false;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const FVB_TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
type FvbTransferLog = {
  transactionHash?: string | null;
  logIndex?: number | null;
  blockNumber?: bigint | null;
  args: {
    from?: string;
    to?: string;
    value?: bigint;
  };
};
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

async function readFvbBalance(address: string): Promise<bigint | null> {
  for (const client of fvbPublicClients) {
    try {
      return await client.readContract({
        address: FANVIBE_TOKEN_ADDRESS,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address as Address],
      });
    } catch {
      // Try the next public RPC; X Layer providers occasionally disagree on contract reads.
    }
  }
  return null;
}

function parsePositiveWei(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value) > 0n ? value : null;
  } catch {
    return null;
  }
}

async function fetchFvbPriceFromEulr(): Promise<string | null> {
  const response = await fetch(FANVIBE_TOKEN_API_URL, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`eulr HTTP ${response.status}`);
  const data = await response.json() as {
    token?: { isGraduated?: boolean; isMigrated?: boolean };
    satoData?: { marketPriceOkb?: string };
  };
  if (!data.token?.isGraduated || !data.token?.isMigrated) return null;
  return parsePositiveWei(data.satoData?.marketPriceOkb);
}

async function fetchFvbPriceFromOkxQuote(): Promise<string | null> {
  if (!FVB_OKX_QUOTE_ENABLED) return null;
  const apiKey = process.env.OKX_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    chainId: String(xLayerMainnet.id),
    fromTokenAddress: FANVIBE_TOKEN_ADDRESS,
    toTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    amount: FVB_PRICE_QUOTE_AMOUNT_WEI.toString(),
  });

  const headers: Record<string, string> = { 'Ok-Access-Key': apiKey };
  if (process.env.OKX_PROJECT_ID) headers['Ok-Access-Project'] = process.env.OKX_PROJECT_ID;

  const response = await fetch(`https://web3.okx.com/api/v5/dex/aggregator/quote?${params}`, {
    headers,
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error(`OKX quote HTTP ${response.status}`);

  const data = await response.json() as {
    code?: string;
    msg?: string;
    data?: Array<{ routerResult?: { toTokenAmount?: string }; toTokenAmount?: string }>;
  };
  if (data.code && data.code !== '0') throw new Error(`OKX quote ${data.code}: ${data.msg ?? 'unknown'}`);
  const quote = data.data?.[0];
  return parsePositiveWei(quote?.routerResult?.toTokenAmount ?? quote?.toTokenAmount);
}

async function getFvbMarketPrice(): Promise<{ priceOkbWei: string | null; source: string; updatedAt: number | null; cached: boolean }> {
  if (cachedFvbPrice && Date.now() - cachedFvbPrice.updatedAt < FVB_PRICE_CACHE_TTL_MS) {
    return { ...cachedFvbPrice, cached: true };
  }

  try {
    const priceOkbWei = await fetchFvbPriceFromEulr();
    if (priceOkbWei) {
      cachedFvbPrice = { priceOkbWei, source: 'eulr', updatedAt: Date.now() };
      return { ...cachedFvbPrice, cached: false };
    }
  } catch (err) {
    console.warn(`[FanVibe] FVB eulr price failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const priceOkbWei = await fetchFvbPriceFromOkxQuote();
    if (priceOkbWei) {
      cachedFvbPrice = { priceOkbWei, source: 'okx', updatedAt: Date.now() };
      return { ...cachedFvbPrice, cached: false };
    }
  } catch (err) {
    console.warn(`[FanVibe] FVB OKX quote failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const envFallback = parsePositiveWei(process.env.FVB_MARKET_PRICE_OKB_WEI);
  if (envFallback) {
    cachedFvbPrice ??= { priceOkbWei: envFallback, source: 'env', updatedAt: Date.now() };
    return { ...cachedFvbPrice, cached: true };
  }

  return cachedFvbPrice
    ? { ...cachedFvbPrice, cached: true }
    : { priceOkbWei: null, source: 'unavailable', updatedAt: null, cached: false };
}

async function getOkbUsdPrice(): Promise<{ price: number; source: string; updatedAt: number | null; cached: boolean }> {
  if (cachedOkbUsd && Date.now() - cachedOkbUsd.updatedAt < OKB_USD_CACHE_TTL_MS) {
    return { ...cachedOkbUsd, cached: true };
  }

  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=okb&vs_currencies=usd', {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json() as { okb?: { usd?: number } };
      const price = data.okb?.usd;
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
        cachedOkbUsd = { price, source: 'coingecko', updatedAt: Date.now() };
        return { ...cachedOkbUsd, cached: false };
      }
    }
  } catch (err) {
    console.warn(`[FanVibe] OKB/USD price failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const fallback = Number.isFinite(OKB_USD_FALLBACK) && OKB_USD_FALLBACK > 0 ? OKB_USD_FALLBACK : 88;
  cachedOkbUsd ??= { price: fallback, source: 'env', updatedAt: Date.now() };
  return { ...cachedOkbUsd, cached: true };
}

async function fvbEntryMinOkbWei(): Promise<bigint> {
  const okbUsd = await getOkbUsdPrice();
  return parseEther((FVB_ENTRY_MIN_USD / okbUsd.price).toFixed(8));
}

const FVB_TRADE_VOLUME_POINT_WEI = parseEther(process.env.FVB_TRADE_VOLUME_POINT_OKB ?? '0.00001');

function fvbTradeSourceScope(): 'counterparty_scoped' | 'all_transfers' {
  return FVB_TRADE_COUNTERPARTIES.size > 0 ? 'counterparty_scoped' : 'all_transfers';
}

function ensureFvbTradeIndex() {
  appData.fvbTradeIndex ??= {
    tokenAddress: FANVIBE_TOKEN_ADDRESS,
    lastScannedBlock: 0,
    updatedAt: Date.now(),
    source: 'transfer_logs',
    scopedCounterparties: Array.from(FVB_TRADE_COUNTERPARTIES),
    holderCandidates: {},
    wallets: {},
    daily: {},
    processedLogs: {},
    backfill: { status: 'idle' },
  };
  appData.fvbTradeIndex.tokenAddress = FANVIBE_TOKEN_ADDRESS;
  appData.fvbTradeIndex.source = 'transfer_logs';
  appData.fvbTradeIndex.scopedCounterparties = Array.from(FVB_TRADE_COUNTERPARTIES);
  appData.fvbTradeIndex.holderCandidates ??= {};
  appData.fvbTradeIndex.daily ??= {};
  appData.fvbTradeIndex.processedLogs ??= {};
  appData.fvbTradeIndex.backfill ??= { status: 'idle' };
  return appData.fvbTradeIndex;
}

function fvbTradeDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function fvbTradeDailyBucket(timestampMs: number): PersistedFvbTradeDaily {
  const index = ensureFvbTradeIndex();
  const date = fvbTradeDay(timestampMs);
  index.daily ??= {};
  index.daily[date] ??= {
    date,
    fvbVolumeWei: '0',
    estimatedOkbVolumeWei: '0',
    transfers: 0,
    updatedAt: Date.now(),
  };
  return index.daily[date];
}

function fvbTradeVolumeForRange(startTimestamp: number, endTimestamp: number): {
  dailyFvbTradeVolumeWei: string;
  dailyFvbTradeVolumeOkbWei: string;
  dailyFvbTradeCount: number;
  fvbTradeSource: 'verified_onchain_fvb_transfer_logs';
  fvbTradeScope: 'counterparty_scoped' | 'all_transfers';
} {
  const startMs = startTimestamp * 1000;
  const endMs = endTimestamp * 1000;
  let fvbVolumeWei = 0n;
  let estimatedOkbVolumeWei = 0n;
  let transfers = 0;

  for (const bucket of Object.values(appData.fvbTradeIndex?.daily ?? {})) {
    const bucketStart = Date.parse(`${bucket.date}T00:00:00.000Z`);
    const bucketEnd = bucketStart + 24 * 60 * 60 * 1000;
    if (bucketEnd <= startMs || bucketStart >= endMs) continue;
    fvbVolumeWei += BigInt(bucket.fvbVolumeWei);
    estimatedOkbVolumeWei += BigInt(bucket.estimatedOkbVolumeWei);
    transfers += bucket.transfers;
  }

  return {
    dailyFvbTradeVolumeWei: fvbVolumeWei.toString(),
    dailyFvbTradeVolumeOkbWei: estimatedOkbVolumeWei.toString(),
    dailyFvbTradeCount: transfers,
    fvbTradeSource: 'verified_onchain_fvb_transfer_logs',
    fvbTradeScope: fvbTradeSourceScope(),
  };
}

function trackFvbHolderCandidate(address: string): void {
  const key = address.toLowerCase();
  if (key === ZERO_ADDRESS || !/^0x[0-9a-f]{40}$/.test(key)) return;
  if (FVB_TRADE_COUNTERPARTIES.has(key)) return;
  const index = ensureFvbTradeIndex();
  index.holderCandidates ??= {};
  index.holderCandidates[key] = key;
}

function fvbTradeWallet(address: string): PersistedFvbTradeWallet {
  const index = ensureFvbTradeIndex();
  const key = address.toLowerCase();
  trackFvbHolderCandidate(key);
  index.wallets[key] ??= {
    address,
    fvbVolumeWei: '0',
    estimatedOkbVolumeWei: '0',
    transfers: 0,
    lastTradeAt: 0,
  };
  return index.wallets[key];
}

function creditFvbTradeVolume(address: string, fvbAmountWei: bigint, estimatedOkbWei: bigint, timestamp = Date.now()): void {
  if (address.toLowerCase() === ZERO_ADDRESS) return;
  const wallet = fvbTradeWallet(address);
  wallet.fvbVolumeWei = (BigInt(wallet.fvbVolumeWei) + fvbAmountWei).toString();
  wallet.estimatedOkbVolumeWei = (BigInt(wallet.estimatedOkbVolumeWei) + estimatedOkbWei).toString();
  wallet.transfers += 1;
  wallet.lastTradeAt = Math.max(wallet.lastTradeAt, timestamp);

  const daily = fvbTradeDailyBucket(timestamp);
  daily.fvbVolumeWei = (BigInt(daily.fvbVolumeWei) + fvbAmountWei).toString();
  daily.estimatedOkbVolumeWei = (BigInt(daily.estimatedOkbVolumeWei) + estimatedOkbWei).toString();
  daily.transfers += 1;
  daily.updatedAt = Date.now();
}

function fvbTradeLogKey(log: { transactionHash?: string | null; logIndex?: number | null }): string | null {
  if (!log.transactionHash || log.logIndex === null || log.logIndex === undefined) return null;
  return `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
}

function markFvbTradeLogProcessed(key: string, timestamp: number): boolean {
  const index = ensureFvbTradeIndex();
  index.processedLogs ??= {};
  if (index.processedLogs[key]) return false;
  index.processedLogs[key] = String(timestamp);
  return true;
}

async function processFvbTradeLogs(
  client: typeof fvbPublicClients[number],
  logs: readonly FvbTransferLog[],
  priceWei: bigint,
): Promise<number> {
  const blockTimestampCache = new Map<bigint, number>();
  const logTimestamp = async (blockNumber: bigint | null | undefined): Promise<number> => {
    if (!blockNumber) return Date.now();
    const cached = blockTimestampCache.get(blockNumber);
    if (cached) return cached;
    const block = await client.getBlock({ blockNumber });
    const timestamp = Number(block.timestamp) * 1000;
    blockTimestampCache.set(blockNumber, timestamp);
    return timestamp;
  };

  let indexed = 0;
  for (const log of logs) {
    const key = fvbTradeLogKey(log);
    if (!key) continue;

    const from = String(log.args.from ?? '').toLowerCase();
    const to = String(log.args.to ?? '').toLowerCase();
    const value = BigInt(log.args.value ?? 0n);
    if (value <= 0n || from === ZERO_ADDRESS || to === ZERO_ADDRESS) continue;
    trackFvbHolderCandidate(from);
    trackFvbHolderCandidate(to);

    const fromIsCounterparty = FVB_TRADE_COUNTERPARTIES.has(from);
    const toIsCounterparty = FVB_TRADE_COUNTERPARTIES.has(to);
    if (FVB_TRADE_COUNTERPARTIES.size > 0 && !fromIsCounterparty && !toIsCounterparty) continue;

    const timestamp = await logTimestamp(log.blockNumber);
    if (!markFvbTradeLogProcessed(key, timestamp)) continue;

    const estimatedOkbWei = priceWei > 0n ? (value * priceWei) / 10n ** 18n : 0n;
    if (FVB_TRADE_COUNTERPARTIES.size > 0) {
      if (!fromIsCounterparty) creditFvbTradeVolume(from, value, estimatedOkbWei, timestamp);
      if (!toIsCounterparty) creditFvbTradeVolume(to, value, estimatedOkbWei, timestamp);
    } else {
      creditFvbTradeVolume(from, value, estimatedOkbWei, timestamp);
      creditFvbTradeVolume(to, value, estimatedOkbWei, timestamp);
    }
    indexed += 1;
  }
  return indexed;
}

async function fvbTradeStartBlock(client = fvbPublicClients[0]): Promise<bigint> {
  const envBlock = process.env.FVB_TRADE_START_BLOCK;
  if (envBlock && /^\d+$/.test(envBlock)) return BigInt(envBlock);

  try {
    const receipt = await client.getTransactionReceipt({ hash: FVB_V4_MIGRATION_TX });
    return receipt.blockNumber;
  } catch {
    const latest = await client.getBlockNumber();
    return latest > FVB_TRADE_SCAN_LOOKBACK_BLOCKS ? latest - FVB_TRADE_SCAN_LOOKBACK_BLOCKS : 0n;
  }
}

async function rebuildFvbTradeIndex(): Promise<void> {
  if (!FVB_TRADE_INDEX_ENABLED || fvbTradeBackfillRunning) return;
  const client = fvbPublicClients[0];
  if (!client) throw new Error('FVB RPC unavailable');
  fvbTradeBackfillRunning = true;
  const index = ensureFvbTradeIndex();
  const startedAt = Date.now();
  try {
    const fromStart = await fvbTradeStartBlock(client);
    const latest = await client.getBlockNumber();
    index.wallets = {};
    index.daily = {};
    index.holderCandidates = {};
    index.processedLogs = {};
    index.lastScannedBlock = 0;
    index.backfill = {
      status: 'running',
      startedAt,
      fromBlock: Number(fromStart),
      toBlock: Number(latest),
      lastScannedBlock: Number(fromStart),
      logsIndexed: 0,
    };
    await persistAppData();

    const price = await getFvbMarketPrice();
    const priceWei = price.priceOkbWei ? BigInt(price.priceOkbWei) : 0n;
    let fromBlock = fromStart;
    let scannedTo = fromStart;
    let chunks = 0;
    let logsIndexed = 0;

    while (fromBlock <= latest && chunks < FVB_TRADE_BACKFILL_MAX_CHUNKS) {
      const toBlock = fromBlock + FVB_TRADE_SCAN_CHUNK_BLOCKS > latest
        ? latest
        : fromBlock + FVB_TRADE_SCAN_CHUNK_BLOCKS;
      const logs = await client.getLogs({
        address: FANVIBE_TOKEN_ADDRESS,
        event: FVB_TRANSFER_EVENT,
        fromBlock,
        toBlock,
      });

      logsIndexed += await processFvbTradeLogs(client, logs, priceWei);
      scannedTo = toBlock;
      fromBlock = toBlock + 1n;
      chunks += 1;

      index.lastScannedBlock = Number(scannedTo);
      index.updatedAt = Date.now();
      index.backfill = {
        ...index.backfill,
        status: 'running',
        lastScannedBlock: Number(scannedTo),
        logsIndexed,
      };
      if (chunks % 25 === 0) await persistAppData();
    }

    index.lastScannedBlock = Number(scannedTo);
    index.updatedAt = Date.now();
    index.backfill = {
      ...index.backfill,
      status: scannedTo >= latest ? 'complete' : 'failed',
      completedAt: Date.now(),
      lastScannedBlock: Number(scannedTo),
      logsIndexed,
      error: scannedTo >= latest ? undefined : `Backfill chunk limit reached at block ${scannedTo.toString()}`,
    };
    await persistAppData();
  } catch (err) {
    index.backfill = {
      ...index.backfill,
      status: 'failed',
      completedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
    await persistAppData();
    throw err;
  } finally {
    fvbTradeBackfillRunning = false;
  }
}

async function scanFvbTradeVolume(): Promise<void> {
  if (!FVB_TRADE_INDEX_ENABLED || fvbTradeScanRunning || fvbTradeBackfillRunning) return;
  const client = fvbPublicClients[0];
  if (!client) return;
  fvbTradeScanRunning = true;
  try {
    const index = ensureFvbTradeIndex();
    const latest = await client.getBlockNumber();
    const initialStart = await fvbTradeStartBlock(client);
    let fromBlock = index.lastScannedBlock > 0 ? BigInt(index.lastScannedBlock) + 1n : initialStart;
    if (fromBlock > latest) return;

    const price = await getFvbMarketPrice();
    const priceWei = price.priceOkbWei ? BigInt(price.priceOkbWei) : 0n;
    let scannedTo = BigInt(index.lastScannedBlock);

    let chunks = 0;
    while (fromBlock <= latest && chunks < FVB_TRADE_MAX_CHUNKS_PER_SCAN) {
      const toBlock = fromBlock + FVB_TRADE_SCAN_CHUNK_BLOCKS > latest
        ? latest
        : fromBlock + FVB_TRADE_SCAN_CHUNK_BLOCKS;
      const logs = await client.getLogs({
        address: FANVIBE_TOKEN_ADDRESS,
        event: FVB_TRANSFER_EVENT,
        fromBlock,
        toBlock,
      });

      await processFvbTradeLogs(client, logs, priceWei);

      scannedTo = toBlock;
      fromBlock = toBlock + 1n;
      chunks += 1;
    }

    index.lastScannedBlock = Number(scannedTo);
    index.updatedAt = Date.now();
    await persistAppData();
  } catch (err) {
    console.warn(`[FanVibe] FVB trade index scan failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    fvbTradeScanRunning = false;
  }
}

async function scanFvbHolderCandidates(): Promise<void> {
  if (!FVB_TRADE_INDEX_ENABLED || fvbHolderScanRunning) return;
  const client = fvbPublicClients[0];
  if (!client) return;
  fvbHolderScanRunning = true;
  try {
    const index = ensureFvbTradeIndex();
    const latest = await client.getBlockNumber();
    let fromBlock = index.holderLastScannedBlock && index.holderLastScannedBlock > 0
      ? BigInt(index.holderLastScannedBlock) + 1n
      : FVB_HOLDER_START_BLOCK;
    if (fromBlock > latest) return;

    let scannedTo = BigInt(index.holderLastScannedBlock ?? 0);
    let chunks = 0;
    while (fromBlock <= latest && chunks < FVB_HOLDER_MAX_CHUNKS_PER_SCAN) {
      const toBlock = fromBlock + FVB_HOLDER_SCAN_CHUNK_BLOCKS > latest
        ? latest
        : fromBlock + FVB_HOLDER_SCAN_CHUNK_BLOCKS;
      const logs = await client.getLogs({
        address: FANVIBE_TOKEN_ADDRESS,
        event: FVB_TRANSFER_EVENT,
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        trackFvbHolderCandidate(String(log.args.from ?? ''));
        trackFvbHolderCandidate(String(log.args.to ?? ''));
      }

      scannedTo = toBlock;
      fromBlock = toBlock + 1n;
      chunks += 1;
    }

    index.holderLastScannedBlock = Number(scannedTo);
    index.updatedAt = Date.now();
    await persistAppData();
  } catch (err) {
    console.warn(`[FanVibe] FVB holder candidate scan failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    fvbHolderScanRunning = false;
  }
}

function fvbTradeStats(address: string) {
  const wallet = appData.fvbTradeIndex?.wallets[address.toLowerCase()];
  return {
    fvbTradeVolumeWei: wallet?.fvbVolumeWei ?? '0',
    fvbTradeVolumeOkbWei: wallet?.estimatedOkbVolumeWei ?? '0',
    fvbTradeTransfers: wallet?.transfers ?? 0,
    fvbLastTradeAt: wallet?.lastTradeAt ?? 0,
  };
}

function scoreRulesWithTrading() {
  return {
    ...engine.getMatchdayCupScoreRules(),
    fvbTradeVolumePointWei: FVB_TRADE_VOLUME_POINT_WEI.toString(),
    fvbTradeVolumePointOKB: formatEther(FVB_TRADE_VOLUME_POINT_WEI),
    fvbTradeSource: 'verified_onchain_fvb_transfer_logs',
    fvbTradeScope: fvbTradeSourceScope(),
  };
}

function attachFvbTrading<T extends { address: string; score?: number; scoreComponents?: Record<string, number>; lastActiveAt?: number }>(entries: T[]) {
  return entries
    .map(entry => {
      const stats = fvbTradeStats(entry.address);
      const tradeOkbWei = BigInt(stats.fvbTradeVolumeOkbWei);
      const tradingPoints = Number(tradeOkbWei / FVB_TRADE_VOLUME_POINT_WEI);
      return {
        ...entry,
        ...stats,
        score: (entry.score ?? 0) + tradingPoints,
        scoreComponents: {
          ...(entry.scoreComponents ?? {}),
          trading: tradingPoints,
        },
        lastActiveAt: Math.max(entry.lastActiveAt ?? 0, stats.fvbLastTradeAt),
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

async function attachFvbEligibility<T extends { address: string }>(entries: T[]) {
  const price = await getFvbMarketPrice();
  const minValueWei = await fvbEntryMinOkbWei();
  const priceWei = price.priceOkbWei ? BigInt(price.priceOkbWei) : null;
  const meetsEntryMinimum = (balance: bigint) => {
    if (balance <= 0n) return false;
    if (!priceWei) return true;
    return (balance * priceWei) / 10n ** 18n >= minValueWei;
  };

  if (!entries.length) return entries.map(entry => ({
    ...entry,
    fvbBalanceWei: '0',
    fvbEligibleWei: '0',
    fvbEligibilityCapWei: null,
    fvbEntryMinimumUsd: FVB_ENTRY_MIN_USD,
    fvbEligible: false,
  }));

  try {
    const balanceValues = await Promise.all(entries.map(entry => readFvbBalance(entry.address)));

    return entries.map((entry, index) => {
      const balance = balanceValues[index];
      return {
        ...entry,
        fvbBalanceWei: balance?.toString() ?? null,
        fvbEligibleWei: balance?.toString() ?? null,
        fvbEligibilityCapWei: null,
        fvbEntryMinimumUsd: FVB_ENTRY_MIN_USD,
        fvbEligible: balance === null ? null : meetsEntryMinimum(balance),
      };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[FanVibe] FVB eligibility lookup failed: ${msg}`);
    return entries.map(entry => ({
      ...entry,
      fvbBalanceWei: null,
      fvbEligibleWei: null,
      fvbEligibilityCapWei: null,
      fvbEntryMinimumUsd: FVB_ENTRY_MIN_USD,
      fvbEligible: null,
    }));
  }
}

async function matchdayEntriesWithEligibility(limit: number) {
  const entries = attachFvbTrading(engine.getMatchdayCupLeaderboard(limit).map(entry => ({
    ...entry,
    displayName: profileNameFor(entry.address),
  })));
  return attachFvbEligibility(entries);
}

async function fvbHolderLeaderboard(limit: number) {
  const index = ensureFvbTradeIndex();
  const candidateAddresses = new Set<string>();

  for (const address of Object.keys(index.wallets)) {
    if (address !== ZERO_ADDRESS && !FVB_TRADE_COUNTERPARTIES.has(address)) candidateAddresses.add(address);
  }
  for (const address of Object.keys(index.holderCandidates ?? {})) {
    if (address !== ZERO_ADDRESS && !FVB_TRADE_COUNTERPARTIES.has(address)) candidateAddresses.add(address);
  }
  for (const entry of engine.getMatchdayCupLeaderboard(10_000)) {
    candidateAddresses.add(entry.address.toLowerCase());
  }

  const price = await getFvbMarketPrice();
  const priceWei = price.priceOkbWei ? BigInt(price.priceOkbWei) : null;
  const minimumValueWei = await fvbEntryMinOkbWei();
  const rows = await Promise.all(Array.from(candidateAddresses).map(async address => {
    const balance = await readFvbBalance(address);
    if (balance === null || balance <= 0n) return null;
    const valueOkbWei = priceWei ? (balance * priceWei) / 10n ** 18n : null;
    const eligible = valueOkbWei === null ? balance > 0n : valueOkbWei >= minimumValueWei;
    if (!eligible) return null;
    const stats = fvbTradeStats(address);
    return {
      rank: 0,
      address,
      displayName: profileNameFor(address),
      fvbBalanceWei: balance.toString(),
      fvbValueOkbWei: valueOkbWei?.toString() ?? null,
      fvbTradeVolumeWei: stats.fvbTradeVolumeWei,
      fvbTradeVolumeOkbWei: stats.fvbTradeVolumeOkbWei,
      fvbTradeTransfers: stats.fvbTradeTransfers,
      fvbLastTradeAt: stats.fvbLastTradeAt,
      fvbEntryMinimumUsd: FVB_ENTRY_MIN_USD,
    };
  }));

  return rows
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => {
      const balanceDiff = BigInt(b.fvbBalanceWei) - BigInt(a.fvbBalanceWei);
      if (balanceDiff !== 0n) return balanceDiff > 0n ? 1 : -1;
      const tradeDiff = BigInt(b.fvbTradeVolumeOkbWei) - BigInt(a.fvbTradeVolumeOkbWei);
      if (tradeDiff !== 0n) return tradeDiff > 0n ? 1 : -1;
      return b.fvbLastTradeAt - a.fvbLastTradeAt;
    })
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function qualifiedMatchdayEntries<T extends { rank: number | null; fvbEligible?: boolean | null }>(entries: T[]): T[] {
  return entries
    .filter(entry => entry.fvbEligible === true)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function rewardStatusFor(referral: PersistedReferral, side: ReferralRewardSide): ReferralRewardStatus | undefined {
  return side === 'referrer'
    ? referral.referrerRewardStatus ?? referral.rewardStatus
    : referral.referredRewardStatus ?? referral.rewardStatus;
}

function setRewardStatus(referral: PersistedReferral, side: ReferralRewardSide, status: ReferralRewardStatus): void {
  if (side === 'referrer') referral.referrerRewardStatus = status;
  else referral.referredRewardStatus = status;

  const referrerStatus = referral.referrerRewardStatus ?? referral.rewardStatus;
  const referredStatus = referral.referredRewardStatus ?? referral.rewardStatus;
  if (referrerStatus === referredStatus) referral.rewardStatus = referrerStatus;
  else if (referrerStatus === 'paid' && referredStatus === 'paid') referral.rewardStatus = 'paid';
  else if (referrerStatus === 'claimable' || referredStatus === 'claimable') referral.rewardStatus = 'claimable';
  else if (referrerStatus === 'pending' || referredStatus === 'pending') referral.rewardStatus = 'pending';
  else referral.rewardStatus = referrerStatus ?? referredStatus;
}

function normalizeReferralRewardSides(referral: PersistedReferral): boolean {
  if (referral.status !== 'qualified') return false;
  let changed = false;
  if (!referral.referrerRewardStatus && referral.rewardStatus) {
    referral.referrerRewardStatus = referral.rewardStatus;
    changed = true;
  }
  if (!referral.referredRewardStatus && referral.rewardStatus) {
    referral.referredRewardStatus = referral.rewardStatus === 'blocked' ? 'blocked' : referral.rewardStatus;
    changed = true;
  }
  return changed;
}

function matureReferralRewards(): boolean {
  const currentEpoch = rewardEpochFor();
  let changed = false;
  for (const referral of appData.referrals) {
    changed = normalizeReferralRewardSides(referral) || changed;
    if (referral.status !== 'qualified' || !referral.rewardEpoch || referral.rewardEpoch >= currentEpoch) continue;
    if (rewardStatusFor(referral, 'referrer') === 'pending') {
      setRewardStatus(referral, 'referrer', 'claimable');
      changed = true;
    }
    if (rewardStatusFor(referral, 'referred') === 'pending') {
      setRewardStatus(referral, 'referred', 'claimable');
      changed = true;
    }
  }
  return changed;
}

function referrerRewardedCount(referrer: string, epoch: string): number {
  const key = referrer.toLowerCase();
  return appData.referrals.filter(item =>
    item.referrer.toLowerCase() === key
    && item.rewardEpoch === epoch
    && ['pending', 'claimable', 'paid'].includes(rewardStatusFor(item, 'referrer') ?? '')
  ).length;
}

function qualifyReferralForTx(txHash: string): boolean {
  if (!REFERRAL_REWARDS_ENABLED) return false;
  const stake = engine.validStakeForTx(txHash);
  if (!stake) return false;
  const referral = appData.referrals.find(item => item.referred.toLowerCase() === stake.staker.toLowerCase());
  if (!referral || referral.status === 'qualified') return false;
  const amountWei = BigInt(stake.amountWei);
  if (amountWei < REFERRAL_MIN_STAKE_WEI) return false;
  const qualifiedAt = Date.now();
  const rewardEpoch = rewardEpochFor(qualifiedAt);
  referral.status = 'qualified';
  referral.firstTxHash = txHash;
  referral.qualifiedAt = qualifiedAt;
  referral.qualifyingAmountWei = stake.amountWei;
  referral.rewardEpoch = rewardEpoch;
  referral.referrerRewardWei = REFERRER_REWARD_WEI.toString();
  referral.referredRewardWei = REFERRED_REWARD_WEI.toString();
  if (referrerRewardedCount(referral.referrer, rewardEpoch) >= REFERRAL_DAILY_CAP) {
    setRewardStatus(referral, 'referrer', 'blocked');
    setRewardStatus(referral, 'referred', 'pending');
    referral.blockReason = 'daily_cap';
    console.log(`[FanVibe] Referral cap blocked for ${referral.referrer} on ${rewardEpoch}`);
  } else {
    setRewardStatus(referral, 'referrer', 'pending');
    setRewardStatus(referral, 'referred', 'pending');
    delete referral.blockReason;
  }
  console.log(`[FanVibe] Referral qualified: ${referral.referred} via ${referral.referrer} (${formatEther(amountWei)} OKB)`);
  return true;
}

function referralRewardSummary(address: string) {
  const key = address.toLowerCase();
  const invited = appData.referrals.filter(item => item.referrer.toLowerCase() === key);
  const joinedBy = appData.referrals.find(item => item.referred.toLowerCase() === key) ?? null;
  const ownReferral = joinedBy && joinedBy.status === 'qualified' ? [joinedBy] : [];
  const sum = (
    items: typeof appData.referrals,
    side: ReferralRewardSide,
    field: 'referrerRewardWei' | 'referredRewardWei',
    statuses: ReferralRewardStatus[],
  ) => items.reduce((total, item) => statuses.includes(rewardStatusFor(item, side) ?? 'blocked') ? total + BigInt(item[field] ?? '0') : total, 0n);
  const pendingWei = sum(invited, 'referrer', 'referrerRewardWei', ['pending']) + sum(ownReferral, 'referred', 'referredRewardWei', ['pending']);
  const claimableWei = sum(invited, 'referrer', 'referrerRewardWei', ['claimable']) + sum(ownReferral, 'referred', 'referredRewardWei', ['claimable']);
  const paidWei = sum(invited, 'referrer', 'referrerRewardWei', ['paid']) + sum(ownReferral, 'referred', 'referredRewardWei', ['paid']);
  const latestPayoutTxHash = [
    ...invited.map(item => item.referrerRewardPayoutTxHash ?? item.rewardPayoutTxHash),
    ...ownReferral.map(item => item.referredRewardPayoutTxHash ?? item.rewardPayoutTxHash),
  ].filter(Boolean).at(-1) ?? null;
  return {
    address,
    invited,
    joinedBy,
    count: invited.length,
    qualified: invited.filter(item => item.status === 'qualified').length,
    rewards: {
      pendingWei: pendingWei.toString(),
      claimableWei: claimableWei.toString(),
      paidWei: paidWei.toString(),
      pendingOKB: formatEther(pendingWei),
      claimableOKB: formatEther(claimableWei),
      paidOKB: formatEther(paidWei),
      blocked: invited.filter(item => rewardStatusFor(item, 'referrer') === 'blocked').length,
      latestPayoutTxHash,
      latestPayoutUrl: latestPayoutTxHash ? explorerTx(latestPayoutTxHash) : null,
      rule: {
        referrerRewardWei: REFERRER_REWARD_WEI.toString(),
        referredRewardWei: REFERRED_REWARD_WEI.toString(),
        minStakeWei: REFERRAL_MIN_STAKE_WEI.toString(),
        dailyCap: REFERRAL_DAILY_CAP,
      },
    },
  };
}

function referralClaimPlan(address: string): Array<{ referral: PersistedReferral; side: ReferralRewardSide; amountWei: bigint }> {
  const key = address.toLowerCase();
  const plan: Array<{ referral: PersistedReferral; side: ReferralRewardSide; amountWei: bigint }> = [];
  for (const referral of appData.referrals) {
    if (referral.status !== 'qualified') continue;
    normalizeReferralRewardSides(referral);
    if (referral.referrer.toLowerCase() === key && rewardStatusFor(referral, 'referrer') === 'claimable') {
      plan.push({ referral, side: 'referrer', amountWei: BigInt(referral.referrerRewardWei ?? '0') });
    }
    if (referral.referred.toLowerCase() === key && rewardStatusFor(referral, 'referred') === 'claimable') {
      plan.push({ referral, side: 'referred', amountWei: BigInt(referral.referredRewardWei ?? '0') });
    }
  }
  return plan.filter(item => item.amountWei > 0n);
}

function rewardWalletClients() {
  const privateKey = process.env.REWARD_WALLET_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) return null;
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: xLayerMainnet, transport: http(REWARD_RPC_URL) });
  const walletClient = createWalletClient({ account, chain: xLayerMainnet, transport: http(REWARD_RPC_URL) });
  return { account, publicClient, walletClient };
}

function rewardPaidTodayWei(): bigint {
  const currentEpoch = rewardEpochFor();
  return appData.referrals.reduce((total, referral) => {
    let next = total;
    if (referral.referrerRewardPaidAt && rewardEpochFor(referral.referrerRewardPaidAt) === currentEpoch) {
      next += BigInt(referral.referrerRewardWei ?? '0');
    }
    if (referral.referredRewardPaidAt && rewardEpochFor(referral.referredRewardPaidAt) === currentEpoch) {
      next += BigInt(referral.referredRewardWei ?? '0');
    }
    return next;
  }, 0n);
}

async function persistAppData(): Promise<void> {
  await writeAppData(appData);
}

async function retryPendingStakeReports(): Promise<void> {
  const pending = [...new Set(appData.pendingStakeReports)].filter(hash => /^0x[0-9a-fA-F]{64}$/.test(hash));
  if (pending.length === 0) return;

  const remaining: string[] = [];
  let rewardsChanged = false;
  for (const hash of pending) {
    const indexed = await engine.reportStakeTx(hash as `0x${string}`);
    if (indexed || engine.hasStakeTx(hash)) {
      rewardsChanged = qualifyReferralForTx(hash) || rewardsChanged;
    } else {
      remaining.push(hash);
    }
  }
  rewardsChanged = matureReferralRewards() || rewardsChanged;
  if (remaining.length !== appData.pendingStakeReports.length || rewardsChanged) {
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
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    storage: seasonStorageStatus(),
    season: {
      number: seasonController.getState().seasonNumber,
      phase: seasonController.getState().phase,
      updatedAt: seasonController.getState().updatedAt,
    },
  });
});

app.get('/defillama/overview', async (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const parsed = z.object({
    start: z.coerce.number().int().positive().optional(),
    end: z.coerce.number().int().positive().optional(),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid range' });

  const endTimestamp = parsed.data.end ?? now;
  const startTimestamp = parsed.data.start ?? endTimestamp - 24 * 60 * 60;
  if (startTimestamp >= endTimestamp) return res.status(400).json({ error: 'invalid range' });

  const metrics = engine.getDefiLlamaMetrics(startTimestamp, endTimestamp);
  const fvbTradeMetrics = fvbTradeVolumeForRange(startTimestamp, endTimestamp);
  const okbUsd = await getOkbUsdPrice();
  const predictionVolumeOkb = Number(formatEther(BigInt(metrics.dailyVolumeWei)));
  const feesOkb = Number(formatEther(BigInt(metrics.dailyFeesWei)));
  const revenueOkb = Number(formatEther(BigInt(metrics.dailyRevenueWei)));
  const fvbTradeVolumeOkb = Number(formatEther(BigInt(fvbTradeMetrics.dailyFvbTradeVolumeOkbWei)));
  const platformVolumeOkb = predictionVolumeOkb + fvbTradeVolumeOkb;

  res.json({
    protocol: 'FanVibe',
    chain: 'xlayer',
    timestamp: now,
    ...metrics,
    ...fvbTradeMetrics,
    dailyVolumeOkb: predictionVolumeOkb,
    dailyFeesOkb: feesOkb,
    dailyRevenueOkb: revenueOkb,
    dailyVolumeUsd: predictionVolumeOkb * okbUsd.price,
    dailyFeesUsd: feesOkb * okbUsd.price,
    dailyRevenueUsd: revenueOkb * okbUsd.price,
    dailyPredictionVolumeWei: metrics.dailyVolumeWei,
    dailyPredictionVolumeOkb: predictionVolumeOkb,
    dailyPredictionVolumeUsd: predictionVolumeOkb * okbUsd.price,
    dailyFvbTradeVolumeOkb: fvbTradeVolumeOkb,
    dailyFvbTradeVolumeUsd: fvbTradeVolumeOkb * okbUsd.price,
    dailyPlatformVolumeOkb: platformVolumeOkb,
    dailyPlatformVolumeUsd: platformVolumeOkb * okbUsd.price,
    okbUsd,
    methodology: {
      volume: 'DefiLlama dailyVolume is the conservative FanVibe protocol volume: gross accepted OKB stakes on real World Cup match and champion markets during the requested time range. Rejected/refunded stake attempts are excluded.',
      fees: 'FanVibe applies a 0.5% protocol fee to accepted stakes.',
      revenue: 'Protocol revenue equals the 0.5% accepted-stake fee retained by FanVibe.',
      fvbTradeVolume: 'FVB trade volume is exposed separately from protocol volume. It is estimated from verified on-chain FVB Transfer logs against configured post-graduation pool/counterparty addresses and bucketed by block timestamp.',
      platformVolume: 'FanVibe campaign/platform volume is prediction volume plus the separately indexed FVB trade volume. It is not used for protocol fees or revenue.',
    },
  });
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

app.get('/matchday-cup/leaderboard', async (req, res) => {
  const parsed = z.coerce.number().int().min(1).max(50).default(20).safeParse(req.query.limit);
  if (!parsed.success) return res.status(400).json({ error: 'invalid limit' });
  const allEntries = await matchdayEntriesWithEligibility(10_000);
  const qualifiedEntries = qualifiedMatchdayEntries(allEntries);
  const entries = qualifiedEntries.slice(0, parsed.data);
  const entryMinimumOkbWei = await fvbEntryMinOkbWei();
  res.json({
    entries,
    activity: {
      totalFans: allEntries.length,
      eligibleFans: qualifiedEntries.length,
      pendingFvbFans: allEntries.filter(entry => entry.fvbEligible === false).length,
      syncingFvbFans: allEntries.filter(entry => entry.fvbEligible === null || entry.fvbEligible === undefined).length,
    },
    fvbEligibility: {
      tokenAddress: FANVIBE_TOKEN_ADDRESS,
      capWei: null,
      capTokens: null,
      minimumUsd: FVB_ENTRY_MIN_USD,
      minimumOkbWei: entryMinimumOkbWei.toString(),
    },
    tradeIndex: {
      enabled: FVB_TRADE_INDEX_ENABLED,
      source: appData.fvbTradeIndex?.source ?? 'transfer_logs',
      scope: fvbTradeSourceScope(),
      lastScannedBlock: appData.fvbTradeIndex?.lastScannedBlock ?? 0,
      updatedAt: appData.fvbTradeIndex?.updatedAt ?? null,
    },
    scoreRules: scoreRulesWithTrading(),
  });
});

app.get('/matchday-cup/fvb-balance/:address', async (req, res) => {
  const parsed = addressSchema.safeParse(req.params.address);
  if (!parsed.success) return res.status(400).json({ error: 'invalid address' });
  const balance = await readFvbBalance(parsed.data);
  const price = await getFvbMarketPrice();
  const priceWei = price.priceOkbWei ? BigInt(price.priceOkbWei) : null;
  const minimumValueWei = await fvbEntryMinOkbWei();
  const balanceValueWei = balance !== null && priceWei ? (balance * priceWei) / 10n ** 18n : null;
  const eligible = balance === null
    ? null
    : priceWei
      ? (balanceValueWei ?? 0n) >= minimumValueWei
      : balance > 0n;
  res.json({
    address: parsed.data,
    tokenAddress: FANVIBE_TOKEN_ADDRESS,
    balanceWei: balance?.toString() ?? null,
    eligibleWei: balance?.toString() ?? null,
    eligibilityCapWei: null,
    entryMinimumUsd: FVB_ENTRY_MIN_USD,
    entryMinimumOkbWei: minimumValueWei.toString(),
    balanceValueWei: balanceValueWei?.toString() ?? null,
    eligible,
    privateRpcConfigured: Boolean(PRIVATE_X_LAYER_RPC_URL),
    rpcFallbacks: FVB_RPC_URLS.length,
  });
});

app.get('/fvb/price', async (_req, res) => {
  const price = await getFvbMarketPrice();
  res.json({
    tokenAddress: FANVIBE_TOKEN_ADDRESS,
    quoteToken: 'OKB',
    priceOkbWei: price.priceOkbWei,
    source: price.source,
    updatedAt: price.updatedAt,
    cached: price.cached,
  });
});

app.get('/matchday-cup/rank/:address', async (req, res) => {
  const parsed = addressSchema.safeParse(req.params.address);
  if (!parsed.success) return res.status(400).json({ error: 'invalid address' });
  const address = parsed.data;
  const key = address.toLowerCase();
  const entries = await matchdayEntriesWithEligibility(10_000);
  const qualifiedEntries = qualifiedMatchdayEntries(entries);
  const ranked = qualifiedEntries.find(entry => entry.address.toLowerCase() === key);
  const unqualifiedStats = entries.find(entry => entry.address.toLowerCase() === key);
  const emptyEntry = {
    rank: null,
    address,
    displayName: profileNameFor(address),
    volumeWei: '0',
    returnedWei: '0',
    wins: 0,
    losses: 0,
    active: 0,
    refunded: 0,
    positions: 0,
    winRate: null,
    lastActiveAt: 0,
    score: 0,
    scoreComponents: {
      volume: 0,
      wins: 0,
      active: 0,
      participation: 0,
    },
    fvbTradeVolumeWei: '0',
    fvbTradeVolumeOkbWei: '0',
    fvbTradeTransfers: 0,
    fvbLastTradeAt: 0,
    scoreRules: scoreRulesWithTrading(),
  };
  const entry = ranked ?? (unqualifiedStats ? { ...unqualifiedStats, rank: null } : emptyEntry);
  const entryWithEligibility = ranked || unqualifiedStats ? entry : (await attachFvbEligibility([entry]))[0];
  const entryMinimumOkbWei = await fvbEntryMinOkbWei();
  res.json({
    entry: ranked ? entryWithEligibility : { ...entryWithEligibility, rank: null },
    ranked: !!ranked,
    fvbEligibility: {
      tokenAddress: FANVIBE_TOKEN_ADDRESS,
      capWei: null,
      capTokens: null,
      minimumUsd: FVB_ENTRY_MIN_USD,
      minimumOkbWei: entryMinimumOkbWei.toString(),
    },
    tradeIndex: {
      enabled: FVB_TRADE_INDEX_ENABLED,
      source: appData.fvbTradeIndex?.source ?? 'transfer_logs',
      scope: fvbTradeSourceScope(),
      lastScannedBlock: appData.fvbTradeIndex?.lastScannedBlock ?? 0,
      updatedAt: appData.fvbTradeIndex?.updatedAt ?? null,
    },
    scoreRules: scoreRulesWithTrading(),
  });
});

app.get('/matchday-cup/country-support', async (req, res) => {
  const parsed = z.coerce.number().int().min(1).max(50).default(12).safeParse(req.query.limit);
  if (!parsed.success) return res.status(400).json({ error: 'invalid limit' });
  const eligibleEntries = qualifiedMatchdayEntries(await matchdayEntriesWithEligibility(10_000));
  const eligibleAddresses = new Set(eligibleEntries.map(entry => entry.address.toLowerCase()));
  res.json({ entries: engine.getMatchdayCountrySupport(parsed.data, eligibleAddresses) });
});

app.get('/matchday-cup/fvb-holders', async (req, res) => {
  const parsed = z.coerce.number().int().min(1).max(50).default(20).safeParse(req.query.limit);
  if (!parsed.success) return res.status(400).json({ error: 'invalid limit' });
  const entries = await fvbHolderLeaderboard(parsed.data);
  const entryMinimumOkbWei = await fvbEntryMinOkbWei();
  res.json({
    entries,
    fvbEligibility: {
      tokenAddress: FANVIBE_TOKEN_ADDRESS,
      capWei: null,
      capTokens: null,
      minimumUsd: FVB_ENTRY_MIN_USD,
      minimumOkbWei: entryMinimumOkbWei.toString(),
    },
    source: 'indexed_fvb_wallets',
  });
});

app.get('/matchday-cup/trade-index', (_req, res) => {
  const index = ensureFvbTradeIndex();
  res.json({
    enabled: FVB_TRADE_INDEX_ENABLED,
    tokenAddress: FANVIBE_TOKEN_ADDRESS,
    source: index.source,
      scope: fvbTradeSourceScope(),
      lastScannedBlock: index.lastScannedBlock,
      holderLastScannedBlock: index.holderLastScannedBlock ?? 0,
      updatedAt: index.updatedAt,
      walletsIndexed: Object.keys(index.wallets).length,
      dailyBucketsIndexed: Object.keys(index.daily ?? {}).length,
      processedLogsIndexed: Object.keys(index.processedLogs ?? {}).length,
      holderCandidatesIndexed: Object.keys(index.holderCandidates ?? {}).length,
      scopedCounterparties: index.scopedCounterparties,
      backfill: index.backfill ?? { status: 'idle' },
    scoring: {
      fvbTradeVolumePointWei: FVB_TRADE_VOLUME_POINT_WEI.toString(),
      fvbTradeVolumePointOKB: formatEther(FVB_TRADE_VOLUME_POINT_WEI),
    },
  });
});

app.post('/admin/fvb-trades/backfill', async (req, res) => {
  if (!ADMIN_API_TOKEN) return res.status(404).json({ error: 'not found' });
  const token = String(req.header('x-admin-token') ?? req.query.token ?? '');
  if (token !== ADMIN_API_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  if (fvbTradeBackfillRunning) {
    return res.status(409).json({ error: 'backfill already running', backfill: ensureFvbTradeIndex().backfill });
  }

  rebuildFvbTradeIndex().catch(err => {
    console.error(`[FanVibe] FVB trade backfill failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  res.json({ ok: true, backfill: ensureFvbTradeIndex().backfill });
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
    createdAt: Date.now(),
    status: 'captured' as const,
  };
  appData.referrals.push(referral);
  if (parsed.data.txHash && engine.hasStakeTx(parsed.data.txHash)) {
    qualifyReferralForTx(parsed.data.txHash);
  }
  matureReferralRewards();
  await persistAppData();
  res.json({ ok: true, referral });
});

app.get('/referrals/:address', async (req, res) => {
  const parsed = addressSchema.safeParse(req.params.address);
  if (!parsed.success) return res.status(400).json({ error: 'invalid address' });
  if (matureReferralRewards()) await persistAppData();
  res.json(referralRewardSummary(parsed.data));
});

app.post('/referrals/:address/claim', async (req, res) => {
  if (!REFERRAL_CLAIMS_ENABLED) return res.status(503).json({ error: 'referral claims are paused' });
  const parsed = addressSchema.safeParse(req.params.address);
  if (!parsed.success) return res.status(400).json({ error: 'invalid address' });

  const claimant = parsed.data;
  let changed = matureReferralRewards();
  const claimPlan = referralClaimPlan(claimant);
  const totalWei = claimPlan.reduce((total, item) => total + item.amountWei, 0n);
  if (totalWei <= 0n) {
    if (changed) await persistAppData();
    return res.json({ ok: true, amountWei: '0', txHash: null, txUrl: null, summary: referralRewardSummary(claimant) });
  }
  if (totalWei > REWARD_MAX_CLAIM_WEI) {
    console.warn(`[FanVibe] Referral claim blocked by max payout: ${claimant} ${formatEther(totalWei)} OKB`);
    return res.status(429).json({ error: 'claim exceeds reward limit' });
  }
  const paidTodayWei = rewardPaidTodayWei();
  if (paidTodayWei + totalWei > REWARD_DAILY_PAYOUT_CAP_WEI) {
    console.warn(`[FanVibe] Referral claim blocked by daily reward-wallet cap: ${formatEther(paidTodayWei + totalWei)} OKB`);
    return res.status(429).json({ error: 'reward cycle limit reached' });
  }

  const rewardWallet = rewardWalletClients();
  if (!rewardWallet) return res.status(503).json({ error: 'reward wallet is not configured' });

  const balance = await rewardWallet.publicClient.getBalance({ address: rewardWallet.account.address });
  if (balance < totalWei) {
    console.warn(`[FanVibe] Referral claim blocked by reward wallet balance: ${formatEther(balance)} OKB available`);
    return res.status(503).json({ error: 'reward wallet needs funding' });
  }

  try {
    const txHash = await rewardWallet.walletClient.sendTransaction({
      account: rewardWallet.account,
      chain: xLayerMainnet,
      to: claimant as Address,
      value: totalWei,
    });
    const receipt = await rewardWallet.publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    if (receipt.status !== 'success') return res.status(502).json({ error: 'reward payout failed' });

    for (const item of claimPlan) {
      setRewardStatus(item.referral, item.side, 'paid');
      if (item.side === 'referrer') {
        item.referral.referrerRewardPayoutTxHash = txHash;
        item.referral.referrerRewardPaidAt = Date.now();
      } else {
        item.referral.referredRewardPayoutTxHash = txHash;
        item.referral.referredRewardPaidAt = Date.now();
      }
      item.referral.rewardPayoutTxHash = txHash;
    }
    changed = true;
    await persistAppData();
    console.log(`[FanVibe] Referral claim paid: ${claimant} ${formatEther(totalWei)} OKB ${txHash}`);
    res.json({
      ok: true,
      amountWei: totalWei.toString(),
      amountOKB: formatEther(totalWei),
      txHash,
      txUrl: explorerTx(txHash),
      summary: referralRewardSummary(claimant),
    });
  } catch (err: unknown) {
    if (changed) await persistAppData();
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FanVibe] Referral claim failed for ${claimant}: ${message}`);
    res.status(502).json({ error: 'reward payout failed' });
  }
});

app.get('/worldcup/feed', async (req, res) => {
  const force = req.query.force === '1';
  const feed = await getWorldCupFeed(force);
  if (process.env.LIVE_SPORTS_REQUIRED === '1' && feed.mode !== 'live') {
    return res.status(503).json(feed);
  }
  engine.syncFixtures(feed.fixtures);
  engine.syncMatchStates(feed.matchStates);
  for (const matchState of Object.values(feed.matchStates)) {
    if (matchState.status !== 'finished') continue;
    const result = await engine.settleSyncedFixture(matchState.fixtureId, outcomeFromMatchState(matchState));
    if (result) broadcast('settlement', result);
  }
  res.json(feed);
});

app.get('/worldcup/match/:fixtureId', async (req, res) => {
  try {
    const detail = await getWorldCupMatchDetail(req.params.fixtureId);
    engine.syncFixtures([detail.fixture]);
    engine.syncMatchStates({ [detail.fixture.id]: detail.matchState });
    if (detail.matchState.status === 'finished') {
      const result = await engine.settleSyncedFixture(detail.matchState.fixtureId, outcomeFromMatchState(detail.matchState));
      if (result) broadcast('settlement', result);
    }
    res.json(detail);
  } catch (err: unknown) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'World Cup match not found' });
  }
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

async function refreshWorldCupFixture(fixtureId: string): Promise<{ mode: string; providerConfigured: boolean } | null> {
  try {
    const detail = await getWorldCupMatchDetail(fixtureId);
    if (process.env.LIVE_SPORTS_REQUIRED === '1' && detail.mode !== 'live') {
      return { mode: detail.mode, providerConfigured: detail.providerConfigured };
    }

    engine.syncFixtures([detail.fixture]);
    engine.syncMatchStates({ [detail.fixture.id]: detail.matchState });
    if (detail.matchState.status === 'finished') {
      const result = await engine.settleSyncedFixture(detail.matchState.fixtureId, outcomeFromMatchState(detail.matchState));
      if (result) broadcast('settlement', result);
    }
    return { mode: detail.mode, providerConfigured: detail.providerConfigured };
  } catch (err: unknown) {
    console.warn(`[FanVibe] World Cup fixture refresh failed for ${fixtureId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function syncSeasonSnapshotWithReferee(state: PersistedSeasonState): Promise<void> {
  if (!Array.isArray(state.fixtures)) return;
  const realtimeFixtures = state.fixtures.filter(fixture => fixture.mode === 'realtime');
  if (realtimeFixtures.length === 0) return;

  engine.syncChampionSeason(state.seasonNumber);
  engine.syncFixtures(realtimeFixtures);
  engine.syncMatchStates(state.matchStates ?? {});

  const finished = Object.values(state.matchStates ?? {})
    .filter((matchState): matchState is MatchState =>
      matchState?.status === 'finished'
      && realtimeFixtures.some(fixture => fixture.id === matchState.fixtureId),
    );

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
        createdAt: Date.now(),
        status: 'captured',
      });
      if (indexed) qualifyReferralForTx(parsed.data.txHash);
    } else if (indexed && existing.status !== 'qualified') {
      qualifyReferralForTx(parsed.data.txHash);
    }
  }

  matureReferralRewards();
  await persistAppData();
  res.json({ ok: true, indexed, queued: !indexed });
});

app.get('/stake/status/:fixtureId', async (req, res) => {
  const fixtureId = req.params.fixtureId;
  const shouldRefreshWorldCup = fixtureId.startsWith('wc-') || fixtureId.startsWith('sm-');
  const refresh = shouldRefreshWorldCup ? await refreshWorldCupFixture(fixtureId) : null;
  const fixture = engine.getState().fixtures.find(f => f.id === req.params.fixtureId);
  const liveProviderRequiredButUnavailable = shouldRefreshWorldCup
    && process.env.LIVE_SPORTS_REQUIRED === '1'
    && refresh?.mode !== 'live';
  const canStake = !liveProviderRequiredButUnavailable
    && !!fixture
    && !UNRESOLVED_TEAM_CODES.has(fixture.home.code)
    && !UNRESOLVED_TEAM_CODES.has(fixture.away.code)
    && (fixture.mode === 'realtime' || fixture.status !== 'locked')
    && fixture.status !== 'settled';
  const reason = liveProviderRequiredButUnavailable
    ? 'Live match data is not available for this fixture yet.'
    : !fixture
    ? 'Fixture is not available yet.'
    : fixture.status === 'locked' && fixture.mode !== 'realtime'
      ? 'This match is already live. Staking is closed.'
      : fixture.status === 'settled'
        ? 'This match has already settled.'
        : UNRESOLVED_TEAM_CODES.has(fixture.home.code) || UNRESOLVED_TEAM_CODES.has(fixture.away.code)
          ? 'Fixture teams are not resolved yet.'
          : 'Staking is open.';
  res.json({ fixtureId, canStake, status: fixture?.status ?? 'missing', reason });
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
const SIMULATION_ENABLED = process.env.ENABLE_SIMULATION === 'true';

httpServer.listen(PORT, async () => {
  console.log(`[FanVibe] HTTP server on port ${PORT}`);
  console.log(`[FanVibe] WebSocket on ws://localhost:${PORT}`);

  try {
    appData = await readAppData();
    ensureFvbTradeIndex();
    await engine.start();
    if (SIMULATION_ENABLED) {
      await seasonController.start();
      engine.syncChampionSeason(seasonController.getState().seasonNumber);
    } else {
      console.log('[FanVibe] Simulation retired - season controller disabled');
    }
    await retryPendingStakeReports();
    await scanFvbTradeVolume();
    await scanFvbHolderCandidates();
    setInterval(() => {
      retryPendingStakeReports().catch(err => {
        console.error(`[FanVibe] Pending stake retry failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, 15_000);
    setInterval(() => {
      scanFvbTradeVolume().catch(err => {
        console.error(`[FanVibe] FVB trade scan failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, FVB_TRADE_SCAN_INTERVAL_MS);
    setInterval(() => {
      scanFvbHolderCandidates().catch(err => {
        console.error(`[FanVibe] FVB holder scan failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, FVB_TRADE_SCAN_INTERVAL_MS);
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
