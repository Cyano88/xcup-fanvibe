import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { createPublicClient, createWalletClient, formatEther, http, parseAbiItem, parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { RefereeEngine, encodeStake, encodeChampionStake, CHAMP_TEAMS } from './engine/referee.js';
import type { DaemonLog, SettlementResult, Outcome, MatchState } from './types.js';
import { readAppData, seasonStorageStatus, writeAppData, type PersistedAppData, type PersistedFvbTradeDaily, type PersistedFvbTradeWallet, type PersistedReferral, type PersistedXProfile } from './seasonStore.js';
import { getWorldCupFeed, getWorldCupMatchDetail } from './sportsData.js';
import { getWorldCupNews } from './newsData.js';
import { explorerTx, xLayerHttpTransport, xLayerMainnet, xLayerRpcUrls } from './chain.js';

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
  ?? process.env.X_LAYER_MAINNET_RPC
  ?? process.env.X_LAYER_HTTP_RPC
  ?? process.env.X_LAYER_RPC_URL
  ?? xLayerMainnet.rpcUrls.default.http[0];
const FANVIBE_TOKEN_ADDRESS = (process.env.FANVIBE_TOKEN_ADDRESS ?? '0x35a676Ca9347499f97819813a38ED14e6a7C5e3F') as Address;
const FANVIBE_TOKEN_API_URL = process.env.FANVIBE_TOKEN_API_URL
  ?? 'https://api-prod.eulr.fun/api/tokens/0x35a676ca9347499f97819813a38ed14e6a7c5e3f?network=xlayer';
const FVB_ENTRY_MIN_USD = Number(process.env.FVB_ENTRY_MIN_USD ?? '10');
const FVB_TRADE_ENTRY_MIN_USD = Number(process.env.FVB_TRADE_ENTRY_MIN_USD ?? '10');
const FVB_TRADE_PRIZE_MIN_USD = Number(process.env.FVB_TRADE_PRIZE_MIN_USD ?? '250');
const OKB_USD_FALLBACK = Number(process.env.OKB_USD_PRICE ?? '88');
const OKB_USD_CACHE_TTL_MS = Number(process.env.OKB_USD_CACHE_TTL_MS ?? '1800000');
const PRIVATE_X_LAYER_RPC_URL = process.env.FVB_RPC_URL
  ?? process.env.X_LAYER_MAINNET_RPC
  ?? process.env.X_LAYER_HTTP_RPC
  ?? process.env.X_LAYER_RPC_URL
  ?? process.env.REWARD_RPC_URL;
const FVB_RPC_URLS = xLayerRpcUrls(PRIVATE_X_LAYER_RPC_URL);
const fvbPublicClient = createPublicClient({ chain: xLayerMainnet, transport: xLayerHttpTransport(PRIVATE_X_LAYER_RPC_URL) });
const FVB_PRICE_QUOTE_AMOUNT_WEI = 10n ** 18n;
const FVB_PRICE_CACHE_TTL_MS = Number(process.env.FVB_PRICE_CACHE_TTL_MS ?? '30000');
const FVB_OKX_QUOTE_ENABLED = process.env.FVB_OKX_QUOTE_ENABLED !== '0';
const FVB_V4_MIGRATION_TX = (process.env.FVB_V4_MIGRATION_TX ?? '0x446fa4a18c6e84b8959db1b15892720348ed98c1f72983f487ee79b8c08e9e08') as `0x${string}`;
const FVB_TRADE_INDEX_ENABLED = process.env.FVB_TRADE_INDEX_ENABLED === '1';
const FVB_TRADE_SCAN_INTERVAL_MS = Number(process.env.FVB_TRADE_SCAN_INTERVAL_MS ?? '300000');
const FVB_TRADE_SCAN_CHUNK_BLOCKS = BigInt(Math.max(25, Number(process.env.FVB_TRADE_SCAN_CHUNK_BLOCKS ?? '50')));
const FVB_TRADE_BACKFILL_CHUNK_BLOCKS = BigInt(Math.max(100, Number(process.env.FVB_TRADE_BACKFILL_CHUNK_BLOCKS ?? '10000')));
const FVB_TRADE_SCAN_LOOKBACK_BLOCKS = BigInt(Math.max(1000, Number(process.env.FVB_TRADE_SCAN_LOOKBACK_BLOCKS ?? '10000')));
const FVB_TRADE_MAX_CHUNKS_PER_SCAN = Math.max(1, Number(process.env.FVB_TRADE_MAX_CHUNKS_PER_SCAN ?? '4'));
const FVB_TRADE_BACKFILL_MAX_CHUNKS = Math.max(1, Number(process.env.FVB_TRADE_BACKFILL_MAX_CHUNKS ?? '150'));
const FVB_TRADE_AUTO_BACKFILL_ON_BOOT = process.env.FVB_TRADE_AUTO_BACKFILL_ON_BOOT === '1';
const FVB_TRADE_REPAIR_BACKFILL_ON_BOOT = process.env.FVB_TRADE_REPAIR_BACKFILL_ON_BOOT !== '0';
const FVB_TRADE_RESET_TO_START_BLOCK = process.env.FVB_TRADE_RESET_TO_START_BLOCK === '1';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN ?? process.env.FANVIBE_ADMIN_TOKEN ?? '';
const FVB_HOLDER_START_BLOCK = BigInt(Math.max(0, Number(process.env.FVB_HOLDER_START_BLOCK ?? '62489676')));
const FVB_HOLDER_SCAN_CHUNK_BLOCKS = BigInt(Math.max(25, Number(process.env.FVB_HOLDER_SCAN_CHUNK_BLOCKS ?? '100')));
const FVB_HOLDER_MAX_CHUNKS_PER_SCAN = Math.max(1, Number(process.env.FVB_HOLDER_MAX_CHUNKS_PER_SCAN ?? '2'));
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
  try {
    return await fvbPublicClient.readContract({
      address: FANVIBE_TOKEN_ADDRESS,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [address as Address],
    });
  } catch {
    // The fallback transport already tried configured and public X Layer RPCs.
    return null;
  }
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

async function fvbTradeEntryMinOkbWei(): Promise<bigint> {
  const okbUsd = await getOkbUsdPrice();
  return parseEther((FVB_TRADE_ENTRY_MIN_USD / okbUsd.price).toFixed(8));
}

async function fvbTradePrizeMinOkbWei(): Promise<bigint> {
  const okbUsd = await getOkbUsdPrice();
  return parseEther((FVB_TRADE_PRIZE_MIN_USD / okbUsd.price).toFixed(8));
}

const FVB_TRADE_VOLUME_POINT_WEI = parseEther(process.env.FVB_TRADE_VOLUME_POINT_OKB ?? '0.00001');
const DISTRIBUTION_DAILY_VOLUME_POINT_USD = Number(process.env.DISTRIBUTION_DAILY_VOLUME_POINT_USD ?? '1');
const DISTRIBUTION_X_IMPRESSION_POINT = Math.max(1, Number(process.env.DISTRIBUTION_X_IMPRESSION_POINT ?? '100'));
const DISTRIBUTION_REFERRAL_POINTS = Number(process.env.DISTRIBUTION_REFERRAL_POINTS ?? '1000');
const DISTRIBUTION_STAKE_POINTS = Number(process.env.DISTRIBUTION_STAKE_POINTS ?? '100');
const DISTRIBUTION_WIN_POINTS = Number(process.env.DISTRIBUTION_WIN_POINTS ?? '250');
const DISTRIBUTION_STAKE_DAILY_CAP = Math.max(1, Number(process.env.DISTRIBUTION_STAKE_DAILY_CAP ?? '20'));
const X_CLIENT_ID = process.env.X_CLIENT_ID ?? process.env.TWITTER_CLIENT_ID ?? '';
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET ?? process.env.TWITTER_CLIENT_SECRET ?? '';
const X_CALLBACK_URL = process.env.X_CALLBACK_URL ?? '';
const X_FRONTEND_REDIRECT_URL = process.env.X_FRONTEND_REDIRECT_URL
  ?? process.env.FRONTEND_URL
  ?? 'https://www.fanvibe.xyz';
const X_TOKEN_ENCRYPTION_KEY = process.env.X_TOKEN_ENCRYPTION_KEY ?? process.env.X_ENCRYPTION_KEY ?? '';
const X_AUTH_STATE_TTL_MS = Number(process.env.X_AUTH_STATE_TTL_MS ?? '900000');
const X_SYNC_INTERVAL_MS = Number(process.env.X_SYNC_INTERVAL_MS ?? String(24 * 60 * 60 * 1000));
const X_SYNC_MAX_PAGES = Math.max(1, Number(process.env.X_SYNC_MAX_PAGES ?? '25'));
const X_SCORE_TERMS = (process.env.X_SCORE_TERMS ?? 'fanvibe,FanVibe,#fanvibe,$FVB,FVB')
  .split(',')
  .map(term => term.trim().toLowerCase())
  .filter(Boolean);
let xSyncRunning = false;

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

function resetFvbTradeIndexToStart(index: NonNullable<PersistedAppData['fvbTradeIndex']>, startBlock: bigint): void {
  index.wallets = {};
  index.daily = {};
  index.holderCandidates = {};
  index.processedLogs = {};
  index.lastScannedBlock = Number(startBlock > 0n ? startBlock - 1n : 0n);
  index.updatedAt = Date.now();
  index.backfill = {
    status: 'idle',
    fromBlock: Number(startBlock),
    lastScannedBlock: index.lastScannedBlock,
  };
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

function fvbWalletDailyBucket(wallet: PersistedFvbTradeWallet, timestampMs: number): PersistedFvbTradeDaily {
  const date = fvbTradeDay(timestampMs);
  wallet.daily ??= {};
  wallet.daily[date] ??= {
    date,
    fvbVolumeWei: '0',
    estimatedOkbVolumeWei: '0',
    transfers: 0,
    updatedAt: Date.now(),
  };
  return wallet.daily[date];
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

  const walletDaily = fvbWalletDailyBucket(wallet, timestamp);
  walletDaily.fvbVolumeWei = (BigInt(walletDaily.fvbVolumeWei) + fvbAmountWei).toString();
  walletDaily.estimatedOkbVolumeWei = (BigInt(walletDaily.estimatedOkbVolumeWei) + estimatedOkbWei).toString();
  walletDaily.transfers += 1;
  walletDaily.updatedAt = Date.now();

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
  client: typeof fvbPublicClient,
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

async function fvbTradeStartBlock(client = fvbPublicClient): Promise<bigint> {
  const envBlock = process.env.FVB_TRADE_QUALIFICATION_START_BLOCK
    ?? (FVB_TRADE_RESET_TO_START_BLOCK ? process.env.FVB_TRADE_START_BLOCK : undefined);
  if (envBlock && /^\d+$/.test(envBlock)) return BigInt(envBlock);

  try {
    const receipt = await client.getTransactionReceipt({ hash: FVB_V4_MIGRATION_TX });
    return receipt.blockNumber;
  } catch {
    const latest = await client.getBlockNumber();
    return latest > FVB_TRADE_SCAN_LOOKBACK_BLOCKS ? latest - FVB_TRADE_SCAN_LOOKBACK_BLOCKS : 0n;
  }
}

async function fvbTradeIndexNeedsRepair(client = fvbPublicClient): Promise<boolean> {
  if (!FVB_TRADE_INDEX_ENABLED || !FVB_TRADE_REPAIR_BACKFILL_ON_BOOT) return false;
  const index = ensureFvbTradeIndex();
  const desiredStart = await fvbTradeStartBlock(client);
  const indexedStart = BigInt(index.backfill?.fromBlock ?? index.lastScannedBlock ?? 0);
  if (desiredStart > 0n && indexedStart > desiredStart) return true;
  return index.backfill?.status === 'failed' && desiredStart > 0n && BigInt(index.lastScannedBlock ?? 0) < await client.getBlockNumber();
}

async function rebuildFvbTradeIndex(): Promise<void> {
  if (!FVB_TRADE_INDEX_ENABLED || fvbTradeBackfillRunning) return;
  const client = fvbPublicClient;
  fvbTradeBackfillRunning = true;
  const index = ensureFvbTradeIndex();
  const startedAt = Date.now();
  try {
    const fromStart = await fvbTradeStartBlock(client);
    const latest = await client.getBlockNumber();
    const existingFrom = BigInt(index.backfill?.fromBlock ?? 0);
    const existingLast = BigInt(index.backfill?.lastScannedBlock ?? index.lastScannedBlock ?? 0);
    const canResume = existingFrom === fromStart && existingLast >= fromStart && existingLast < latest;
    if (!canResume) {
      index.wallets = {};
      index.daily = {};
      index.holderCandidates = {};
      index.processedLogs = {};
      index.lastScannedBlock = 0;
    }
    index.backfill = {
      status: 'running',
      startedAt,
      fromBlock: Number(fromStart),
      toBlock: Number(latest),
      lastScannedBlock: canResume ? Number(existingLast) : Number(fromStart),
      logsIndexed: canResume ? Number(index.backfill?.logsIndexed ?? 0) : 0,
    };
    await persistAppData();

    const price = await getFvbMarketPrice();
    const priceWei = price.priceOkbWei ? BigInt(price.priceOkbWei) : 0n;
    let fromBlock = canResume ? existingLast + 1n : fromStart;
    let scannedTo = canResume ? existingLast : fromStart;
    let chunks = 0;
    let logsIndexed = Number(index.backfill.logsIndexed ?? 0);

    while (fromBlock <= latest && chunks < FVB_TRADE_BACKFILL_MAX_CHUNKS) {
      const toBlock = fromBlock + FVB_TRADE_BACKFILL_CHUNK_BLOCKS > latest
        ? latest
        : fromBlock + FVB_TRADE_BACKFILL_CHUNK_BLOCKS;
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
  const client = fvbPublicClient;
  fvbTradeScanRunning = true;
  try {
    const index = ensureFvbTradeIndex();
    const latest = await client.getBlockNumber();
    const initialStart = await fvbTradeStartBlock(client);
    if (FVB_TRADE_RESET_TO_START_BLOCK && initialStart > 0n && BigInt(index.lastScannedBlock ?? 0) < initialStart - 1n) {
      resetFvbTradeIndexToStart(index, initialStart);
      await persistAppData();
    }
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
  const client = fvbPublicClient;
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
  const today = fvbTradeDay(Date.now());
  const daily = wallet?.daily?.[today];
  return {
    fvbTradeVolumeWei: wallet?.fvbVolumeWei ?? '0',
    fvbTradeVolumeOkbWei: wallet?.estimatedOkbVolumeWei ?? '0',
    fvbTradeTransfers: wallet?.transfers ?? 0,
    fvbLastTradeAt: wallet?.lastTradeAt ?? 0,
    fvbDailyTradeVolumeWei: daily?.fvbVolumeWei ?? '0',
    fvbDailyTradeVolumeOkbWei: daily?.estimatedOkbVolumeWei ?? '0',
    fvbDailyTradeTransfers: daily?.transfers ?? 0,
  };
}

function scoreRulesWithTrading() {
  return {
    dailyVolumePointUsd: DISTRIBUTION_DAILY_VOLUME_POINT_USD,
    xImpressionPoint: DISTRIBUTION_X_IMPRESSION_POINT,
    referralPoints: DISTRIBUTION_REFERRAL_POINTS,
    stakePoints: DISTRIBUTION_STAKE_POINTS,
    winPoints: DISTRIBUTION_WIN_POINTS,
    stakeDailyCap: DISTRIBUTION_STAKE_DAILY_CAP,
    fvbTradeEntryMinimumUsd: FVB_TRADE_ENTRY_MIN_USD,
    fvbTradePrizeMinimumUsd: FVB_TRADE_PRIZE_MIN_USD,
    xRequired: true,
    matchdayRequiresFanVibeStake: false,
    fvbTradeSource: 'verified_onchain_fvb_transfer_logs',
    fvbTradeScope: fvbTradeSourceScope(),
  };
}

function xProfileFor(address: string) {
  return appData.xProfiles?.[address.toLowerCase()] ?? null;
}

function xStatsFor(address: string) {
  const key = `${address.toLowerCase()}:${fvbTradeDay(Date.now())}`;
  return appData.xDailyStats?.[key] ?? null;
}

function xAuthConfigured(): boolean {
  return Boolean(X_CLIENT_ID && X_CALLBACK_URL && X_TOKEN_ENCRYPTION_KEY);
}

function base64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function tokenKey(): Buffer {
  return createHash('sha256').update(X_TOKEN_ENCRYPTION_KEY).digest();
}

function encryptToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${base64Url(iv)}.${base64Url(tag)}.${base64Url(encrypted)}`;
}

function decryptToken(value?: string): string | null {
  if (!value || !X_TOKEN_ENCRYPTION_KEY) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, encrypted] = parts.map(part => Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function pruneXAuthStates(now = Date.now()): void {
  if (!appData.xAuthStates) return;
  for (const [state, item] of Object.entries(appData.xAuthStates)) {
    if (now - item.createdAt > X_AUTH_STATE_TTL_MS) delete appData.xAuthStates[state];
  }
}

function xFrontendRedirect(params: Record<string, string>): string {
  const url = new URL(X_FRONTEND_REDIRECT_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function safeXReturnTo(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const target = new URL(value);
    const frontend = new URL(X_FRONTEND_REDIRECT_URL);
    const allowedHosts = new Set([frontend.host, 'fanvibe.xyz', 'www.fanvibe.xyz']);
    return target.protocol === 'https:' && allowedHosts.has(target.host) ? target.toString() : undefined;
  } catch {
    return undefined;
  }
}

function xProfilePublic(profile: PersistedXProfile | null) {
  if (!profile) return null;
  return {
    address: profile.address,
    xUserId: profile.xUserId,
    handle: profile.handle,
    connectedAt: profile.connectedAt,
    updatedAt: profile.updatedAt,
    lastSyncedAt: profile.lastSyncedAt ?? null,
  };
}

type XTokenResponse = {
  token_type?: string;
  expires_in?: number;
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function exchangeXToken(params: URLSearchParams): Promise<XTokenResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (X_CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64')}`;
  } else {
    params.set('client_id', X_CLIENT_ID);
  }
  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: params,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => ({})) as XTokenResponse;
  if (!response.ok) {
    throw new Error(json.error_description ?? json.error ?? `X token HTTP ${response.status}`);
  }
  if (!json.access_token) throw new Error('X token response missing access token');
  return json;
}

async function refreshXAccessToken(profile: PersistedXProfile): Promise<string | null> {
  const existingAccess = decryptToken(profile.accessTokenCipher);
  if (existingAccess && (!profile.expiresAt || profile.expiresAt > Date.now() + 60_000)) return existingAccess;
  const refreshToken = decryptToken(profile.refreshTokenCipher);
  if (!refreshToken) return existingAccess;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const token = await exchangeXToken(params);
  profile.accessTokenCipher = encryptToken(token.access_token!);
  if (token.refresh_token) profile.refreshTokenCipher = encryptToken(token.refresh_token);
  profile.tokenType = token.token_type ?? profile.tokenType ?? 'bearer';
  profile.scope = token.scope ?? profile.scope;
  profile.expiresAt = token.expires_in ? Date.now() + token.expires_in * 1000 : profile.expiresAt;
  profile.updatedAt = Date.now();
  await persistAppData();
  return token.access_token!;
}

function tweetMatchesScoreTerms(text: string): boolean {
  const lower = text.toLowerCase();
  return X_SCORE_TERMS.length === 0 || X_SCORE_TERMS.some(term => lower.includes(term));
}

function tweetMetricTotal(metrics: Record<string, unknown> | undefined): number {
  if (!metrics) return 0;
  return ['like_count', 'reply_count', 'retweet_count', 'quote_count', 'bookmark_count']
    .reduce((total, key) => total + Math.max(0, Number(metrics[key] ?? 0)), 0);
}

async function fetchXDailyStats(profile: PersistedXProfile, date = fvbTradeDay(Date.now())) {
  const accessToken = await refreshXAccessToken(profile);
  if (!accessToken) throw new Error('x access token unavailable');
  const start = `${date}T00:00:00Z`;
  const end = `${date}T23:59:59Z`;
  const fields = 'created_at,text,public_metrics,non_public_metrics,organic_metrics';
  const url = new URL(`https://api.twitter.com/2/users/${encodeURIComponent(profile.xUserId)}/tweets`);
  url.searchParams.set('max_results', '100');
  url.searchParams.set('start_time', start);
  url.searchParams.set('end_time', end);
  url.searchParams.set('tweet.fields', fields);
  url.searchParams.set('exclude', 'retweets,replies');

  const allTweets: Array<{
    text?: string;
    public_metrics?: Record<string, unknown>;
    non_public_metrics?: Record<string, unknown>;
    organic_metrics?: Record<string, unknown>;
  }> = [];
  let nextToken: string | undefined;
  let publicOnly = false;
  for (let page = 0; page < X_SYNC_MAX_PAGES; page += 1) {
    if (nextToken) url.searchParams.set('pagination_token', nextToken);
    else url.searchParams.delete('pagination_token');
    if (publicOnly) url.searchParams.set('tweet.fields', 'created_at,text,public_metrics');
    let response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!publicOnly && (response.status === 400 || response.status === 403)) {
      publicOnly = true;
      url.searchParams.set('tweet.fields', 'created_at,text,public_metrics');
      response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
    }
    const json = await response.json().catch(() => ({})) as {
      data?: typeof allTweets;
      meta?: { result_count?: number; next_token?: string };
      title?: string;
      detail?: string;
    };
    if (!response.ok) throw new Error(json.detail ?? json.title ?? `X tweets HTTP ${response.status}`);
    allTweets.push(...(json.data ?? []));
    nextToken = json.meta?.next_token;
    if (!nextToken) break;
  }

  const tweets = allTweets.filter(tweet => tweetMatchesScoreTerms(tweet.text ?? ''));
  let impressions = 0;
  let engagements = 0;
  for (const tweet of tweets) {
    const publicEngagement = tweetMetricTotal(tweet.public_metrics);
    const nonPublic = Number(tweet.non_public_metrics?.impression_count ?? 0);
    const organic = Number(tweet.organic_metrics?.impression_count ?? 0);
    impressions += Math.max(0, nonPublic || organic || publicEngagement);
    engagements += publicEngagement;
  }
  return { date, impressions, engagements, tweets: tweets.length };
}

async function syncXProfileStats(profile: PersistedXProfile, date = fvbTradeDay(Date.now())) {
  const stats = await fetchXDailyStats(profile, date);
  const key = `${profile.address.toLowerCase()}:${date}`;
  appData.xDailyStats ??= {};
  appData.xDailyStats[key] = {
    address: profile.address,
    xUserId: profile.xUserId,
    handle: profile.handle,
    date,
    impressions: stats.impressions,
    engagements: stats.engagements,
    tweets: stats.tweets,
    updatedAt: Date.now(),
  };
  profile.lastSyncedAt = Date.now();
  profile.updatedAt = Date.now();
  await persistAppData();
  return appData.xDailyStats[key];
}

async function syncConnectedXProfiles(): Promise<void> {
  if (xSyncRunning || !xAuthConfigured()) return;
  xSyncRunning = true;
  try {
    const profiles = Object.values(appData.xProfiles ?? {}).filter(profile => profile.refreshTokenCipher || profile.accessTokenCipher);
    for (const profile of profiles) {
      try {
        await syncXProfileStats(profile);
      } catch (err) {
        console.warn(`[FanVibe] X sync failed for ${profile.address}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    xSyncRunning = false;
  }
}

function xScoreFor(address: string) {
  const stats = xStatsFor(address);
  const impressions = Math.max(0, Number(stats?.impressions ?? 0));
  return Math.floor(impressions / DISTRIBUTION_X_IMPRESSION_POINT);
}

function walletMeetsTradeMinimum(address: string, prizeMinWei: bigint): boolean {
  return BigInt(fvbTradeStats(address).fvbTradeVolumeOkbWei) >= prizeMinWei;
}

function qualifiedReferralCount(address: string, prizeMinWei: bigint): number {
  const key = address.toLowerCase();
  if (!xProfileFor(key) || !walletMeetsTradeMinimum(key, prizeMinWei)) return 0;
  return appData.referrals.filter(referral =>
    referral.status === 'qualified'
    && referral.referrer.toLowerCase() === key
    && !!xProfileFor(referral.referred)
    && walletMeetsTradeMinimum(referral.referred, prizeMinWei)
  ).length;
}

async function attachFvbTrading<T extends { address: string; positions?: number; dailyPositions?: number; wins?: number; score?: number; scoreComponents?: Record<string, number>; lastActiveAt?: number }>(entries: T[]) {
  const entryMinWei = await fvbTradeEntryMinOkbWei();
  const prizeMinWei = await fvbTradePrizeMinOkbWei();
  const okbUsd = await getOkbUsdPrice();
  return entries
    .map(entry => {
      const stats = fvbTradeStats(entry.address);
      const tradeOkbWei = BigInt(stats.fvbTradeVolumeOkbWei);
      const dailyTradeOkb = Number(formatEther(BigInt(stats.fvbDailyTradeVolumeOkbWei)));
      const dailyVolumePoints = Math.floor((dailyTradeOkb * okbUsd.price) / Math.max(0.000001, DISTRIBUTION_DAILY_VOLUME_POINT_USD));
      const socialPoints = xScoreFor(entry.address);
      const referrals = qualifiedReferralCount(entry.address, prizeMinWei);
      const referralPoints = referrals * DISTRIBUTION_REFERRAL_POINTS;
      const countedStakes = Math.min(entry.dailyPositions ?? 0, DISTRIBUTION_STAKE_DAILY_CAP);
      const stakePoints = countedStakes * DISTRIBUTION_STAKE_POINTS;
      const winPoints = (entry.wins ?? 0) * DISTRIBUTION_WIN_POINTS;
      const xProfile = xProfileFor(entry.address);
      const xStats = xStatsFor(entry.address);
      const fvbPrizeEligible = tradeOkbWei >= prizeMinWei;
      const xConnected = !!xProfile;
      const distributionQualified = fvbPrizeEligible && xConnected;
      const score = distributionQualified
        ? dailyVolumePoints + socialPoints + referralPoints + stakePoints + winPoints
        : 0;
      return {
        ...entry,
        ...stats,
        xConnected,
        xHandle: xProfile?.handle ?? null,
        xUserId: xProfile?.xUserId ?? null,
        xImpressions: xStats?.impressions ?? 0,
        xEngagements: xStats?.engagements ?? 0,
        xTweets: xStats?.tweets ?? 0,
        qualifiedReferrals: referrals,
        fvbTradeEntryMinimumUsd: FVB_TRADE_ENTRY_MIN_USD,
        fvbTradeEntryMinimumOkbWei: entryMinWei.toString(),
        fvbTradePrizeMinimumUsd: FVB_TRADE_PRIZE_MIN_USD,
        fvbTradePrizeMinimumOkbWei: prizeMinWei.toString(),
        fvbTradeEligible: tradeOkbWei >= entryMinWei,
        fvbPrizeEligible,
        fanvibeActive: (entry.positions ?? 0) > 0,
        matchdayQualified: distributionQualified,
        distributionQualified,
        eligibilityReason: !fvbPrizeEligible
          ? `Trade $${FVB_TRADE_PRIZE_MIN_USD}+ FVB`
          : !xConnected
            ? 'Connect X'
            : 'Qualified',
        score,
        scoreComponents: {
          dailyVolume: dailyVolumePoints,
          social: socialPoints,
          referrals: referralPoints,
          stakes: stakePoints,
          wins: winPoints,
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
  type MatchdayEntrySeed = {
    rank: number | null;
    address: string;
    displayName?: string;
    volumeWei: string;
    returnedWei: string;
    wins: number;
    losses: number;
    active: number;
    refunded: number;
    positions: number;
    dailyPositions?: number;
    winRate: number | null;
    lastActiveAt: number;
    score?: number;
    scoreComponents?: Record<string, number>;
    scoreRules?: Record<string, unknown>;
  };
  const baseEntries: MatchdayEntrySeed[] = engine.getMatchdayCupLeaderboard(limit).map(entry => ({
    ...entry,
    displayName: profileNameFor(entry.address),
  }));
  const seen = new Set(baseEntries.map(entry => entry.address.toLowerCase()));
  for (const wallet of Object.values(appData.fvbTradeIndex?.wallets ?? {})) {
    const key = wallet.address.toLowerCase();
    if (seen.has(key) || key === ZERO_ADDRESS || FVB_TRADE_COUNTERPARTIES.has(key)) continue;
    seen.add(key);
    baseEntries.push({
      rank: null,
      address: wallet.address,
      displayName: profileNameFor(wallet.address),
      volumeWei: '0',
      returnedWei: '0',
      wins: 0,
      losses: 0,
      active: 0,
      refunded: 0,
      positions: 0,
      dailyPositions: 0,
      winRate: null,
      lastActiveAt: wallet.lastTradeAt,
      score: 0,
      scoreComponents: {
        dailyVolume: 0,
        social: 0,
        referrals: 0,
        stakes: 0,
        wins: 0,
      },
      scoreRules: scoreRulesWithTrading(),
    });
  }
  const entries = await attachFvbTrading(baseEntries);
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

async function fvbTraderLeaderboard(limit: number) {
  const entries = await matchdayEntriesWithEligibility(10_000);
  return entries
    .filter(entry => BigInt(entry.fvbTradeVolumeOkbWei ?? '0') > 0n)
    .sort((a, b) => {
      const tradeDiff = BigInt(b.fvbTradeVolumeOkbWei ?? '0') - BigInt(a.fvbTradeVolumeOkbWei ?? '0');
      if (tradeDiff !== 0n) return tradeDiff > 0n ? 1 : -1;
      return (b.fvbLastTradeAt ?? 0) - (a.fvbLastTradeAt ?? 0);
    })
    .slice(0, limit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function qualifiedMatchdayEntries<T extends { rank: number | null; matchdayQualified?: boolean | null }>(entries: T[]): T[] {
  return entries
    .filter(entry => entry.matchdayQualified === true)
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
  const transport = xLayerHttpTransport(REWARD_RPC_URL);
  const publicClient = createPublicClient({ chain: xLayerMainnet, transport });
  const walletClient = createWalletClient({ account, chain: xLayerMainnet, transport });
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
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    storage: seasonStorageStatus(),
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
  const tradeEntryMinimumOkbWei = await fvbTradeEntryMinOkbWei();
  const tradePrizeMinimumOkbWei = await fvbTradePrizeMinOkbWei();
  res.json({
    entries,
    activity: {
      totalFans: allEntries.length,
      eligibleFans: qualifiedEntries.length,
      pendingFvbFans: allEntries.filter(entry => entry.fvbTradeEligible === false).length,
      syncingFvbFans: allEntries.filter(entry => entry.fvbEligible === null || entry.fvbEligible === undefined).length,
      prizeEligibleFans: allEntries.filter(entry => entry.fvbPrizeEligible === true).length,
      activeFanVibeFans: allEntries.filter(entry => entry.fanvibeActive === true).length,
      totalStakePositions: allEntries.reduce((sum, entry) => sum + (entry.positions ?? 0), 0),
      xConnectedFans: allEntries.filter(entry => entry.xConnected === true).length,
      pendingXFans: allEntries.filter(entry => entry.fvbPrizeEligible === true && entry.xConnected !== true).length,
      pendingFanVibeActionFans: allEntries.filter(entry => entry.fvbPrizeEligible === true && entry.fanvibeActive !== true).length,
      tradedFans: allEntries.filter(entry => BigInt(entry.fvbTradeVolumeOkbWei ?? '0') > 0n).length,
      totalTradeVolumeOkbWei: allEntries
        .reduce((sum, entry) => sum + BigInt(entry.fvbTradeVolumeOkbWei ?? '0'), 0n)
        .toString(),
    },
    fvbEligibility: {
      tokenAddress: FANVIBE_TOKEN_ADDRESS,
      capWei: null,
      capTokens: null,
      minimumUsd: FVB_ENTRY_MIN_USD,
      minimumOkbWei: entryMinimumOkbWei.toString(),
    },
    tradeEligibility: {
      tokenAddress: FANVIBE_TOKEN_ADDRESS,
      entryMinimumUsd: FVB_TRADE_ENTRY_MIN_USD,
      entryMinimumOkbWei: tradeEntryMinimumOkbWei.toString(),
      prizeMinimumUsd: FVB_TRADE_PRIZE_MIN_USD,
      prizeMinimumOkbWei: tradePrizeMinimumOkbWei.toString(),
      fanvibeAction: 'Distribution Cup ranking requires connected X plus $250+ verified FVB trading volume.',
      prizeReview: 'Prize-qualified wallets require clean verified FVB trading activity, connected X, and review before payout.',
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
      dailyPositions: 0,
      winRate: null,
      lastActiveAt: 0,
      score: 0,
      scoreComponents: {
      dailyVolume: 0,
      social: 0,
      referrals: 0,
      stakes: 0,
      wins: 0,
    },
    fvbTradeVolumeWei: '0',
    fvbTradeVolumeOkbWei: '0',
    fvbDailyTradeVolumeWei: '0',
    fvbDailyTradeVolumeOkbWei: '0',
    fvbDailyTradeTransfers: 0,
    fvbTradeTransfers: 0,
    fvbLastTradeAt: 0,
    xConnected: false,
    xHandle: null,
    xImpressions: 0,
    xEngagements: 0,
    xTweets: 0,
    qualifiedReferrals: 0,
    fvbTradeEntryMinimumUsd: FVB_TRADE_ENTRY_MIN_USD,
    fvbTradePrizeMinimumUsd: FVB_TRADE_PRIZE_MIN_USD,
    fvbTradeEligible: false,
    fvbPrizeEligible: false,
    fanvibeActive: false,
    matchdayQualified: false,
    distributionQualified: false,
    eligibilityReason: 'Connect X',
    scoreRules: scoreRulesWithTrading(),
  };
  const entry = ranked ?? (unqualifiedStats ? { ...unqualifiedStats, rank: null } : emptyEntry);
  const entryWithEligibility = ranked || unqualifiedStats ? entry : (await attachFvbEligibility([entry]))[0];
  const entryMinimumOkbWei = await fvbEntryMinOkbWei();
  const tradeEntryMinimumOkbWei = await fvbTradeEntryMinOkbWei();
  const tradePrizeMinimumOkbWei = await fvbTradePrizeMinOkbWei();
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
    tradeEligibility: {
      tokenAddress: FANVIBE_TOKEN_ADDRESS,
      entryMinimumUsd: FVB_TRADE_ENTRY_MIN_USD,
      entryMinimumOkbWei: tradeEntryMinimumOkbWei.toString(),
      prizeMinimumUsd: FVB_TRADE_PRIZE_MIN_USD,
      prizeMinimumOkbWei: tradePrizeMinimumOkbWei.toString(),
      fanvibeAction: 'Distribution Cup ranking requires connected X plus $250+ verified FVB trading volume.',
      prizeReview: 'Prize-qualified wallets require clean verified FVB trading activity, connected X, and review before payout.',
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

app.get('/matchday-cup/fvb-traders', async (req, res) => {
  const parsed = z.coerce.number().int().min(1).max(50).default(20).safeParse(req.query.limit);
  if (!parsed.success) return res.status(400).json({ error: 'invalid limit' });
  const entries = await fvbTraderLeaderboard(parsed.data);
  const tradeEntryMinimumOkbWei = await fvbTradeEntryMinOkbWei();
  const tradePrizeMinimumOkbWei = await fvbTradePrizeMinOkbWei();
  res.json({
    entries,
    tradeEligibility: {
      tokenAddress: FANVIBE_TOKEN_ADDRESS,
      entryMinimumUsd: FVB_TRADE_ENTRY_MIN_USD,
      entryMinimumOkbWei: tradeEntryMinimumOkbWei.toString(),
      prizeMinimumUsd: FVB_TRADE_PRIZE_MIN_USD,
      prizeMinimumOkbWei: tradePrizeMinimumOkbWei.toString(),
      fanvibeAction: 'Trade board tracks verified FVB volume. Distribution Cup rewards require connected X plus $250+ verified FVB trading volume.',
    },
    source: 'indexed_fvb_trade_wallets',
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

function requireAdmin(req: Request, res: Response): boolean {
  if (!ADMIN_API_TOKEN) {
    res.status(503).json({ error: 'admin api is not configured' });
    return false;
  }
  const token = req.header('x-admin-token') ?? req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (token !== ADMIN_API_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

app.get('/x-profile/:address', (req, res) => {
  const parsed = addressSchema.safeParse(req.params.address);
  if (!parsed.success) return res.status(400).json({ error: 'invalid address' });
  res.json({ profile: xProfilePublic(xProfileFor(parsed.data)), configured: xAuthConfigured() });
});

app.get('/auth/x/start', async (req, res) => {
  if (!xAuthConfigured()) return res.status(503).json({ error: 'x auth is not configured' });
  const parsed = z.object({
    address: addressSchema,
    returnTo: z.string().url().optional(),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid x auth request' });

  pruneXAuthStates();
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
  appData.xAuthStates ??= {};
  appData.xAuthStates[state] = {
    address: parsed.data.address,
    codeVerifier,
    createdAt: Date.now(),
    returnTo: safeXReturnTo(parsed.data.returnTo),
  };
  await persistAppData();

  const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', X_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', X_CALLBACK_URL);
  authUrl.searchParams.set('scope', 'tweet.read users.read offline.access');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  res.redirect(authUrl.toString());
});

app.get('/auth/x/callback', async (req, res) => {
  if (!xAuthConfigured()) return res.redirect(xFrontendRedirect({ x: 'not_configured' }));
  const parsed = z.object({
    code: z.string().min(1),
    state: z.string().min(16),
  }).safeParse(req.query);
  if (!parsed.success) return res.redirect(xFrontendRedirect({ x: 'invalid_callback' }));

  pruneXAuthStates();
  const pending = appData.xAuthStates?.[parsed.data.state];
  if (!pending || Date.now() - pending.createdAt > X_AUTH_STATE_TTL_MS) {
    return res.redirect(xFrontendRedirect({ x: 'expired' }));
  }
  delete appData.xAuthStates?.[parsed.data.state];

  try {
    const token = await exchangeXToken(new URLSearchParams({
      grant_type: 'authorization_code',
      code: parsed.data.code,
      redirect_uri: X_CALLBACK_URL,
      code_verifier: pending.codeVerifier,
    }));
    const meRes = await fetch('https://api.twitter.com/2/users/me?user.fields=username', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const meJson = await meRes.json().catch(() => ({})) as { data?: { id?: string; username?: string }; detail?: string; title?: string };
    if (!meRes.ok || !meJson.data?.id || !meJson.data?.username) {
      throw new Error(meJson.detail ?? meJson.title ?? `X users/me HTTP ${meRes.status}`);
    }

    const key = pending.address.toLowerCase();
    const now = Date.now();
    appData.xProfiles ??= {};
    appData.xProfiles[key] = {
      address: pending.address,
      xUserId: meJson.data.id,
      handle: meJson.data.username.replace(/^@/, ''),
      connectedAt: appData.xProfiles[key]?.connectedAt ?? now,
      updatedAt: now,
      accessTokenCipher: encryptToken(token.access_token!),
      refreshTokenCipher: token.refresh_token ? encryptToken(token.refresh_token) : appData.xProfiles[key]?.refreshTokenCipher,
      tokenType: token.token_type ?? 'bearer',
      scope: token.scope,
      expiresAt: token.expires_in ? now + token.expires_in * 1000 : undefined,
      lastSyncedAt: appData.xProfiles[key]?.lastSyncedAt,
    };
    await persistAppData();
    syncXProfileStats(appData.xProfiles[key]).catch(err => {
      console.warn(`[FanVibe] Initial X sync failed for ${pending.address}: ${err instanceof Error ? err.message : String(err)}`);
    });
    res.redirect(pending.returnTo ?? xFrontendRedirect({ x: 'connected', address: pending.address }));
  } catch (err) {
    console.warn(`[FanVibe] X callback failed: ${err instanceof Error ? err.message : String(err)}`);
    await persistAppData();
    res.redirect(pending.returnTo ?? xFrontendRedirect({ x: 'failed' }));
  }
});

app.post('/auth/x/disconnect', async (req, res) => {
  const parsed = z.object({ address: addressSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid address' });
  delete appData.xProfiles?.[parsed.data.address.toLowerCase()];
  await persistAppData();
  res.json({ ok: true });
});

app.post('/admin/x-profile', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const schema = z.object({
    address: addressSchema,
    xUserId: z.string().min(1).max(128),
    handle: z.string().min(1).max(64).transform(value => value.replace(/^@/, '')),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const key = parsed.data.address.toLowerCase();
  const now = Date.now();
  appData.xProfiles ??= {};
  appData.xProfiles[key] = {
    ...appData.xProfiles[key],
    address: parsed.data.address,
    xUserId: parsed.data.xUserId,
    handle: parsed.data.handle,
    connectedAt: appData.xProfiles[key]?.connectedAt ?? now,
    updatedAt: now,
  };
  await persistAppData();
  res.json({ ok: true, profile: xProfilePublic(appData.xProfiles[key]) });
});

app.post('/admin/x-daily-stats', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const schema = z.object({
    address: addressSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(fvbTradeDay(Date.now())),
    impressions: z.coerce.number().int().min(0),
    engagements: z.coerce.number().int().min(0).default(0),
    tweets: z.coerce.number().int().min(0).default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const profile = xProfileFor(parsed.data.address);
  if (!profile) return res.status(400).json({ error: 'x profile is not connected' });
  const key = `${parsed.data.address.toLowerCase()}:${parsed.data.date}`;
  appData.xDailyStats ??= {};
  appData.xDailyStats[key] = {
    address: parsed.data.address,
    xUserId: profile.xUserId,
    handle: profile.handle,
    date: parsed.data.date,
    impressions: parsed.data.impressions,
    engagements: parsed.data.engagements,
    tweets: parsed.data.tweets,
    updatedAt: Date.now(),
  };
  await persistAppData();
  res.json({ ok: true, stats: appData.xDailyStats[key] });
});

app.post('/admin/x-sync/run', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!xAuthConfigured()) return res.status(503).json({ error: 'x auth is not configured' });
  const parsed = z.object({
    address: addressSchema.optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(fvbTradeDay(Date.now())),
  }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.address) {
    const profile = xProfileFor(parsed.data.address);
    if (!profile) return res.status(404).json({ error: 'x profile is not connected' });
    const stats = await syncXProfileStats(profile, parsed.data.date);
    return res.json({ ok: true, synced: 1, stats });
  }

  if (xSyncRunning) return res.status(409).json({ error: 'x sync already running' });
  const profiles = Object.values(appData.xProfiles ?? {}).filter(profile => profile.refreshTokenCipher || profile.accessTokenCipher);
  let synced = 0;
  const failures: Array<{ address: string; error: string }> = [];
  xSyncRunning = true;
  try {
    for (const profile of profiles) {
      try {
        await syncXProfileStats(profile, parsed.data.date);
        synced += 1;
      } catch (err) {
        failures.push({ address: profile.address, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    xSyncRunning = false;
  }
  res.json({ ok: true, synced, failures });
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
  res.json(feed);
  void (async () => {
    for (const matchState of Object.values(feed.matchStates)) {
      if (matchState.status !== 'finished') continue;
      const result = await engine.settleSyncedFixture(matchState.fixtureId, outcomeFromMatchState(matchState));
      if (result) broadcast('settlement', result);
    }
  })().catch(err => {
    console.warn(`[FanVibe] Async World Cup settlement failed: ${err instanceof Error ? err.message : String(err)}`);
  });
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

httpServer.listen(PORT, async () => {
  console.log(`[FanVibe] HTTP server on port ${PORT}`);
  console.log(`[FanVibe] WebSocket on ws://localhost:${PORT}`);

  try {
    appData = await readAppData();
    ensureFvbTradeIndex();
    await engine.start();
    await retryPendingStakeReports();
    const tradeIndex = ensureFvbTradeIndex();
    const repairFvbTrades = await fvbTradeIndexNeedsRepair();
    if ((FVB_TRADE_AUTO_BACKFILL_ON_BOOT && tradeIndex.backfill?.status !== 'complete') || repairFvbTrades) {
      rebuildFvbTradeIndex().catch(err => {
        console.error(`[FanVibe] FVB trade auto-backfill failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    } else {
      await scanFvbTradeVolume();
    }
    await scanFvbHolderCandidates();
    await syncConnectedXProfiles();
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
    setInterval(() => {
      syncConnectedXProfiles().catch(err => {
        console.error(`[FanVibe] X sync failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, X_SYNC_INTERVAL_MS);
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
