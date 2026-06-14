import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, ExternalLink, Pencil, RefreshCw, Send, Wallet } from 'lucide-react';
import { useCreateWallet, usePrivy, useWallets } from '@privy-io/react-auth';
import { encodeFunctionData, formatEther, formatUnits, isAddress, parseEther } from 'viem';
import type { Fixture, MatchState, UserPosition } from '../types';
import { explorerTx, xLayerMainnet } from '../lib/chain';
import { FANVIBE_TOKEN_ADDRESS } from '../lib/fanvibeToken';
import { baseFixtureId, seasonFixtureStartAtMs } from '../lib/seasonTournament';
import { FAN_PROFILE_EVENT, fanDisplayName, getStoredProfileName, setStoredProfileName, shortWallet } from '../lib/fanProfile';
import { lowBalanceMessage, walletErrorMessage } from '../lib/walletErrors';
import { formatOkbUsdFromWei, formatStakeUsd, useOkbUsdPrice } from '../lib/useOkbUsdPrice';
import { xLayerPublicClient } from '../lib/publicClient';
import { GrowthPanel } from './GrowthPanel';
import { claimReferral, fetchProfileName, saveProfileName } from '../lib/accountData';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const PRIVY_ENABLED = Boolean(import.meta.env.VITE_PRIVY_APP_ID);
const LAST_WALLET_KEY = 'fanvibe.lastWalletAddress';
const BALANCE_CACHE_PREFIX = 'fanvibe.okbBalance.';
const POSITION_BATCH_SIZE = 10;
const FVB_EULR_HOOK_ADDRESS = '0xA21240dADA683d2563034C4F43D080b488b07dDD';
const FVB_EULR_ROUTER_ADDRESS = '0xAcc0354D3F7a92aDF00B9364b91A59Ed7b48b01A';
const FVB_ELIGIBILITY_CAP_WEI = 450_000n * 10n ** 18n;
const BUY_SLIPPAGE_BPS = 100n;
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
const EULR_HOOK_ABI = [
  {
    type: 'function',
    name: 'quoteBuy',
    stateMutability: 'view',
    inputs: [{ name: 'okbIn', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'grossOkbIn', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'effectiveOkbIn', type: 'uint256' },
          { name: 'oldOkbCum', type: 'uint256' },
          { name: 'newOkbCum', type: 'uint256' },
          { name: 'oldMinted', type: 'uint256' },
          { name: 'newMinted', type: 'uint256' },
          { name: 'tokensOut', type: 'uint256' },
          { name: 'burnTaxBps', type: 'uint16' },
          { name: 'grossTokensOut', type: 'uint256' },
          { name: 'burnTaxTokens', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'quoteSell',
    stateMutability: 'view',
    inputs: [{ name: 'tokensIn', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'tokensIn', type: 'uint256' },
          { name: 'grossOkbOut', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'netOkbOut', type: 'uint256' },
          { name: 'oldOkbCum', type: 'uint256' },
          { name: 'newOkbCum', type: 'uint256' },
          { name: 'oldMinted', type: 'uint256' },
          { name: 'newMinted', type: 'uint256' },
          { name: 'burnTaxBps', type: 'uint16' },
          { name: 'burnTaxTokens', type: 'uint256' },
          { name: 'effectiveTokensIn', type: 'uint256' },
        ],
      },
    ],
  },
] as const;
const EULR_ROUTER_ABI = [
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'payable',
    inputs: [
      { name: 'token_', type: 'address' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: 'tokensOut', type: 'uint256' }],
  },
] as const;

function isPrivyWallet(wallet: { walletClientType?: string | null }): boolean {
  return wallet.walletClientType === 'privy' || wallet.walletClientType === 'privy-v2';
}

function formatOKB(wei: string): string {
  try {
    const whole = BigInt(wei);
    const value = Number(whole) / 1e18;
    return `${value.toFixed(value >= 1 ? 3 : 4)} OKB`;
  } catch {
    return '0 OKB';
  }
}

function formatTime(ts?: number | string): string {
  if (!ts) return '-';
  const normalized = typeof ts === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts)
    ? `${ts.replace(' ', 'T')}Z`
    : ts;
  const ms = typeof normalized === 'number'
    ? (normalized > 10_000_000_000 ? normalized : normalized * 1000)
    : Date.parse(normalized);
  if (!Number.isFinite(ms)) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function stripUsdPrefix(value: string | null): string | null {
  return value?.replace(/^US/, '') ?? null;
}

function friendlyFixtureId(fixtureId: string): string {
  const normalized = baseFixtureId(fixtureId).replace(/^season-/, '');
  const seasonGroup = normalized.match(/^wc-([a-l])-/i)?.[1];
  if (seasonGroup) return `World Cup Group ${seasonGroup.toUpperCase()} match`;
  return 'Updating match';
}

function positionFixture(position: UserPosition, fixtures: Fixture[]): Fixture | undefined {
  if (position.type === 'match') {
    return fixtures.find(fixture => fixture.id === position.stake.fixtureId)
      ?? position.fixture
      ?? position.stake.fixture
      ?? position.settlement?.fixture;
  }
  if (position.type === 'refund') {
    return fixtures.find(fixture => fixture.id === position.refund.fixtureId)
      ?? position.refund.fixture;
  }
  return undefined;
}

function seasonBadge(position: UserPosition): string | null {
  if (position.type === 'champion') return 'WC 2026';
  const fixtureId = position.type === 'match'
    ? position.stake.fixtureId
    : position.type === 'refund'
      ? position.refund.fixtureId
      : '';
  const match = fixtureId.match(/^s(\d+)-/i);
  const parsedSeason = match ? Number(match[1]) : undefined;
  return parsedSeason && Number.isFinite(parsedSeason)
    ? `S${String(parsedSeason).padStart(2, '0')}`
    : null;
}

function refundReasonLabel(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes('not open') || lower.includes('already live') || lower.includes('already settled')) {
    return 'Market closed before confirmation';
  }
  if (lower.includes('not resolved')) return 'Match not ready for staking';
  return 'Stake returned automatically';
}

function positionUpdatedAt(position: UserPosition): number {
  if (position.type === 'refund') return position.refund.timestamp;
  if (position.type === 'champion') return position.settledAt ?? position.stake.timestamp;
  return position.settlement?.settledAt ?? position.stake.timestamp;
}

function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function statusTone(status: string): string {
  if (['paid', 'refunded', 'settled_winner'].includes(status)) return 'text-emerald-600 dark:text-emerald-300 bg-emerald-500/10';
  if (['lost', 'settled_lost', 'failed'].includes(status)) return 'text-rose-600 dark:text-rose-300 bg-rose-500/10';
  if (status.includes('pending') || status === 'queued') return 'text-blue-600 dark:text-blue-300 bg-blue-500/10';
  return 'text-zinc-600 dark:text-zinc-300 bg-zinc-500/10';
}

function matchStateOutcome(state?: MatchState): 'home' | 'draw' | 'away' | undefined {
  if (!state || state.status !== 'finished') return undefined;
  if (state.penaltyWinner) return state.penaltyWinner;
  if (state.homeScore > state.awayScore) return 'home';
  if (state.awayScore > state.homeScore) return 'away';
  return 'draw';
}

function effectiveMatchStatus(position: UserPosition, liveFixture?: Fixture, liveState?: MatchState): UserPosition['status'] | 'active' {
  if (position.type !== 'match') return position.status;
  if (['paid', 'lost', 'won_pending_payout'].includes(position.status)) return position.status;
  const stakeMs = position.stake.timestamp > 10_000_000_000 ? position.stake.timestamp : position.stake.timestamp * 1000;
  const settlementAppliesToStake = !!position.settlement && position.settlement.settledAt >= stakeMs;
  if (settlementAppliesToStake) return position.status;
  const finishedOutcome = matchStateOutcome(liveState);
  if (finishedOutcome) return finishedOutcome === position.stake.outcome ? 'won_pending_payout' : 'lost';
  const currentFixtureIsLive = liveState?.status === 'live' || liveState?.status === 'half_time';
  const currentFixtureIsSettled = liveFixture?.status === 'settled' && !!liveFixture.result;
  const currentFixtureUnsettled = liveFixture?.status && liveFixture.status !== 'settled';
  if (currentFixtureIsLive || currentFixtureUnsettled) return 'active';
  if (currentFixtureIsSettled) {
    if (position.status === 'paid') return position.status;
    return liveFixture.result === position.stake.outcome ? 'won_pending_payout' : 'lost';
  }
  return position.status;
}

function statusLabel(position: UserPosition, effectiveStatus = position.status): string {
  if (position.type === 'refund') {
    if (effectiveStatus === 'refunded') return 'Refund sent';
    if (effectiveStatus === 'failed') return 'Refund failed';
    return 'Refund queued';
  }
  if (position.type === 'champion') {
    if (effectiveStatus === 'settled_winner') return position.payout ? 'Payout sent' : 'Won - payout pending';
    if (effectiveStatus === 'settled_lost') return 'Lost';
    return 'Active';
  }
  if (effectiveStatus === 'paid') return 'Payout sent';
  if (effectiveStatus === 'won_pending_payout') return 'Won - payout pending';
  if (effectiveStatus === 'lost') return 'Lost';
  return 'Active';
}

function pickLabel(position: UserPosition): string {
  if (position.type === 'refund') return position.refund.outcome.toUpperCase();
  if (position.type === 'champion') return 'Outright';
  return position.stake.outcome.toUpperCase();
}

function selectedOutcomeLabel(position: UserPosition, fixture?: Fixture): string {
  if (position.type === 'champion') return `${position.stake.teamCode} champion`;
  const outcome = position.type === 'refund' ? position.refund.outcome : position.stake.outcome;
  if (outcome === 'draw') return 'Draw';
  if (fixture && outcome === 'home') return fixture.home.name || fixture.home.code;
  if (fixture && outcome === 'away') return fixture.away.name || fixture.away.code;
  return outcome.toUpperCase();
}

function statusHint(position: UserPosition, effectiveStatus: string): string {
  if (position.type === 'refund') {
    if (effectiveStatus === 'refunded') return 'Returned to wallet';
    if (effectiveStatus === 'failed') return 'Refund needs review';
    return 'Refund queued automatically';
  }
  if (position.type === 'champion') {
    if (effectiveStatus === 'settled_winner') return position.payout ? 'Outright paid' : 'Outright payout queued';
    if (effectiveStatus === 'settled_lost') return 'Outright settled';
    return 'Outright market open';
  }
  if (effectiveStatus === 'paid') return 'Payout sent to wallet';
  if (effectiveStatus === 'won_pending_payout') return 'Automatic payout queued';
  if (effectiveStatus === 'lost') return 'Market settled';
  return 'Staking position open';
}

function pickTone(pick: string): string {
  if (pick === 'HOME') return 'bg-blue-500/10 text-blue-600 dark:text-blue-300';
  if (pick === 'AWAY') return 'bg-blue-500/10 text-blue-600 dark:text-blue-300';
  if (pick === 'DRAW') return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300';
  return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300';
}

function positionsSyncMessage(): string {
  return 'Positions are syncing. Try again in a moment.';
}

function rememberWallet(address: string | null): void {
  if (address) {
    localStorage.setItem(LAST_WALLET_KEY, address);
  } else {
    localStorage.removeItem(LAST_WALLET_KEY);
  }
}

function getRememberedWallet(): string | null {
  return localStorage.getItem(LAST_WALLET_KEY);
}

function cachedBalanceKey(address: string): string {
  return `${BALANCE_CACHE_PREFIX}${address.toLowerCase()}`;
}

function getCachedBalance(address: string): bigint | null {
  try {
    const value = localStorage.getItem(cachedBalanceKey(address));
    return value ? BigInt(value) : null;
  } catch {
    return null;
  }
}

function setCachedBalance(address: string, balanceWei: bigint): void {
  localStorage.setItem(cachedBalanceKey(address), balanceWei.toString());
}

function formatBalance(balanceWei: bigint | null): string {
  if (balanceWei === null) return '-';
  const value = Number(formatEther(balanceWei));
  if (!Number.isFinite(value)) return '0.0000';
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function formatFvbBalance(balanceWei: bigint | null): string {
  if (balanceWei === null) return '-';
  const value = Number(formatUnits(balanceWei, 18));
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}K`;
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value > 0 ? '< 1' : '0';
}

function minWithSlippage(value: bigint): bigint {
  return value - ((value * BUY_SLIPPAGE_BPS) / 10_000n);
}

function usdFromWei(valueWei: bigint | null, okbUsd: number | null): string | null {
  if (valueWei === null || !okbUsd) return null;
  const value = Number(formatEther(valueWei)) * okbUsd;
  if (!Number.isFinite(value)) return null;
  return `US$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

interface Props {
  fixtures?: Fixture[];
  matchStates?: Record<string, MatchState>;
  seasonStartedAt?: number;
  onWatch?: (fixtureId: string) => void;
}

function PrivyPositionsConnect({
  address,
  onAddress,
  onError,
}: {
  address: string | null;
  onAddress: (address: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { wallets, ready: walletsReady } = useWallets();
  const preferredWallet = wallets.find(isPrivyWallet) ?? wallets[0];
  const activeWallet = (address
    ? wallets.find(wallet => wallet.address.toLowerCase() === address.toLowerCase())
    : undefined) ?? preferredWallet;
  const creatingWalletRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setupRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [profileName, setProfileName] = useState(() => getStoredProfileName(address));
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileInput, setProfileInput] = useState('');

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    if (setupRetryRef.current) clearTimeout(setupRetryRef.current);
  }, []);

  useEffect(() => {
    const syncProfile = () => setProfileName(getStoredProfileName(address));
    syncProfile();
    window.addEventListener(FAN_PROFILE_EVENT, syncProfile);
    window.addEventListener('storage', syncProfile);
    return () => {
      window.removeEventListener(FAN_PROFILE_EVENT, syncProfile);
      window.removeEventListener('storage', syncProfile);
    };
  }, [address]);

  useEffect(() => {
    if (!address) return;
    claimReferral(address);
    fetchProfileName(address)
      .then(name => {
        if (!name) return;
        setStoredProfileName(name, address);
        setProfileName(name);
      })
      .catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!walletsReady || wallets.length === 0) return;
    const currentStillConnected = address
      ? wallets.some(wallet => wallet.address.toLowerCase() === address.toLowerCase())
      : false;

    if (currentStillConnected) {
      onError(null);
      return;
    }

    const nextWallet = wallets.find(isPrivyWallet) ?? wallets[0];
    if (nextWallet?.address) {
      onAddress(nextWallet.address);
      rememberWallet(nextWallet.address);
      onError(null);
    }
  }, [address, onAddress, onError, wallets, walletsReady]);

  useEffect(() => {
    if (!ready || !walletsReady || !authenticated || activeWallet || creatingWalletRef.current) return;
    creatingWalletRef.current = true;
    createWallet()
      .then(wallet => {
        onAddress(wallet.address);
        rememberWallet(wallet.address);
        onError(null);
      })
      .catch((err: unknown) => {
        const message = walletErrorMessage(err, 'Unable to set up account. Try again in a moment.');
        const lower = message.toLowerCase();
        if (lower.includes('unable to set up account') || lower.includes('already')) {
          onError(null);
          if (setupRetryRef.current) clearTimeout(setupRetryRef.current);
          setupRetryRef.current = setTimeout(() => setSetupAttempt(attempt => attempt + 1), 2500);
        } else {
          onError(message);
        }
      })
      .finally(() => {
        creatingWalletRef.current = false;
      });
  }, [activeWallet, authenticated, createWallet, onAddress, onError, ready, setupAttempt, walletsReady]);

  const copyAddress = useCallback(() => {
    navigator.clipboard.writeText(address ?? '').then(() => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  }, [address]);

  const openProfileEditor = useCallback(() => {
    setProfileInput(profileName || address || '');
    setEditingProfile(true);
  }, [address, profileName]);

  const saveProfile = useCallback(() => {
    const nextName = profileInput.trim() === address ? '' : profileInput;
    setStoredProfileName(nextName, address);
    setProfileName(getStoredProfileName(address));
    setEditingProfile(false);
    if (address) {
      saveProfileName(address, nextName).catch(() => {});
    }
  }, [address, profileInput]);

  const profilePrompt = profileName ? fanDisplayName(address, profileName) : 'Set username';

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <div className="relative inline-flex items-center gap-1.5 rounded-md border dark:border-zinc-800 border-zinc-200 bg-white px-2.5 py-2 text-xs font-semibold dark:bg-zinc-950 dark:text-zinc-200 text-zinc-800">
          {editingProfile ? (
            <input
              autoFocus
              value={profileInput}
              onChange={event => setProfileInput(event.target.value.slice(0, 24))}
              onKeyDown={event => {
                if (event.key === 'Enter') saveProfile();
                if (event.key === 'Escape') setEditingProfile(false);
              }}
              onBlur={saveProfile}
              className="w-28 bg-transparent text-xs font-semibold outline-none"
              aria-label="Profile name"
            />
          ) : (
            <button
              type="button"
              onClick={openProfileEditor}
              className="profile-identity-rotate text-left"
              title={profileName ? profileName : 'Set username'}
            >
              <span>{shortWallet(address)}</span>
              <span>{profilePrompt}</span>
            </button>
          )}
          <button
            type="button"
            onClick={copyAddress}
            className="grid h-5 w-5 place-items-center rounded border border-transparent text-zinc-400 transition-colors hover:border-blue-500/30 hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-300"
            aria-label="Copy wallet address"
            title="Copy wallet address"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            onClick={openProfileEditor}
            className="grid h-5 w-5 place-items-center rounded border border-transparent text-zinc-400 transition-colors hover:border-zinc-900/10 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:border-white/10 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Edit profile name"
            title="Edit profile name"
          >
            <Pencil size={11} />
          </button>
          {copied && (
            <span className="absolute -right-1 top-9 rounded-md border border-zinc-900 bg-zinc-950 px-2 py-1 text-[10px] font-semibold text-white shadow-sm dark:border-zinc-100 dark:bg-white dark:text-zinc-950">
              Copied
            </span>
          )}
        </div>
        <button
          onClick={() => {
            activeWallet?.disconnect();
            logout();
            onAddress(null);
            rememberWallet(null);
          }}
          className="inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2.5 py-2 text-xs font-bold dark:text-zinc-500 text-zinc-500 transition-colors hover:border-rose-500 hover:text-rose-600"
          title="Sign out"
        >
          <ArrowRight size={13} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        if (!authenticated || !activeWallet) login({ loginMethods: ['email', 'wallet'] });
      }}
      disabled={!ready}
      className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-all active:scale-95 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Wallet size={13} />
      {authenticated ? 'Setting up account...' : 'Sign in'}
    </button>
  );
}

function PrivyWalletPanel({ address, okbUsd, onError }: { address: string; okbUsd: number | null; onError: (message: string | null) => void }) {
  const { wallets } = useWallets();
  const [mode, setMode] = useState<'balance' | 'withdraw' | 'buy'>('balance');
  const [balanceWei, setBalanceWei] = useState<bigint | null>(() => getCachedBalance(address));
  const [fvbBalanceWei, setFvbBalanceWei] = useState<bigint | null>(null);
  const [fvbValueWei, setFvbValueWei] = useState<bigint | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [buyAmount, setBuyAmount] = useState('0.12');
  const [buyQuoteWei, setBuyQuoteWei] = useState<bigint | null>(null);
  const [buyQuoteLoading, setBuyQuoteLoading] = useState(false);
  const [buyMessage, setBuyMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [buyPending, setBuyPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [buyTxHash, setBuyTxHash] = useState<`0x${string}` | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wallet = wallets.find(item => item.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
  const balanceUsd = formatOkbUsdFromWei(balanceWei, okbUsd);
  const transferUsd = formatStakeUsd(amount, okbUsd);
  const fvbUsd = usdFromWei(fvbValueWei, okbUsd);
  const totalWei = balanceWei !== null && fvbValueWei !== null ? balanceWei + fvbValueWei : null;
  const totalUsd = usdFromWei(totalWei, okbUsd);
  const remainingEligibilityWei = fvbBalanceWei === null
    ? null
    : fvbBalanceWei >= FVB_ELIGIBILITY_CAP_WEI
      ? 0n
      : FVB_ELIGIBILITY_CAP_WEI - fvbBalanceWei;
  const buyAmountWei = useMemo(() => {
    try {
      return parseEther(buyAmount || '0');
    } catch {
      return 0n;
    }
  }, [buyAmount]);
  const buyAmountUsd = usdFromWei(buyAmountWei > 0n ? buyAmountWei : null, okbUsd);
  const minBuyWei = okbUsd ? parseEther((10 / okbUsd).toFixed(8)) : 0n;
  const belowMinimum = buyAmountWei > 0n && minBuyWei > 0n && buyAmountWei < minBuyWei;
  const aboveEligibilityMax = remainingEligibilityWei !== null && buyQuoteWei !== null && buyQuoteWei > remainingEligibilityWei;
  const canBuyFvb = buyAmountWei > 0n
    && !!buyQuoteWei
    && !belowMinimum
    && !aboveEligibilityMax
    && remainingEligibilityWei !== null
    && remainingEligibilityWei !== 0n;

  const refreshBalance = useCallback(async (showError = false) => {
    try {
      const nextBalance = await xLayerPublicClient.getBalance({ address: address as `0x${string}` });
      setBalanceWei(nextBalance);
      setCachedBalance(address, nextBalance);
      if (showError) onError(null);
    } catch (err) {
      if (showError) onError(walletErrorMessage(err, 'Balance is syncing. Try again in a moment.'));
    }
  }, [address, onError]);

  const refreshFvbBalance = useCallback(async () => {
    try {
      const nextBalance = await xLayerPublicClient.readContract({
        address: FANVIBE_TOKEN_ADDRESS as `0x${string}`,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      });
      setFvbBalanceWei(nextBalance);
      if (nextBalance > 0n) {
        const quote = await xLayerPublicClient.readContract({
          address: FVB_EULR_HOOK_ADDRESS as `0x${string}`,
          abi: EULR_HOOK_ABI,
          functionName: 'quoteSell',
          args: [nextBalance],
        });
        setFvbValueWei(quote.netOkbOut);
      } else {
        setFvbValueWei(0n);
      }
    } catch {
      setFvbBalanceWei(null);
      setFvbValueWei(null);
    }
  }, [address]);

  useEffect(() => {
    refreshBalance();
    refreshFvbBalance();
    const timer = setInterval(refreshBalance, 3_000);
    const fvbTimer = setInterval(refreshFvbBalance, 8_000);
    return () => {
      clearInterval(timer);
      clearInterval(fvbTimer);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [refreshBalance, refreshFvbBalance]);

  const manualRefreshBalance = useCallback(() => {
    setRefreshing(true);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => setRefreshing(false), 2_000);
    refreshBalance(true);
    refreshFvbBalance();
  }, [refreshBalance, refreshFvbBalance]);

  useEffect(() => {
    setBalanceWei(getCachedBalance(address));
    setFvbBalanceWei(null);
    setFvbValueWei(null);
  }, [address]);

  useEffect(() => {
    if (mode !== 'buy' || buyAmountWei <= 0n) {
      setBuyQuoteWei(null);
      setBuyQuoteLoading(false);
      return;
    }
    let cancelled = false;
    setBuyQuoteLoading(true);
    xLayerPublicClient.readContract({
      address: FVB_EULR_HOOK_ADDRESS as `0x${string}`,
      abi: EULR_HOOK_ABI,
      functionName: 'quoteBuy',
      args: [buyAmountWei],
    })
      .then(quote => {
        if (cancelled) return;
        setBuyQuoteWei(quote.tokensOut);
        setBuyQuoteLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setBuyQuoteWei(null);
        setBuyQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buyAmountWei, mode]);

  const withdraw = useCallback(async () => {
    if (!wallet || pending) return;
    setPending(true);
    setTxHash(null);
    onError(null);
    try {
      const to = recipient.trim();
      if (!isAddress(to)) throw new Error('Enter a valid wallet address.');
      const amountWei = parseEther(amount || '0');
      if (amountWei <= 0n) throw new Error('Enter an amount to withdraw.');

      const balance = await xLayerPublicClient.getBalance({ address: address as `0x${string}` });
      if (balance < amountWei) throw new Error(lowBalanceMessage(amountWei, balance));

      await wallet.switchChain(xLayerMainnet.id);
      const provider = await wallet.getEthereumProvider();
      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to,
          value: `0x${amountWei.toString(16)}`,
          chainId: `0x${xLayerMainnet.id.toString(16)}`,
        }],
      }) as `0x${string}`;

      setAmount('');
      setRecipient('');
      setTxHash(hash);
      await refreshBalance();
    } catch (err) {
      onError(walletErrorMessage(err, 'Withdrawal failed.'));
    } finally {
      setPending(false);
    }
  }, [address, amount, onError, pending, recipient, refreshBalance, wallet]);

  const buyFvb = useCallback(async () => {
    if (!wallet || buyPending) return;
    setBuyPending(true);
    setBuyTxHash(null);
    setBuyMessage('');
    onError(null);
    try {
      if (buyAmountWei <= 0n) throw new Error('Enter an OKB amount.');
      if (belowMinimum) throw new Error('Minimum buy is $10 worth of OKB.');
      if (!buyQuoteWei || buyQuoteWei <= 0n) throw new Error('Quote is still loading. Try again.');
      if (remainingEligibilityWei === null) throw new Error('FVB balance is syncing. Try again in a moment.');
      if (remainingEligibilityWei === 0n) throw new Error('This wallet already meets the 450K FVB reward-pool eligibility cap.');
      if (aboveEligibilityMax) throw new Error(`Max buy for eligibility is ${formatFvbBalance(remainingEligibilityWei)} FVB.`);

      const balance = await xLayerPublicClient.getBalance({ address: address as `0x${string}` });
      if (balance < buyAmountWei) throw new Error(lowBalanceMessage(buyAmountWei, balance));

      const data = encodeFunctionData({
        abi: EULR_ROUTER_ABI,
        functionName: 'buy',
        args: [
          FANVIBE_TOKEN_ADDRESS as `0x${string}`,
          minWithSlippage(buyQuoteWei),
          address as `0x${string}`,
        ],
      });

      await wallet.switchChain(xLayerMainnet.id);
      const provider = await wallet.getEthereumProvider();
      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: FVB_EULR_ROUTER_ADDRESS,
          value: `0x${buyAmountWei.toString(16)}`,
          data,
          chainId: `0x${xLayerMainnet.id.toString(16)}`,
        }],
      }) as `0x${string}`;

      setBuyTxHash(hash);
      setBuyMessage('Buy successful. You are on the Matchday Cup leaderboard.');
      await refreshBalance();
      await refreshFvbBalance();
      setTimeout(() => {
        refreshBalance();
        refreshFvbBalance();
      }, 3000);
    } catch (err) {
      onError(walletErrorMessage(err, 'FVB buy failed.'));
    } finally {
      setBuyPending(false);
    }
  }, [
    aboveEligibilityMax,
    address,
    belowMinimum,
    buyAmountWei,
    buyPending,
    buyQuoteWei,
    onError,
    refreshBalance,
    refreshFvbBalance,
    remainingEligibilityWei,
    wallet,
  ]);

  return (
    <div className="mt-4 border-t dark:border-zinc-900 border-zinc-100 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Wallet Balance</div>
          <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-start gap-3">
            <div>
              <div className="text-xl font-semibold tabular-nums dark:text-zinc-50 text-zinc-950 sm:text-2xl">{formatBalance(balanceWei)}</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">OKB</div>
              {balanceUsd && (
                <div className="mt-0.5 text-[11px] font-medium tabular-nums dark:text-zinc-600 text-zinc-400">{balanceUsd}</div>
              )}
            </div>
            <div>
              <div className="text-xl font-semibold tabular-nums dark:text-zinc-50 text-zinc-950 sm:text-2xl">{formatFvbBalance(fvbBalanceWei)}</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">FVB</div>
              <div className="mt-0.5 text-[11px] font-medium tabular-nums dark:text-zinc-600 text-zinc-400">{fvbUsd ?? 'Eligibility token'}</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-semibold tabular-nums dark:text-zinc-50 text-zinc-950 sm:text-2xl">{totalUsd ?? 'Syncing'}</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">Total</div>
            </div>
          </div>
        </div>
        <div className="inline-flex self-start rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-900 sm:self-auto">
          <button
            type="button"
            onClick={() => setMode('balance')}
            className={`rounded px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${mode === 'balance' ? 'dark:bg-white dark:text-zinc-950 bg-zinc-950 text-white' : 'dark:text-zinc-500 text-zinc-500 hover:text-blue-500'}`}
          >
            Balance
          </button>
          <button
            type="button"
            onClick={() => setMode('withdraw')}
            className={`rounded px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${mode === 'withdraw' ? 'dark:bg-white dark:text-zinc-950 bg-zinc-950 text-white' : 'dark:text-zinc-500 text-zinc-500 hover:text-blue-500'}`}
          >
            Withdraw
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('buy');
              setBuyMessage('');
              setBuyTxHash(null);
            }}
            className={`rounded px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${mode === 'buy' ? 'dark:bg-white dark:text-zinc-950 bg-zinc-950 text-white' : 'dark:text-zinc-500 text-zinc-500 hover:text-blue-500'}`}
          >
            Buy FVB
          </button>
        </div>
      </div>

      {mode === 'balance' ? (
        <div className="mt-3 flex items-center justify-between border-t dark:border-zinc-900 border-zinc-100 pt-3">
          <span className="text-xs dark:text-zinc-500 text-zinc-500">Available for stakes and transfers</span>
          <button
            type="button"
            onClick={manualRefreshBalance}
            className="rounded p-1.5 dark:text-zinc-500 text-zinc-500 transition-colors hover:text-blue-500"
            title="Refresh balance"
            aria-label="Refresh balance"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      ) : mode === 'withdraw' ? (
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_120px_auto]">
          <input
            value={recipient}
            onChange={event => setRecipient(event.target.value)}
            placeholder="Recipient wallet"
            className="min-w-0 rounded-md border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950 bg-white px-3 py-2 text-sm dark:text-zinc-100 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400"
          />
          <div className="relative">
            <input
              value={amount}
              onChange={event => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0.00"
              inputMode="decimal"
              className="w-full rounded-md border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950 bg-white px-3 py-2 pr-11 text-sm tabular-nums dark:text-zinc-100 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-zinc-400">OKB</span>
          </div>
          {transferUsd && <div className="-mt-1 text-[10px] font-medium tabular-nums text-zinc-400 md:hidden">{transferUsd}</div>}
          <button
            type="button"
            onClick={withdraw}
            disabled={pending || !recipient.trim() || !amount.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={13} />
            {pending ? 'Confirming' : 'Send'}
          </button>
          {transferUsd && <div className="hidden text-[10px] font-medium tabular-nums text-zinc-400 md:block md:col-start-2">{transferUsd}</div>}
        </div>
      ) : (
        <div className="mt-3 border-t dark:border-zinc-900 border-zinc-100 pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold dark:text-zinc-200 text-zinc-800">Buy FVB</div>
              <div className="mt-0.5 text-[11px] dark:text-zinc-500 text-zinc-500">Minimum $10. Eligible room {remainingEligibilityWei === null ? 'syncing' : `${formatFvbBalance(remainingEligibilityWei)} FVB`}.</div>
            </div>
            <button
              type="button"
              onClick={manualRefreshBalance}
              className="rounded p-1.5 dark:text-zinc-500 text-zinc-500 transition-colors hover:text-blue-500"
              title="Refresh balance"
              aria-label="Refresh balance"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <div>
              <div className="relative">
                <input
                  id="portfolio-fvb-buy"
                  value={buyAmount}
                  onChange={event => {
                    setBuyAmount(event.target.value.replace(/[^\d.]/g, ''));
                    setBuyMessage('');
                    setBuyTxHash(null);
                  }}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="w-full rounded-md border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950 bg-white px-3 py-2 pr-11 text-sm tabular-nums dark:text-zinc-100 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-zinc-400">OKB</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {okbUsd ? [10, 25, 50].map(usd => {
                  const okbAmount = (usd / okbUsd).toFixed(4);
                  return (
                    <button
                      key={usd}
                      type="button"
                      onClick={() => {
                        setBuyAmount(okbAmount);
                        setBuyMessage('');
                        setBuyTxHash(null);
                      }}
                      className="rounded-md bg-zinc-100 px-2 py-1.5 text-xs font-semibold dark:bg-zinc-900 dark:text-zinc-400 text-zinc-500 transition-colors hover:text-blue-500"
                    >
                      ${usd}
                    </button>
                  );
                }) : ['0.12', '0.25', '0.5'].map(okbAmount => (
                  <button
                    key={okbAmount}
                    type="button"
                    onClick={() => setBuyAmount(okbAmount)}
                    className="rounded-md bg-zinc-100 px-2 py-1.5 text-xs font-semibold dark:bg-zinc-900 dark:text-zinc-400 text-zinc-500 transition-colors hover:text-blue-500"
                  >
                    {okbAmount} OKB
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={buyFvb}
              disabled={buyPending || buyQuoteLoading || !canBuyFvb}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40 md:min-w-[110px]"
            >
              <Wallet size={13} />
              {buyPending ? 'Confirming' : 'Buy'}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-medium tabular-nums dark:text-zinc-500 text-zinc-500">{buyAmountUsd ?? 'US$0.00'}</span>
            <span className="font-semibold tabular-nums dark:text-zinc-300 text-zinc-700">{buyQuoteLoading ? 'Quoting...' : `${formatFvbBalance(buyQuoteWei)} FVB est.`}</span>
          </div>

          <div className="mt-2 min-h-[18px] text-[11px] font-medium">
            {belowMinimum ? (
              <span className="text-amber-600 dark:text-amber-300">Minimum buy is $10 worth of OKB.</span>
            ) : remainingEligibilityWei === null ? (
              <span className="dark:text-zinc-500 text-zinc-500">Syncing FVB balance before buy limits are applied.</span>
            ) : aboveEligibilityMax ? (
              <span className="text-amber-600 dark:text-amber-300">This buy is above your remaining 450K FVB eligibility room.</span>
            ) : remainingEligibilityWei === 0n ? (
              <span className="text-emerald-600 dark:text-emerald-300">This wallet already meets the FVB eligibility cap.</span>
            ) : buyMessage ? (
              <span className="text-emerald-600 dark:text-emerald-300">{buyMessage}</span>
            ) : (
              <span className="dark:text-zinc-600 text-zinc-400">Buy with the same wallet you use for match stakes.</span>
            )}
          </div>
        </div>
      )}

      {txHash && (
        <a href={explorerTx(txHash)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-300">
          View withdrawal
          <ExternalLink size={11} />
        </a>
      )}

      {buyTxHash && (
        <a href={explorerTx(buyTxHash)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-300">
          View buy transaction
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

export function MyPositions({ fixtures = [], matchStates = {}, seasonStartedAt, onWatch }: Props) {
  const [address, setAddress] = useState<string | null>(() => getRememberedWallet());
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const positionsAddressRef = useRef<string | null>(null);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsLoaded, setPositionsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [visibleCount, setVisibleCount] = useState(POSITION_BATCH_SIZE);
  const [goalFlashIds, setGoalFlashIds] = useState<Set<string>>(() => new Set());
  const previousScoresRef = useRef<Record<string, number>>({});
  const goalFlashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const okbUsd = useOkbUsdPrice();

  const connect = useCallback(async () => {
    const provider = (window as typeof window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
    if (!provider) {
      setError('No wallet detected.');
      return;
    }
    const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
    setAddress(accounts[0] ?? null);
    rememberWallet(accounts[0] ?? null);
  }, []);

  const refresh = useCallback(async (showError = false) => {
    if (!address) return;
    if (showError) setError(null);
    setPositionsLoading(true);
    try {
      const res = await fetch(`${BACKEND_HTTP}/positions/${address}`);
      if (!res.ok) throw new Error('Positions unavailable');
      const data = await res.json() as { positions: UserPosition[] };
      const nextPositions = data.positions ?? [];
      setPositions(current => {
        const sameAddress = positionsAddressRef.current?.toLowerCase() === address.toLowerCase();
        positionsAddressRef.current = address;
        if (sameAddress && current.length > 0 && nextPositions.length === 0) return current;
        return nextPositions;
      });
      setPositionsLoaded(true);
      setError(null);
    } catch {
      if (showError) setError(positionsSyncMessage());
      setPositionsLoaded(true);
    } finally {
      setPositionsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    const provider = (window as typeof window & { ethereum?: { request: (args: { method: string }) => Promise<unknown> } }).ethereum;
    provider?.request({ method: 'eth_accounts' })
      .then((accounts: unknown) => {
        const list = accounts as string[];
        if (list?.[0]) {
          setAddress(list[0]);
          rememberWallet(list[0]);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 12_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    Object.values(goalFlashTimersRef.current).forEach(clearTimeout);
  }, []);

  useEffect(() => {
    setVisibleCount(POSITION_BATCH_SIZE);
    setPositionsLoaded(false);
    setPositionsLoading(Boolean(address));
    setPositions([]);
    positionsAddressRef.current = address;
  }, [address]);

  useEffect(() => {
    const stakedFixtureIds = new Set(
      positions
        .filter((position): position is Extract<UserPosition, { type: 'match' }> => position.type === 'match')
        .map(position => position.stake.fixtureId),
    );
    const nextScores: Record<string, number> = {};
    const flashed: string[] = [];

    Object.entries(matchStates).forEach(([fixtureId, state]) => {
      const total = state.homeScore + state.awayScore;
      nextScores[fixtureId] = total;
      const previous = previousScoresRef.current[fixtureId];
      if (
        previous !== undefined
        && total > previous
        && stakedFixtureIds.has(fixtureId)
        && (state.status === 'live' || state.status === 'half_time')
      ) {
        flashed.push(fixtureId);
      }
    });

    previousScoresRef.current = nextScores;
    if (flashed.length === 0) return;

    setGoalFlashIds(current => {
      const next = new Set(current);
      flashed.forEach(fixtureId => next.add(fixtureId));
      return next;
    });

    flashed.forEach(fixtureId => {
      if (goalFlashTimersRef.current[fixtureId]) clearTimeout(goalFlashTimersRef.current[fixtureId]);
      goalFlashTimersRef.current[fixtureId] = setTimeout(() => {
        setGoalFlashIds(current => {
          const next = new Set(current);
          next.delete(fixtureId);
          return next;
        });
        delete goalFlashTimersRef.current[fixtureId];
      }, 2400);
    });
  }, [matchStates, positions]);

  const summary = useMemo(() => {
    const active = positions.filter(position => {
      const liveFixture = positionFixture(position, fixtures);
      const liveState = liveFixture ? matchStates[liveFixture.id] : undefined;
      return statusLabel(position, effectiveMatchStatus(position, liveFixture, liveState)).toLowerCase().includes('active');
    }).length;
    const paid = positions.filter(position => {
      const liveFixture = positionFixture(position, fixtures);
      const liveState = liveFixture ? matchStates[liveFixture.id] : undefined;
      return ['paid', 'refunded', 'settled_winner'].includes(effectiveMatchStatus(position, liveFixture, liveState));
    }).length;
    const totalWei = positions.reduce((sum, position) => {
      const amount = position.type === 'refund' ? position.refund.amountWei : position.stake.amountWei;
      try {
        return sum + BigInt(amount);
      } catch {
        return sum;
      }
    }, 0n);
    return { active, paid, totalWei };
  }, [fixtures, matchStates, positions]);
  const volumeUsd = formatOkbUsdFromWei(summary.totalWei, okbUsd);
  const sortedPositions = useMemo(() => {
    return [...positions].sort((a, b) => {
      const contextFor = (position: UserPosition) => {
        const liveFixture = positionFixture(position, fixtures);
        const liveState = liveFixture ? matchStates[liveFixture.id] : undefined;
        const effectiveStatus = effectiveMatchStatus(position, liveFixture, liveState);
        const isLive = liveState?.status === 'live' || liveState?.status === 'half_time';
        const priority = isLive ? 0 : effectiveStatus === 'active' ? 1 : 2;
        return {
          priority,
          updatedAt: positionUpdatedAt(position),
          liveMinute: liveState?.minute ?? 0,
        };
      };
      const left = contextFor(a);
      const right = contextFor(b);
      if (left.priority !== right.priority) return left.priority - right.priority;
      if (left.priority === 0 && left.liveMinute !== right.liveMinute) return right.liveMinute - left.liveMinute;
      return right.updatedAt - left.updatedAt;
    });
  }, [fixtures, matchStates, positions]);
  const visiblePositions = sortedPositions.slice(0, visibleCount);
  const hasMorePositions = visibleCount < sortedPositions.length;

  return (
    <>
    <section className="overflow-hidden rounded-lg border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white shadow-sm">
      <div className="border-b dark:border-zinc-900 border-zinc-100 px-4 py-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-md bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white dark:bg-white dark:text-zinc-950">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                Account
              </div>
              <div className="flex shrink-0 items-center gap-2 md:hidden">
                {PRIVY_ENABLED ? (
                  <PrivyPositionsConnect address={address} onAddress={setAddress} onError={setError} />
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={connect} className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-all active:scale-95 hover:bg-blue-500">
                      <Wallet size={13} />
                      {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connect'}
                    </button>
                    {address && (
                      <button
                        onClick={() => {
                          setAddress(null);
                          rememberWallet(null);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2.5 py-2 text-xs font-bold dark:text-zinc-500 text-zinc-500 transition-colors hover:border-rose-500 hover:text-rose-600"
                        title="Disconnect"
                      >
                        <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 text-xl font-semibold tracking-tight dark:text-zinc-50 text-zinc-950">
              Portfolio
            </div>
            <div className="mt-1 text-sm dark:text-zinc-500 text-zinc-500">
              {address
                ? 'Track stakes, payouts, refunds, and champion positions from one account.'
                : PRIVY_ENABLED
                  ? 'Sign in with email or wallet to view your FanVibe positions.'
                  : 'Connect your account to view positions.'}
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            {PRIVY_ENABLED ? (
              <PrivyPositionsConnect address={address} onAddress={setAddress} onError={setError} />
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={connect} className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-all active:scale-95 hover:bg-blue-500">
                  <Wallet size={13} />
                  {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connect'}
                </button>
                {address && (
                  <button
                    onClick={() => {
                      setAddress(null);
                      rememberWallet(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border dark:border-zinc-800 border-zinc-200 px-2.5 py-2 text-xs font-bold dark:text-zinc-500 text-zinc-500 transition-colors hover:border-rose-500 hover:text-rose-600"
                    title="Disconnect"
                  >
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 divide-x dark:divide-zinc-900 divide-zinc-100 border-t border-b dark:border-zinc-900 border-zinc-100 py-3">
          <div className="px-3">
            <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Positions</div>
            <div className="mt-1 text-lg font-semibold tabular-nums dark:text-zinc-50 text-zinc-950">{positions.length}</div>
          </div>
          <div className="px-3">
            <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Active</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-blue-600 dark:text-blue-400">{summary.active}</div>
          </div>
          <div className="px-3">
            <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Volume</div>
            <div className="mt-1 text-lg font-semibold tabular-nums dark:text-zinc-50 text-zinc-950">{formatOKB(summary.totalWei.toString())}</div>
            {volumeUsd && <div className="mt-0.5 text-[10px] font-medium tabular-nums dark:text-zinc-600 text-zinc-400">{volumeUsd}</div>}
          </div>
        </div>

        {address && PRIVY_ENABLED && (
          <PrivyWalletPanel address={address} okbUsd={okbUsd} onError={setError} />
        )}

      </div>

      {error && <div className="mx-4 mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-500">{error}</div>}

      {address && (
        <div className="p-4">
          <div className="mb-3 border-b dark:border-zinc-900 border-zinc-100 pb-2 text-[10px] font-bold uppercase tracking-widest dark:text-zinc-600 text-zinc-400">Settlements</div>
          {positions.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm dark:text-zinc-500 text-zinc-500">
              {!positionsLoaded || positionsLoading ? 'Updating...' : 'No stakes found for this wallet yet.'}
            </div>
          ) : (
            <>
              <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
          {visiblePositions.map((position) => {
            const txHash = position.type === 'refund' ? position.refund.txHash : position.stake.txHash;
            const actionHash = position.type === 'refund' ? position.refund.refundTxHash : position.type === 'match' ? position.payout?.txHash : undefined;
            const amount = position.type === 'refund' ? position.refund.amountWei : position.stake.amountWei;
            const amountUsd = stripUsdPrefix(formatOkbUsdFromWei(amount, okbUsd));
            const liveFixture = positionFixture(position, fixtures);
            const liveState = liveFixture ? matchStates[liveFixture.id] : undefined;
            const effectiveStatus = effectiveMatchStatus(position, liveFixture, liveState);
            const selectedLabel = selectedOutcomeLabel(position, liveFixture);
            const statusCopy = statusHint(position, effectiveStatus);
            const returnedAmount = position.type === 'refund'
              ? position.refund.status === 'refunded' ? position.refund.amountWei : undefined
              : position.type === 'match'
                ? position.payout?.amountWei
                : position.payout?.amountWei;
            const returnedUsd = returnedAmount ? stripUsdPrefix(formatOkbUsdFromWei(returnedAmount, okbUsd)) : null;
            const canOpenMatch = position.type === 'match'
              && !!liveFixture
              && !!liveState
              && ['live', 'half_time', 'finished'].includes(liveState.status);
            const startsAt = position.type === 'match' && liveFixture && seasonStartedAt
              ? seasonFixtureStartAtMs(fixtures, liveFixture, seasonStartedAt, matchStates)
              : liveFixture?.simulatedKickoff
                ? Date.parse(liveFixture.simulatedKickoff)
                : undefined;
            const matchBadge = liveState?.status === 'finished'
              ? `FT ${liveState.homeScore}-${liveState.awayScore}`
              : liveState?.status === 'half_time'
                ? `HT ${liveState.homeScore}-${liveState.awayScore}`
                : liveState?.status === 'live'
                  ? `${liveState.minute}' ${liveState.homeScore}-${liveState.awayScore}`
                  : startsAt && startsAt > nowTick
                    ? `Starts ${fmtCountdown(startsAt - nowTick)}`
                    : liveFixture?.status === 'settled'
                      ? 'FT'
                      : liveFixture?.status === 'locked'
                        ? 'Live soon'
                        : liveFixture?.status === 'open'
                          ? 'Staking open'
                          : undefined;
            const displayMatchBadge = position.type === 'refund' ? undefined : matchBadge;
            const title = position.type === 'champion'
              ? `${position.stake.teamCode} to win`
              : position.type === 'refund'
                ? liveFixture
                  ? `${liveFixture.home.code} vs ${liveFixture.away.code}`
                  : friendlyFixtureId(position.refund.fixtureId)
                : liveFixture
                  ? `${liveFixture.home.code} vs ${liveFixture.away.code}`
                  : friendlyFixtureId(position.stake.fixtureId);
            const meta = position.type === 'match'
              ? [
                liveFixture?.round ? liveFixture.round : liveFixture?.group ? `Group ${liveFixture.group}` : undefined,
                liveFixture?.matchday ? `MD${liveFixture.matchday}` : undefined,
                liveFixture?.kickoff ? `Kickoff ${formatTime(liveFixture.kickoff)}` : undefined,
              ].filter(Boolean).join(' - ')
              : position.type === 'refund'
                ? `${refundReasonLabel(position.refund.reason)} - ${formatTime(position.refund.timestamp)}`
                : `Placed ${formatTime(position.stake.timestamp)}`;
            const settledMeta = effectiveStatus !== 'active'
              ? position.type === 'match'
                ? [
                  position.settlement?.settledAt ? `Settled ${formatTime(position.settlement.settledAt)}` : undefined,
                  (position.settlement?.outcome ?? liveFixture?.result) ? `Result ${(position.settlement?.outcome ?? liveFixture?.result)?.toUpperCase()}` : undefined,
                ].filter(Boolean).join(' - ')
                : position.type === 'champion'
                  ? [
                    position.settledAt ? `Settled ${formatTime(position.settledAt)}` : undefined,
                    position.winner ? `Winner ${position.winner}` : undefined,
                  ].filter(Boolean).join(' - ')
                  : ''
              : '';
            const season = seasonBadge(position);
            const flashGoal = position.type === 'match' && goalFlashIds.has(position.stake.fixtureId);

              return (
                <div
                key={`${position.type}-${txHash}`}
                role={canOpenMatch ? 'button' : undefined}
                tabIndex={canOpenMatch ? 0 : undefined}
                onClick={canOpenMatch && liveFixture ? () => onWatch?.(liveFixture.id) : undefined}
                onKeyDown={canOpenMatch && liveFixture ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onWatch?.(liveFixture.id);
                  }
                  } : undefined}
                  className={`position-row flex flex-col gap-2 border-b dark:border-zinc-900 border-zinc-100 px-1 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3 ${canOpenMatch ? 'cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/35' : ''} ${flashGoal ? 'position-goal-flash' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold dark:text-zinc-100 text-zinc-900">{title}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${pickTone(pickLabel(position))}`}>
                        {pickLabel(position)}
                      </span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${statusTone(effectiveStatus)}`}>
                        {statusLabel(position, effectiveStatus)}
                      </span>
                      {displayMatchBadge && (
                        <span className="shrink-0 rounded bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tabular-nums text-zinc-600 dark:text-zinc-300">
                          {displayMatchBadge}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {settledMeta && (
                        <span className="text-[10px] font-medium tabular-nums dark:text-zinc-600 text-zinc-400">
                          {settledMeta}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] dark:text-zinc-500 text-zinc-500">
                    <span className="font-semibold dark:text-zinc-300 text-zinc-700">Stake</span>{' '}
                    {formatOKB(amount)}{amountUsd ? ` (${amountUsd})` : ' ($...)'}
                    <span className="mx-1 text-zinc-300 dark:text-zinc-700">/</span>
                    <span>{selectedLabel}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] dark:text-zinc-600 text-zinc-400">
                    <span>{meta}</span>
                    <span className="hidden text-zinc-300 dark:text-zinc-800 sm:inline">/</span>
                    <span>{statusCopy}</span>
                    {returnedAmount && (
                      <>
                        <span className="hidden text-zinc-300 dark:text-zinc-800 sm:inline">/</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-300">
                          Returned {formatOKB(returnedAmount)}{returnedUsd ? ` (${returnedUsd})` : ''}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:self-start sm:flex-col sm:items-end">
                  {season && (
                    <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tabular-nums text-zinc-600 dark:text-zinc-300">
                      {season}
                    </span>
                  )}
                  {!season && <span className="sm:hidden" />}
                  <div className="flex shrink-0 items-center gap-2">
                    {position.type !== 'refund' || !actionHash ? (
                      <a href={explorerTx(txHash)} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="text-xs font-semibold dark:text-zinc-400 text-zinc-500 hover:text-blue-500">
                        Stake
                      </a>
                    ) : null}
                    {actionHash && (
                      <a href={explorerTx(actionHash)} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2 py-1 text-xs font-bold text-blue-600 dark:text-blue-300">
                        <ExternalLink size={11} />
                        {position.type === 'refund' ? 'Refund' : 'Payout'}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
              </div>
              {hasMorePositions && (
                <button
                  type="button"
                  onClick={() => setVisibleCount(count => Math.min(count + POSITION_BATCH_SIZE, sortedPositions.length))}
                  className="mt-3 w-full rounded-md border dark:border-zinc-900 border-zinc-100 px-3 py-2 text-xs font-semibold dark:text-zinc-500 text-zinc-500 transition-colors hover:border-blue-500/40 hover:text-blue-500"
                >
                  Show 10 more
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
    {address && (
      <section className="overflow-hidden rounded-lg border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white px-4 shadow-sm">
        <GrowthPanel address={address} okbUsd={okbUsd} />
      </section>
    )}
    </>
  );
}
