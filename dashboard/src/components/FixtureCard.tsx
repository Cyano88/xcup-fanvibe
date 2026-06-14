import { useState, useEffect, useCallback } from 'react';
import { AlarmClock, Check, Lock, MonitorPlay, Share2, TrendingUp, Zap } from 'lucide-react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import type { Fixture, Pool, Outcome, MatchState } from '../types';
import { encodeStakeCalldata, formatPool, countdown } from '../lib/encode';
import { formatOkbUsdFromWei, formatStakeUsd, useOkbUsdPrice } from '../lib/useOkbUsdPrice';
import { PrivyStakeButton } from './PrivyStakeButton';
import { PrivyWalletStakeButton } from './PrivyWalletStakeButton';
import { PrivyBalanceHint } from './PrivyBalanceHint';
import { reportStakeTx } from '../lib/stakeReport';
import { FANVIBE_TOKEN_URL } from '../lib/fanvibeToken';

interface Props {
  fixture: Fixture;
  pool?: Pool;
  matchState?: MatchState;
  seasonPhase?: 'preseason' | 'playing' | 'champion' | 'interseason';
  seasonTimer?: number;
  seasonKickoffDelayMs?: number;
  seasonStartedAt?: number;
  seasonFixtureStartsAt?: number | null;
  stakeClosedNotice?: string;
  refereeAddress: string;
  onStake: (fixtureId: string, outcome: Outcome) => boolean;
  onWatch: (fixtureId: string) => void;
  onOpenLeaderboard?: () => void;
}

const PRIVY_ENABLED = Boolean(import.meta.env.VITE_PRIVY_APP_ID);
const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const MIN_STAKE_OKB = 0.001;
const MIN_STAKE_OKB_LABEL = '0.001';
const UNRESOLVED_TEAM_CODES = new Set(['TBD', '1ST', '2ND', '3RD', 'WIN', 'LOS']);

const FLAG_URL = (iso: string) =>
  iso === 'un' || iso === 'tbd' ? '' : `https://flagcdn.com/w640/${iso.toLowerCase()}.png`;
const parseProviderTime = (value: string) => {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return Date.parse(normalized);
};

const ROUND_LABEL: Record<string, string> = {
  R32: 'Knockout',
  R16: 'Round of 16',
  QF:  'Quarter-Final',
  SF:  'Semi-Final',
  '3PL': '3rd Place',
  F:   'Final',
};

function TBDCard({ fixture }: { fixture: Fixture }) {
  return (
    <div className="rounded-lg overflow-hidden border dark:border-zinc-800/40 border-zinc-200/60 dark:bg-zinc-950 bg-white opacity-55">
      <div className="h-44 relative dark:bg-zinc-900 bg-zinc-100 overflow-hidden">
        <div
          className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/6 dark:via-white/4 to-transparent"
          style={{ animation: 'shimmer 2.4s ease-in-out infinite' }}
        />
        <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-3.5">
          <span className="text-[11px] text-zinc-500 uppercase tracking-widest">
            {fixture.round ? (ROUND_LABEL[fixture.round] ?? fixture.round) : 'Upcoming'}
          </span>
          <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-500 bg-zinc-200/60 dark:bg-zinc-800/60 border border-zinc-300/50 dark:border-zinc-700/40 px-2 py-0.5 rounded-full">
            UPCOMING
          </span>
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 select-none">
          <div className="flex items-center gap-5">
            <div className="h-14 w-14 rounded-full border dark:border-zinc-700 border-zinc-300 dark:bg-zinc-800 bg-zinc-200 grid place-items-center">
              <span className="text-sm font-bold dark:text-zinc-600 text-zinc-400">TBD</span>
            </div>
            <span className="text-xs dark:text-zinc-700 text-zinc-400">vs</span>
            <div className="h-14 w-14 rounded-full border dark:border-zinc-700 border-zinc-300 dark:bg-zinc-800 bg-zinc-200 grid place-items-center">
              <span className="text-sm font-bold dark:text-zinc-600 text-zinc-400">TBD</span>
            </div>
          </div>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-600">Awaiting group qualifiers</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t dark:from-zinc-900 from-zinc-100 to-transparent" />
      </div>
      <div className="p-3 dark:bg-zinc-950 bg-white">
        <div className="h-11 rounded-xl dark:bg-zinc-900/80 bg-zinc-100 border dark:border-zinc-800 border-zinc-200 animate-pulse" />
      </div>
      <div className="px-4 pb-3 dark:bg-zinc-950 bg-white">
        <div className="h-2.5 w-2/5 rounded dark:bg-zinc-900 bg-zinc-100 animate-pulse" />
      </div>
    </div>
  );
}

function formatShortDuration(totalSeconds: number): string {
  const secs = Math.max(0, totalSeconds);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isEmbeddedWallet(walletClientType: string) {
  return walletClientType === 'privy' || walletClientType === 'privy-v2';
}

function cleanStakeAmountInput(value: string) {
  const normalized = value.replace(',', '.');
  if (normalized === '') return '';
  if (!/^\d*(?:\.\d*)?$/.test(normalized)) return null;
  const numericValue = Number(normalized);
  if (Number.isFinite(numericValue) && numericValue > 0 && numericValue < MIN_STAKE_OKB) return MIN_STAKE_OKB_LABEL;
  const [whole = '', decimals = ''] = normalized.split('.');
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '') || (whole.startsWith('0') ? '0' : whole);
  return decimals !== undefined && normalized.includes('.')
    ? `${trimmedWhole}.${decimals.slice(0, 3)}`
    : trimmedWhole;
}

function normalizedStakeAmount(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return amount < MIN_STAKE_OKB ? MIN_STAKE_OKB_LABEL : amount.toFixed(3).replace(/\.?0+$/, '');
}

function PrimaryMatchStakeAction({
  amountOKB,
  calldata,
  refereeAddress,
  disabled,
  onBeforeStake,
  onSuccess,
  onError,
}: {
  amountOKB: string;
  calldata: `0x${string}`;
  refereeAddress: string;
  disabled?: boolean;
  onBeforeStake?: () => Promise<boolean> | boolean;
  onSuccess: (hash: `0x${string}`, amountWei: bigint) => void;
  onError: (message: string) => void;
}) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const externalWallet = wallets.find(wallet => !isEmbeddedWallet(wallet.walletClientType));
  const className = 'inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-3.5 text-xs font-bold text-white transition-all active:scale-95 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50';
  const label = authenticated || externalWallet ? 'Stake ->' : 'Sign in to stake';

  if (!authenticated && externalWallet) {
    return (
      <PrivyWalletStakeButton
        amountOKB={amountOKB}
        calldata={calldata}
        refereeAddress={refereeAddress}
        disabled={disabled}
        pendingLabel="Confirm in wallet..."
        onBeforeStake={onBeforeStake}
        onSuccess={(hash, amountWei) => onSuccess(hash, amountWei)}
        onError={(message) => onError(message || '')}
        className={className}
      >
        {label}
      </PrivyWalletStakeButton>
    );
  }

  return (
    <PrivyStakeButton
      amountOKB={amountOKB}
      calldata={calldata}
      refereeAddress={refereeAddress}
      disabled={disabled}
      pendingLabel="Confirm stake..."
      onBeforeStake={onBeforeStake}
      onSuccess={(hash, amountWei) => onSuccess(hash, amountWei)}
      onError={(message) => onError(message || '')}
      className={className}
    >
      {label}
    </PrivyStakeButton>
  );
}

export function FixtureCard({
  fixture,
  pool,
  matchState,
  seasonPhase,
  seasonTimer = 0,
  seasonKickoffDelayMs = 0,
  seasonStartedAt,
  seasonFixtureStartsAt,
  stakeClosedNotice,
  refereeAddress,
  onStake,
  onWatch,
  onOpenLeaderboard,
}: Props) {
  if (UNRESOLVED_TEAM_CODES.has(fixture.home.code) || UNRESOLVED_TEAM_CODES.has(fixture.away.code)) {
    return <TBDCard fixture={fixture} />;
  }
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const connectedAddress = user?.wallet?.address ?? wallets[0]?.address ?? null;

  const [showHome, setShowHome]   = useState(true);
  const [hovered, setHovered]     = useState(false);
  const [tick, setTick]           = useState(0);
  const [stakeOutcome, setStakeOutcome] = useState<Outcome | null>(null);
  const [stakeAmount, setStakeAmount] = useState('0.01');
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [stakeHash, setStakeHash] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const okbUsd = useOkbUsdPrice();
  const stakeUsd = formatStakeUsd(stakeAmount, okbUsd);
  const stakeAmountNumber = Number(stakeAmount);
  const stakeAmountValid = Number.isFinite(stakeAmountNumber) && stakeAmountNumber >= MIN_STAKE_OKB;
  const isSeasonPlay = fixture.mode === 'simulated';
  const isLiveMatch = matchState?.status === 'live' || matchState?.status === 'half_time';
  const isFinishedMatch = matchState?.status === 'finished';
  const canStream = isLiveMatch;

  // Countdown refresh
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), isSeasonPlay ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [isSeasonPlay]);
  void tick;

  // Auto-flip flag every 3 s (pauses on hover)
  useEffect(() => {
    if (hovered || isLiveMatch) return;
    const t = setInterval(() => setShowHome((h) => !h), 3000);
    return () => clearInterval(t);
  }, [hovered, isLiveMatch]);

  const flipTo = useCallback((side: 'home' | 'away') => {
    setShowHome(side === 'home');
    setHovered(true);
  }, []);

  const p   = pool ?? { fixtureId: fixture.id, home: '0', draw: '0', away: '0', fees: '0', count: 0 };
  const fmt = formatPool(p);
  const hasPool   = fmt.totalOKB !== '0.0000';
  const outcomePoolUsdLabel = (wei: string) => {
    try {
      if (BigInt(wei) <= 0n) return null;
    } catch {
      return null;
    }
    return formatOkbUsdFromWei(wei, okbUsd)?.replace(/^US/, '') ?? null;
  };
  const homePoolUsdLabel = outcomePoolUsdLabel(p.home);
  const drawPoolUsdLabel = outcomePoolUsdLabel(p.draw);
  const awayPoolUsdLabel = outcomePoolUsdLabel(p.away);
  const isSettled = fixture.status === 'settled';
  const isLocked  = fixture.status === 'locked' || isSettled;
  const seasonFixtureStartsIn = seasonPhase === 'preseason'
    ? seasonTimer + Math.ceil(seasonKickoffDelayMs / 1000)
    : seasonPhase === 'playing'
      ? seasonFixtureStartsAt === null
        ? Number.POSITIVE_INFINITY
        : Math.ceil(((seasonFixtureStartsAt ?? seasonStartedAt ?? Date.now()) - Date.now()) / 1000)
      : 0;
  const timeLabel = isSeasonPlay
    ? !Number.isFinite(seasonFixtureStartsIn)
      ? 'Awaiting MD'
      : seasonFixtureStartsIn > 0
      ? formatShortDuration(seasonFixtureStartsIn)
      : seasonPhase === 'playing'
        ? 'Starting'
        : 'Awaiting'
    : countdown(fixture.kickoff);
  const isStakeWindowOpen = isSeasonPlay
    ? !isLocked
      && matchState?.status !== 'live'
      && matchState?.status !== 'half_time'
      && matchState?.status !== 'finished'
      && (fixture.status === 'open' || fixture.status === 'upcoming')
      && (!Number.isFinite(seasonFixtureStartsIn) || seasonFixtureStartsIn > 5)
    : !isSettled
      && matchState?.status !== 'finished'
      && (fixture.status === 'open' || fixture.status === 'upcoming' || fixture.status === 'locked');
  const stakeStateLabel = isFinishedMatch || isSettled
    ? 'Result final'
    : isLiveMatch
      ? 'Staking live'
      : isStakeWindowOpen
        ? 'Staking open'
        : 'Staking locked';
  const showStakeClosedNotice = !!stakeClosedNotice;

  // Use live pool shares when stakes exist, otherwise baseOdds
  const homeOdds = hasPool ? Math.round(fmt.homeShare) : fixture.baseOdds.home;
  const drawOdds = hasPool ? Math.round(fmt.drawShare)  : fixture.baseOdds.draw;
  const awayOdds = hasPool ? Math.round(fmt.awayShare)  : fixture.baseOdds.away;
  const matchShareUrl = typeof window === 'undefined'
    ? `/?match=${encodeURIComponent(fixture.id)}`
    : `${window.location.origin}/?match=${encodeURIComponent(fixture.id)}`;
  const matchShareText = `Back ${fixture.home.code} vs ${fixture.away.code} on FanVibe. Stake OKB on the match and hold FVB for Matchday Cup eligibility.`;

  const selectStake = useCallback((outcome: Outcome) => {
    if (!onStake(fixture.id, outcome)) return;
    setStakeError(null);
    setStakeOutcome(current => current === outcome ? null : outcome);
  }, [fixture.id, onStake]);

  const shareMatch = useCallback(async () => {
    const payload = { title: 'FanVibe World Cup match', text: matchShareText, url: matchShareUrl };
    try {
      if (navigator.share) {
        await navigator.share(payload);
      } else {
        await navigator.clipboard.writeText(`${matchShareText} ${matchShareUrl}`);
      }
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setShareCopied(false);
    }
  }, [matchShareText, matchShareUrl]);

  const checkStakeOpen = useCallback(async () => {
    if (!stakeAmountValid) {
      setStakeError(`Minimum stake is ${MIN_STAKE_OKB_LABEL} OKB.`);
      return false;
    }
    if (!onStake(fixture.id, stakeOutcome ?? 'home')) return false;
    try {
      const statusRes = await fetch(`${BACKEND_HTTP}/stake/status/${encodeURIComponent(fixture.id)}`);
      if (!statusRes.ok) return true;
      const status = await statusRes.json() as { canStake?: boolean; reason?: string };
      if (status.canStake === false) {
        setStakeError(status.reason ?? 'This market is closed.');
        setStakeOutcome(null);
        return false;
      }
    } catch {
      return true;
    }
    return true;
  }, [fixture.id, onStake, stakeAmountValid, stakeOutcome]);

  const kickoffStr = isSeasonPlay ? (!Number.isFinite(seasonFixtureStartsIn) ? 'after previous MD' : seasonFixtureStartsIn > 0 ? 'until window' : 'season clock') : new Date(parseProviderTime(fixture.kickoff)).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  return (
    <div
      className={`rounded-lg overflow-hidden shadow-sm transition-all duration-300 border
        dark:bg-zinc-950 bg-white
        ${isSettled
          ? 'opacity-70 dark:border-zinc-800 border-zinc-200'
          : 'dark:border-zinc-800/60 border-zinc-200 hover:shadow-2xl hover:-translate-y-0.5 hover:dark:border-zinc-700 hover:border-zinc-300'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Flag hero ───────────────────────────────────────────────── */}
      <div className="relative h-44 overflow-hidden select-none">

        {/* Home flag layer */}
        <div
          className="absolute inset-0 transition-opacity duration-1000 ease-in-out bg-center bg-cover"
          style={{ backgroundImage: `url(${FLAG_URL(fixture.home.iso)})`, opacity: showHome ? 1 : 0 }}
        />
        {/* Away flag layer */}
        <div
          className="absolute inset-0 transition-opacity duration-1000 ease-in-out bg-center bg-cover"
          style={{ backgroundImage: `url(${FLAG_URL(fixture.away.iso)})`, opacity: showHome ? 0 : 1 }}
        />
        {/* Gradient scrim for readability */}
        <div
          className={`absolute inset-0 transition-colors duration-500 ${
            isLiveMatch
              ? 'bg-gradient-to-b from-black/70 via-black/75 to-black/90'
              : 'bg-gradient-to-b from-black/30 via-black/40 to-black/75'
          }`}
        />

        {/* Top bar */}
        <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-3.5">
          <span className="text-[11px] text-white/60 uppercase tracking-widest">
            {fixture.round
              ? `${ROUND_LABEL[fixture.round] ?? 'Knockout'}  - Match ${fixture.matchday}`
              : `Group ${fixture.group}  - Matchday ${fixture.matchday}`}
          </span>
          {matchState?.status === 'live' ? (
            <span className="text-[10px] font-bold text-emerald-200 bg-emerald-500/25 border border-emerald-300/40 px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
              LIVE
            </span>
          ) : matchState?.status === 'half_time' ? (
            <span className="text-[10px] font-bold text-zinc-100 bg-zinc-900/55 border border-white/15 px-2 py-0.5 rounded-full backdrop-blur-sm">
              HALF TIME
            </span>
          ) : matchState?.status === 'finished' ? (
            <span className="text-[10px] font-bold text-zinc-100 bg-zinc-900/55 border border-white/15 px-2 py-0.5 rounded-full backdrop-blur-sm">
              FT
            </span>
          ) : isSettled ? (
            <span className="text-[10px] font-bold text-zinc-100 bg-zinc-900/55 border border-white/15 px-2 py-0.5 rounded-full backdrop-blur-sm">
              SETTLED
            </span>
          ) : isLocked ? (
            <span className="text-[10px] font-bold text-zinc-100 bg-zinc-900/55 border border-white/15 px-2 py-0.5 rounded-full backdrop-blur-sm">
              LOCKED
            </span>
          ) : (
            <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-400/30 px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              OPEN
            </span>
          )}
        </div>

        {/* Teams row */}
        <div className="absolute bottom-9 inset-x-0 flex items-end justify-between px-5">
          {/* Home team */}
          <button
            className="flex flex-col items-center gap-1 group/home"
            onClick={() => flipTo('home')}
            title={`View ${fixture.home.name} flag`}
          >
            <span className={`text-5xl drop-shadow-xl transition-transform duration-200 ${showHome ? 'scale-110' : 'scale-90 opacity-70'} group-hover/home:scale-110`}>
              {fixture.home.flag}
            </span>
            <span className={`text-sm font-bold tracking-wider drop-shadow transition-colors ${showHome ? 'text-white' : 'text-white/60'}`}>
              {fixture.home.code}
            </span>
          </button>

          {/* Centre - live score / time / result */}
          <div className={`flex flex-col items-center gap-0.5 pb-1 rounded-lg px-3 py-2 transition-colors duration-300 ${
            isLiveMatch ? 'bg-black/45 border border-white/10 backdrop-blur-sm shadow-2xl' : ''
          }`}>
            {matchState?.status === 'live' ? (
              <>
                <div className="flex items-center gap-2 text-white font-black text-2xl tabular-nums drop-shadow-lg">
                  <span>{matchState.homeScore}</span>
                  <span className="text-white/40 text-lg">-</span>
                  <span>{matchState.awayScore}</span>
                </div>
                <span className="text-[10px] text-emerald-300 font-bold flex items-center gap-1">
                  <Zap size={9} className="animate-pulse" />{matchState.minute}'
                </span>
              </>
            ) : matchState?.status === 'half_time' ? (
              <>
                <div className="flex items-center gap-2 text-white font-black text-2xl tabular-nums drop-shadow-lg">
                  <span>{matchState.homeScore}</span>
                  <span className="text-white/40 text-lg">-</span>
                  <span>{matchState.awayScore}</span>
                </div>
                <span className="text-[10px] text-zinc-200 font-bold">HT</span>
              </>
            ) : matchState?.status === 'finished' ? (
              <>
                <div className="flex items-center gap-2 text-white font-black text-2xl tabular-nums drop-shadow-lg">
                  <span>{matchState.homeScore}</span>
                  <span className="text-white/40 text-lg">-</span>
                  <span>{matchState.awayScore}</span>
                </div>
                <span className="text-[10px] text-zinc-200 font-bold">FT</span>
              </>
            ) : isSettled && fixture.result ? (
              <span className="text-sm font-bold text-zinc-100 uppercase tracking-widest">
                {fixture.result === 'draw' ? 'DRAW' : fixture.result === 'home' ? fixture.home.code : fixture.away.code}
              </span>
            ) : isSettled ? (
              <span className="text-sm font-bold text-zinc-100 uppercase tracking-widest">
                ENDED
              </span>
            ) : (
              <>
                <span className="text-xs font-bold text-white/40 tracking-widest">VS</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/24 px-2 py-0.5 text-[13px] text-white font-semibold tabular-nums ring-1 ring-white/10 backdrop-blur-sm">
                  <AlarmClock size={12} strokeWidth={1.65} className="text-white/75" />
                  {timeLabel}
                </span>
                <span className="text-[10px] text-white/55">{kickoffStr}</span>
              </>
            )}
          </div>

          {/* Away team */}
          <button
            className="flex flex-col items-center gap-1 group/away"
            onClick={() => flipTo('away')}
            title={`View ${fixture.away.name} flag`}
          >
            <span className={`text-5xl drop-shadow-xl transition-transform duration-200 ${!showHome ? 'scale-110' : 'scale-90 opacity-70'} group-hover/away:scale-110`}>
              {fixture.away.flag}
            </span>
            <span className={`text-sm font-bold tracking-wider drop-shadow transition-colors ${!showHome ? 'text-white' : 'text-white/60'}`}>
              {fixture.away.code}
            </span>
          </button>
        </div>

        {/* Flip indicator dots */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
          <button
            onClick={() => flipTo('home')}
            className={`transition-all duration-300 rounded-full ${showHome ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/30 hover:bg-white/50'}`}
          />
          <button
            onClick={() => flipTo('away')}
            className={`transition-all duration-300 rounded-full ${!showHome ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/30 hover:bg-white/50'}`}
          />
        </div>

        {showStakeClosedNotice && (
          <div className="absolute inset-x-4 bottom-4 z-20 rounded-lg border border-blue-300/30 bg-blue-950/80 px-3 py-2 text-center shadow-sm backdrop-blur-md">
            <div className="text-xs font-bold text-blue-100">
              {isFinishedMatch || isSettled ? 'Market closed' : 'Stake unavailable'}
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-blue-100/75">
              {stakeClosedNotice ?? 'Stake on the next available match.'}
            </div>
          </div>
        )}
      </div>

      {/* ── Outcome buttons ──────────────────────────────────────────── */}
      <div className="p-3 dark:bg-zinc-950 bg-white">
        {!isStakeWindowOpen ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl dark:bg-zinc-900 bg-zinc-100 border dark:border-zinc-800 border-zinc-200 text-xs dark:text-zinc-500 text-zinc-400">
              <Lock size={11} />
              <span>{stakeStateLabel}</span>
              {isSettled && fixture.result && (
                <span className="dark:text-zinc-300 text-zinc-600 font-semibold capitalize ml-1"> - {fixture.result}</span>
              )}
            </div>
            {canStream && (
              <button
                onClick={() => onWatch(fixture.id)}
                className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg text-xs font-semibold transition-all
                  dark:bg-zinc-100 dark:text-zinc-950 bg-zinc-900 text-white
                  dark:hover:bg-white hover:bg-zinc-800 active:scale-95"
              >
                <MonitorPlay size={12} />
                Live Center
              </button>
            )}
            <button
              onClick={shareMatch}
              className="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-semibold transition-all
                dark:border-zinc-800 dark:text-zinc-400 text-zinc-500 border-zinc-200
                dark:hover:border-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300 hover:text-zinc-800 active:scale-95"
            >
              {shareCopied ? <Check size={12} /> : <Share2 size={12} />}
              {shareCopied ? 'Copied' : 'Share'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1.5">
              {/* Home */}
              <button
                onClick={() => selectStake('home')}
                onMouseEnter={() => flipTo('home')}
                disabled={!isStakeWindowOpen}
                className="group/btn flex flex-col items-center gap-1 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                  dark:bg-emerald-500/8 bg-emerald-50 dark:border-emerald-500/20 border-emerald-200
                  dark:hover:bg-emerald-500/18 hover:bg-emerald-100 dark:hover:border-emerald-400/50 hover:border-emerald-400
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="text-[11px] dark:text-emerald-400 text-emerald-700 font-semibold">{fixture.home.code}</span>
                <span className="text-lg font-black dark:text-emerald-300 text-emerald-700 tabular-nums leading-none">
                  {homeOdds}%
                </span>
                <span className="text-[10px] dark:text-emerald-600 text-emerald-500 font-medium">
                  {hasPool ? `${fmt.homeOKB} OKB` : 'Stake ->'}
                </span>
                {homePoolUsdLabel && (
                  <span className="inline-flex items-center gap-1 text-[9px] dark:text-emerald-700 text-emerald-600/70 font-medium">
                    <TrendingUp size={8} />
                    {homePoolUsdLabel}
                  </span>
                )}
              </button>

              {/* Draw */}
              <button
                onClick={() => selectStake('draw')}
                disabled={!isStakeWindowOpen}
                className="group/btn flex flex-col items-center gap-1 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                  dark:bg-zinc-800/50 bg-zinc-100 dark:border-zinc-700/50 border-zinc-200
                  dark:hover:bg-zinc-700/60 hover:bg-zinc-200 dark:hover:border-zinc-500 hover:border-zinc-400
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="text-[11px] dark:text-zinc-400 text-zinc-600 font-semibold">Draw</span>
                <span className="text-lg font-black dark:text-zinc-100 text-zinc-800 tabular-nums leading-none">
                  {drawOdds}%
                </span>
                <span className="text-[10px] dark:text-zinc-500 text-zinc-500 font-medium">
                  {hasPool ? `${fmt.drawOKB} OKB` : 'Stake ->'}
                </span>
                {drawPoolUsdLabel && (
                  <span className="inline-flex items-center gap-1 text-[9px] dark:text-zinc-600 text-zinc-500 font-medium">
                    <TrendingUp size={8} />
                    {drawPoolUsdLabel}
                  </span>
                )}
              </button>

              {/* Away */}
              <button
                onClick={() => selectStake('away')}
                onMouseEnter={() => flipTo('away')}
                disabled={!isStakeWindowOpen}
                className="group/btn flex flex-col items-center gap-1 py-3 px-1 rounded-xl border transition-all duration-150 active:scale-95
                  dark:bg-blue-500/8 bg-blue-50 dark:border-blue-500/20 border-blue-200
                  dark:hover:bg-blue-500/14 hover:bg-blue-100 dark:hover:border-blue-400/45 hover:border-blue-300
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="text-[11px] dark:text-blue-300 text-blue-700 font-semibold">{fixture.away.code}</span>
                <span className="text-lg font-black dark:text-blue-200 text-blue-700 tabular-nums leading-none">
                  {awayOdds}%
                </span>
                <span className="text-[10px] dark:text-blue-500 text-blue-600 font-medium">
                  {hasPool ? `${fmt.awayOKB} OKB` : 'Stake ->'}
                </span>
                {awayPoolUsdLabel && (
                  <span className="inline-flex items-center gap-1 text-[9px] dark:text-blue-600 text-blue-600/70 font-medium">
                    <TrendingUp size={8} />
                    {awayPoolUsdLabel}
                  </span>
                )}
              </button>
            </div>
            <div className={`grid gap-1.5 ${canStream ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {canStream && (
                <button
                  onClick={() => onWatch(fixture.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all
                    dark:bg-zinc-100 dark:text-zinc-950 bg-zinc-900 text-white
                    dark:hover:bg-white hover:bg-zinc-800 active:scale-95"
                >
                  <MonitorPlay size={12} />
                  Live Center
                </button>
              )}
              <button
                onClick={shareMatch}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all
                  dark:border-zinc-800 dark:text-zinc-400 text-zinc-500 border-zinc-200
                  dark:hover:border-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300 hover:text-zinc-800 active:scale-95"
              >
                {shareCopied ? <Check size={12} /> : <Share2 size={12} />}
                {shareCopied ? 'Copied' : 'Share'}
              </button>
            </div>
          </div>
        )}
        {stakeOutcome && isStakeWindowOpen && (
          <div className="mt-3 rounded-lg border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-900/55 bg-zinc-50 p-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold dark:text-zinc-100 text-zinc-800">
                  {stakeOutcome === 'home' ? fixture.home.name : stakeOutcome === 'away' ? fixture.away.name : 'Draw'}
                </div>
                <div className="text-[11px] font-medium dark:text-zinc-500 text-zinc-500">
                  {stakeOutcome === 'draw' ? `${fixture.home.code} vs ${fixture.away.code}` : 'Match stake'}
                </div>
              </div>
              <button
                onClick={() => {
                  setStakeError(null);
                  setStakeOutcome(null);
                }}
                className="h-8 rounded-md px-2.5 text-xs font-semibold dark:text-zinc-500 text-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-600 transition-colors"
              >
                Cancel
              </button>
            </div>
            <div className="mt-3 grid gap-2">
              <div className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-2">
                <div className="flex h-9 min-w-0 items-center gap-1 dark:bg-zinc-950 bg-white border dark:border-zinc-800 border-zinc-200 rounded-lg px-2">
                  <input
                    type="number"
                    step="0.001"
                    min={MIN_STAKE_OKB_LABEL}
                    inputMode="decimal"
                    value={stakeAmount}
                    onChange={event => {
                      setStakeError(null);
                      const next = cleanStakeAmountInput(event.target.value);
                      if (next !== null) setStakeAmount(next);
                    }}
                    onBlur={() => setStakeAmount(current => normalizedStakeAmount(current) || MIN_STAKE_OKB_LABEL)}
                    className="w-full min-w-0 bg-transparent text-sm font-semibold dark:text-zinc-100 text-zinc-800 outline-none"
                  />
                  <span className="shrink-0 text-[10px] dark:text-zinc-500 text-zinc-400">OKB</span>
                </div>
                {stakeUsd && <span className="shrink-0 whitespace-nowrap text-left text-[11px] font-medium tabular-nums dark:text-zinc-600 text-zinc-400 sm:text-right">{stakeUsd}</span>}
              </div>
              {PRIVY_ENABLED && (
                <PrimaryMatchStakeAction
                  amountOKB={stakeAmount}
                  calldata={encodeStakeCalldata(fixture.id, stakeOutcome)}
                  refereeAddress={refereeAddress}
                  disabled={!refereeAddress || !stakeAmountValid}
                  onBeforeStake={checkStakeOpen}
                  onSuccess={(hash) => {
                    setStakeHash(hash);
                    setStakeError(null);
                    setStakeOutcome(null);
                    reportStakeTx(hash, connectedAddress).catch((err: unknown) => {
                      setStakeError(err instanceof Error ? err.message : 'Stake indexing is delayed.');
                    });
                  }}
                  onError={(message) => setStakeError(message || null)}
                />
              )}
            </div>
            {!stakeAmountValid && (
              <p className="mt-2 text-[11px] font-medium dark:text-zinc-600 text-zinc-500">
                Minimum stake is {MIN_STAKE_OKB_LABEL} OKB.
              </p>
            )}
            {PRIVY_ENABLED && <div className="mt-2"><PrivyBalanceHint amountOKB={stakeAmount} /></div>}
            {stakeError && (
              <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-400">{stakeError}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pb-3 dark:bg-zinc-950 bg-white">
        <div className="flex items-center gap-1.5 text-[11px] dark:text-zinc-500 text-zinc-500 font-medium">
          {!hasPool ? (
            <>
              <TrendingUp size={10} />
              <span>No stakes yet</span>
            </>
          ) : (
            <>
              <TrendingUp size={10} />
              <span>{fmt.totalOKB} OKB pool</span>
            </>
          )}
        </div>
        <span className="text-[11px] dark:text-zinc-500 text-zinc-500 truncate max-w-[160px]">
          {fixture.stadium
            ? `${fixture.stadium.city.split(',')[0]}  - ${fixture.stadium.capacity.toLocaleString()}`
            : fixture.venue.split(' -')[0].trim()}
        </span>
      </div>
      {stakeHash && (
        <div className="mx-4 mb-3 rounded-lg border dark:border-blue-500/15 border-blue-200/70 dark:bg-blue-500/8 bg-blue-50 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold dark:text-blue-300 text-blue-700">
            <span>You are on the board</span>
            <a
              href={`https://www.okx.com/web3/explorer/xlayer/tx/${stakeHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate underline"
            >
              {stakeHash.slice(0, 16)}...
            </a>
            <button onClick={() => setStakeHash(null)} className="ml-auto text-zinc-500 hover:text-zinc-300">x</button>
          </div>
          <div className="mt-1 text-[11px] dark:text-zinc-500 text-zinc-500">
            Hold FVB with this wallet to qualify for Matchday Cup rewards.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={FANVIBE_TOKEN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
            >
              Buy FVB
            </a>
            <button
              onClick={onOpenLeaderboard}
              disabled={!onOpenLeaderboard}
              className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] font-bold text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200"
            >
              View leaderboard
            </button>
            <button
              onClick={shareMatch}
              className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] font-bold text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200"
            >
              Share match
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


