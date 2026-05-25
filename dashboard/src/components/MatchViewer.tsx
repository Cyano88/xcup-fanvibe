import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Send, MessageCircle, BarChart2, List, Users } from 'lucide-react';
import type { Fixture, MatchState, MatchEvent } from '../types';
import { getSquad } from '../lib/squadData';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const BROADCAST_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

interface Comment { id: number; name: string; text: string; ts: string; fixtureId: string; }
interface Props { fixture: Fixture; matchState: MatchState; onClose: () => void; }

const flagUrl = (iso: string) =>
  iso === 'un' || iso === 'tbd' ? '' : `https://flagcdn.com/w160/${iso.toLowerCase()}.png`;

function TeamFlag({ iso, fallback, className = '' }: { iso: string; fallback: string; className?: string }) {
  const src = flagUrl(iso);
  if (!src) return <span className={className}>{fallback}</span>;

  return (
    <span className={`inline-flex items-center justify-center overflow-hidden rounded-[3px] bg-zinc-200 dark:bg-zinc-800 ring-1 ring-black/10 dark:ring-white/10 ${className}`}>
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
          const parent = event.currentTarget.parentElement;
          if (parent) parent.textContent = fallback;
        }}
      />
    </span>
  );
}

// ── Stat helpers ──────────────────────────────────────────────────────────────

function computeStats(events: MatchEvent[]) {
  let shotsOnHome = 0, shotsOnAway = 0;
  let shotsOffHome = 0, shotsOffAway = 0;
  let cornersHome = 0, cornersAway = 0;
  let foulsHome = 0, foulsAway = 0;
  let cardsHome = 0, cardsAway = 0;
  let offsidesHome = 0, offsidesAway = 0;
  let throwInsHome = 0, throwInsAway = 0;
  let freeKicksHome = 0, freeKicksAway = 0;

  for (const e of events) {
    if (e.type === 'goal_home' || e.type === 'shot_on_home') shotsOnHome++;
    else if (e.type === 'goal_away' || e.type === 'shot_on_away') shotsOnAway++;
    else if (e.type === 'shot_home' || e.type === 'shot_off_home') shotsOffHome++;
    else if (e.type === 'shot_away' || e.type === 'shot_off_away') shotsOffAway++;
    else if (e.type === 'corner_home') cornersHome++;
    else if (e.type === 'corner_away') cornersAway++;
    else if (e.type === 'foul_home')   foulsHome++;
    else if (e.type === 'foul_away')   foulsAway++;
    else if (e.type === 'offside_home') offsidesHome++;
    else if (e.type === 'offside_away') offsidesAway++;
    else if (e.type === 'throw_home') throwInsHome++;
    else if (e.type === 'throw_away') throwInsAway++;
    else if (e.type === 'free_kick_home') freeKicksHome++;
    else if (e.type === 'free_kick_away') freeKicksAway++;
    else if (e.type.startsWith('yellow') || e.type.startsWith('red')) {
      if (e.team === 'home') cardsHome++; else cardsAway++;
    }
  }

  return {
    shotsOn:   { home: shotsOnHome,  away: shotsOnAway },
    shotsOff:  { home: shotsOffHome, away: shotsOffAway },
    totalShots:{ home: shotsOnHome + shotsOffHome, away: shotsOnAway + shotsOffAway },
    dangerous: { home: shotsOffHome + cornersHome + shotsOnHome * 2, away: shotsOffAway + cornersAway + shotsOnAway * 2 },
    corners:   { home: cornersHome,  away: cornersAway },
    fouls:     { home: foulsHome,    away: foulsAway },
    cards:     { home: cardsHome,    away: cardsAway },
    offsides:  { home: offsidesHome, away: offsidesAway },
    throwIns:  { home: throwInsHome, away: throwInsAway },
    freeKicks: { home: freeKicksHome, away: freeKicksAway },
  };
}

function isStoppageEvent(type: string): boolean {
  return type.startsWith('corner') ||
    type.startsWith('throw') ||
    type.startsWith('free_kick') ||
    type.startsWith('goal_kick') ||
    type.startsWith('foul') ||
    type.startsWith('offside') ||
    type.startsWith('goal') ||
    type.startsWith('shot_off') ||
    type.startsWith('yellow') ||
    type.startsWith('red') ||
    type.startsWith('sub');
}

function getActionLabel(ev: MatchEvent | undefined, home: string, away: string): { text: string; isHome: boolean } | null {
  if (!ev) return null;
  const isHome = ev.team === 'home';
  const team = isHome ? home : away;
  const actor = ev.player ? ` - ${ev.player}` : '';
  if (ev.type === 'goal_kick_home' || ev.type === 'goal_kick_away') return { text: `${team} - Goal Kick${actor}`, isHome };
  if (ev.type === 'goal_home' || ev.type === 'goal_away') return { text: `${team} - Goal${actor}`, isHome };
  if (ev.type === 'shot_on_home' || ev.type === 'shot_on_away') return { text: `${team} - Shot On Target${actor}`, isHome };
  if (ev.type === 'shot_off_home' || ev.type === 'shot_off_away' || ev.type === 'shot_home' || ev.type === 'shot_away') return { text: `${team} - Shot Off Target${actor}`, isHome };
  if (ev.type === 'corner_home' || ev.type === 'corner_away') return { text: `${team} - Corner Kick${actor}`, isHome };
  if (ev.type === 'throw_home' || ev.type === 'throw_away') return { text: `${team} - Throw In${actor}`, isHome };
  if (ev.type === 'free_kick_home' || ev.type === 'free_kick_away') return { text: `${team} - Free Kick${actor}`, isHome };
  if (ev.type === 'foul_home' || ev.type === 'foul_away') return { text: `${team} - Foul Play${actor}`, isHome };
  if (ev.type === 'offside_home' || ev.type === 'offside_away') return { text: `${team} - Offside${actor}`, isHome };
  if (ev.type === 'safe_home' || ev.type === 'safe_away') return { text: `${team} - Ball Safe`, isHome };
  if (ev.type === 'attack_home' || ev.type === 'attack_away') return { text: `${team} - Attacking Build Up`, isHome };
  if (ev.type === 'pressure_home' || ev.type === 'pressure_away') return { text: `${team} - Final Third`, isHome };
  if (ev.type.startsWith('yellow')) return { text: `${team} - Yellow Card${actor}`, isHome };
  if (ev.type.startsWith('red'))    return { text: `${team} - Red Card${actor}`, isHome };
  if (ev.type.startsWith('sub'))    return { text: `${team} - ${ev.player ?? 'Sub'} On`, isHome };
  if (ev.type === 'half_time')  return { text: 'Half Time', isHome: true };
  if (ev.type === 'full_time')  return { text: 'Full Time', isHome: true };
  if (ev.type === 'kickoff' || ev.type === 'second_half') return { text: `${home} - Ball Safe`, isHome: true };
  return { text: `${team} - Attacking`, isHome };
}

// ── Pitch simulation engine ───────────────────────────────────────────────────
// Logical coordinate space: X ∈ [-100, 100] (left goal = -100, right = 100)
//                           Y ∈ [-50, 50]
// SVG viewport: 0 0 400 200 - mapping: svgX = (lx+100)*2, svgY = (ly+50)*2

const toSVG = (lx: number, ly: number) => ({ x: (lx + 100) * 2, y: (ly + 50) * 2 });

type PitchPhase =
  | 'neutral'
  | 'ball_safe_home'
  | 'ball_safe_away'
  | 'attack_home'
  | 'attack_away'
  | 'pressure_home'
  | 'pressure_away'
  | 'throw_home'
  | 'throw_away'
  | 'free_kick_home'
  | 'free_kick_away'
  | 'foul_home'
  | 'foul_away'
  | 'offside_home'
  | 'offside_away'
  | 'danger_home'
  | 'danger_away'
  | 'shot_on_home'
  | 'shot_on_away'
  | 'shot_off_home'
  | 'shot_off_away'
  | 'goal_kick_home'
  | 'goal_kick_away'
  | 'corner_home'
  | 'corner_away';

function eventToPhase(ev: MatchEvent): PitchPhase {
  if (ev.type === 'goal_home') return 'danger_home';
  if (ev.type === 'goal_away') return 'danger_away';
  if (ev.type === 'shot_on_home') return 'shot_on_home';
  if (ev.type === 'shot_on_away') return 'shot_on_away';
  if (ev.type === 'shot_off_home' || ev.type === 'shot_home') return 'shot_off_home';
  if (ev.type === 'shot_off_away' || ev.type === 'shot_away') return 'shot_off_away';
  if (ev.type === 'goal_kick_home') return 'goal_kick_home';
  if (ev.type === 'goal_kick_away') return 'goal_kick_away';
  if (ev.type === 'corner_home') return 'corner_home';
  if (ev.type === 'corner_away') return 'corner_away';
  if (ev.type === 'safe_home') return 'ball_safe_home';
  if (ev.type === 'safe_away') return 'ball_safe_away';
  if (ev.type === 'attack_home') return 'attack_home';
  if (ev.type === 'attack_away') return 'attack_away';
  if (ev.type === 'pressure_home') return 'pressure_home';
  if (ev.type === 'pressure_away') return 'pressure_away';
  if (ev.type === 'throw_home') return 'throw_home';
  if (ev.type === 'throw_away') return 'throw_away';
  if (ev.type === 'free_kick_home') return 'free_kick_home';
  if (ev.type === 'free_kick_away') return 'free_kick_away';
  if (ev.type === 'foul_home') return 'foul_home';
  if (ev.type === 'foul_away') return 'foul_away';
  if (ev.type === 'offside_home') return 'offside_home';
  if (ev.type === 'offside_away') return 'offside_away';
  if (ev.type === 'kickoff' || ev.type === 'second_half') return 'ball_safe_home';
  return 'neutral';
}

function wanderTarget(phase: PitchPhase, poss: number): { lx: number; ly: number } {
  const r1 = Math.random(), r2 = Math.random();
  if (phase === 'danger_home') return { lx: 68 + r1 * 24,   ly: (r2 - 0.5) * 52 };
  if (phase === 'danger_away') return { lx: -68 - r1 * 24,  ly: (r2 - 0.5) * 52 };
  if (phase === 'shot_on_home') return { lx: 90 + r1 * 6,   ly: (r2 - 0.5) * 26 };
  if (phase === 'shot_on_away') return { lx: -90 - r1 * 6,  ly: (r2 - 0.5) * 26 };
  if (phase === 'shot_off_home') return { lx: 97,            ly: (r2 > 0.5 ? 1 : -1) * (24 + r1 * 20) };
  if (phase === 'shot_off_away') return { lx: -97,           ly: (r2 > 0.5 ? 1 : -1) * (24 + r1 * 20) };
  if (phase === 'goal_kick_home') return { lx: -86 + r1 * 8, ly: (r2 - 0.5) * 20 };
  if (phase === 'goal_kick_away') return { lx: 86 - r1 * 8,  ly: (r2 - 0.5) * 20 };
  if (phase === 'corner_home') return { lx: 97,              ly: r2 > 0.5 ? -46 : 46 };
  if (phase === 'corner_away') return { lx: -97,             ly: r2 > 0.5 ? -46 : 46 };
  if (phase === 'pressure_home') return { lx: 46 + r1 * 28,   ly: (r2 - 0.5) * 56 };
  if (phase === 'pressure_away') return { lx: -46 - r1 * 28,  ly: (r2 - 0.5) * 56 };
  if (phase === 'attack_home') return { lx: 18 + r1 * 44,     ly: (r2 - 0.5) * 68 };
  if (phase === 'attack_away') return { lx: -18 - r1 * 44,    ly: (r2 - 0.5) * 68 };
  if (phase === 'throw_home') return { lx: 20 + r1 * 44,       ly: r2 > 0.5 ? -48 : 48 };
  if (phase === 'throw_away') return { lx: -20 - r1 * 44,      ly: r2 > 0.5 ? -48 : 48 };
  if (phase === 'free_kick_home') return { lx: 42 + r1 * 24,   ly: (r2 - 0.5) * 44 };
  if (phase === 'free_kick_away') return { lx: -42 - r1 * 24,  ly: (r2 - 0.5) * 44 };
  if (phase === 'foul_home') return { lx: 4 + r1 * 38,         ly: (r2 - 0.5) * 64 };
  if (phase === 'foul_away') return { lx: -4 - r1 * 38,        ly: (r2 - 0.5) * 64 };
  if (phase === 'offside_home') return { lx: 72 + r1 * 12,     ly: (r2 - 0.5) * 48 };
  if (phase === 'offside_away') return { lx: -72 - r1 * 12,    ly: (r2 - 0.5) * 48 };
  if (phase === 'ball_safe_home') return { lx: -58 + r1 * 34, ly: (r2 - 0.5) * 58 };
  if (phase === 'ball_safe_away') return { lx: 58 - r1 * 34,  ly: (r2 - 0.5) * 58 };
  // possession-biased midfield wander
  const bias = ((poss - 50) / 100) * 38;
  return { lx: bias + (r1 - 0.5) * 55, ly: (r2 - 0.5) * 75 };
}

const HOME_SHAPE = [
  { lx: -72, ly: -28 }, { lx: -72, ly: 28 }, { lx: -34, ly: -6 },
  { lx: -28, ly: 30 }, { lx: 4, ly: -24 }, { lx: 16, ly: 20 },
];

const AWAY_SHAPE = HOME_SHAPE.map(p => ({ lx: -p.lx, ly: p.ly }));

function Pitch({ fixture, state, freeze }: { fixture: Fixture; state: MatchState; freeze: boolean }) {
  const smoothRef    = useRef({ lx: -48, ly: 0 });
  const targetRef    = useRef({ lx: -30, ly: 0 });
  const possRef      = useRef(state.possession);
  const phaseRef     = useRef<PitchPhase>('neutral');
  const eventLenRef  = useRef(state.events.length);
  const freezeRef    = useRef(freeze);
  const setPieceHoldRef = useRef(0);
  const holdTimerRef = useRef<number | null>(null);

  const [renderPos, setRenderPos] = useState({ lx: 0, ly: 0 });
  const [trail, setTrail]         = useState<{ lx: number; ly: number }[]>([]);
  const [phase, setPhase]         = useState<PitchPhase>('neutral');
  const [actionText, setActionText] = useState<{ text: string; isHome: boolean } | null>(null);
  const [bannerEv, setBannerEv] = useState<{ text: string; isHome: boolean; lx: number; ly: number; key: number } | null>(null);
  const bannerTimeoutRef = useRef<number | null>(null);
  const actionTimeoutRef = useRef<number | null>(null);
  const bannerKeyRef = useRef(0);

  useEffect(() => { possRef.current = state.possession; }, [state.possession]);
  useEffect(() => { freezeRef.current = freeze; }, [freeze]);

  // On goal freeze end: snap ball back to kickoff center
  useEffect(() => {
    if (!freeze) {
      smoothRef.current = { lx: 0, ly: 0 };
      targetRef.current = { lx: 0, ly: 0 };
      phaseRef.current  = 'neutral';
      setPhase('neutral');
      setTrail([]);
    }
  }, [freeze]);

  // New event -> update phase + target + action label
  useEffect(() => {
    if (state.events.length === eventLenRef.current) return;
    eventLenRef.current = state.events.length;
    const ev = state.events[state.events.length - 1];
    if (!ev) return;
    const p = eventToPhase(ev);
    phaseRef.current = p;
    setPhase(p);
    if (ev.lx !== undefined && ev.ly !== undefined) {
      targetRef.current = { lx: ev.lx, ly: ev.ly };
    } else {
      targetRef.current = wanderTarget(p, possRef.current);
    }
    if (isStoppageEvent(ev.type)) {
      setPieceHoldRef.current = Date.now() + 7000;
      if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        setActionText(null);
        holdTimerRef.current = null;
      }, 7000) as unknown as number;
    }
    const label = getActionLabel(ev, fixture.home.code, fixture.away.code);
    setActionText(label);
    if (actionTimeoutRef.current !== null) {
      clearTimeout(actionTimeoutRef.current);
      actionTimeoutRef.current = null;
    }
    if (label && ev.lx !== undefined && ev.ly !== undefined) {
      if (bannerTimeoutRef.current !== null) clearTimeout(bannerTimeoutRef.current);
      setBannerEv({ text: label.text, isHome: label.isHome, lx: ev.lx, ly: ev.ly, key: ++bannerKeyRef.current });
      bannerTimeoutRef.current = setTimeout(() => setBannerEv(null), ev.type === 'goal_home' || ev.type === 'goal_away' ? 5000 : 1300) as unknown as number;
    }
  }, [state.events.length, fixture.home.code, fixture.away.code]);

  // Wander: new waypoint every 1.8 s, stays near current zone
  useEffect(() => {
    const id = setInterval(() => {
      if (freezeRef.current) return;
      if (Date.now() < setPieceHoldRef.current) return;
      targetRef.current = wanderTarget(phaseRef.current, possRef.current);
    }, 900);
    return () => clearInterval(id);
  }, []);

  // Physics: lerp at 20 fps
  useEffect(() => {
    const id = setInterval(() => {
      if (freezeRef.current) return;
      const s = smoothRef.current, t = targetRef.current;
      const p = phaseRef.current;
      const speed = p.startsWith('ball_safe') ? 0.105
        : p.startsWith('attack') || p.startsWith('pressure') || p.startsWith('danger') || p.startsWith('shot_on') || p.startsWith('shot_off') ? 0.255
        : p.startsWith('corner') || p.startsWith('throw') || p.startsWith('free_kick') || p.startsWith('goal_kick') ? 0.14
        : p.startsWith('foul') || p.startsWith('offside') ? 0.12
        : 0.17;
      s.lx += (t.lx - s.lx) * speed;
      s.ly += (t.ly - s.ly) * speed;
      setRenderPos({ lx: s.lx, ly: s.ly });
    }, 33);
    return () => clearInterval(id);
  }, []);

  // Trail: sample every 300 ms
  useEffect(() => {
    const id = setInterval(() => {
      if (freezeRef.current) return;
      setTrail(prev => [...prev.slice(-11), { lx: smoothRef.current.lx, ly: smoothRef.current.ly }]);
    }, 170);
    return () => clearInterval(id);
  }, []);

  const bp = toSVG(renderPos.lx, renderPos.ly);
  const radarSpread = 44;
  const isInStoppage = Date.now() < setPieceHoldRef.current;
  const displayLabel = actionText ?? (!isInStoppage && state.status === 'live'
    ? {
      text: `${state.possession >= 50 ? fixture.home.code : fixture.away.code} - Ball Safe`,
      isHome: state.possession >= 50,
    }
    : null);
  const isAttackPhase = phase === 'attack_home' || phase === 'attack_away' || phase === 'pressure_home' || phase === 'pressure_away';
  const isSetPiecePhase = phase.startsWith('corner') || phase.startsWith('throw') || phase.startsWith('free_kick') || phase.startsWith('goal_kick') || phase.startsWith('foul') || phase.startsWith('offside');
  const isDangerPhase = phase === 'danger_home' || phase === 'danger_away' || phase === 'corner_home' || phase === 'corner_away' || phase.startsWith('shot_on') || phase.startsWith('shot_off');
  const isSafePhase = phase === 'ball_safe_home' || phase === 'ball_safe_away';
  const shadowRx = isDangerPhase ? 64 : isAttackPhase ? 56 : isSetPiecePhase ? 38 : 44;
  const shadowRy = isDangerPhase ? 30 : isAttackPhase ? 28 : isSetPiecePhase ? 20 : 23;
  const shadowFill = isDangerPhase ? 'rgba(12,74,110,0.28)' : isAttackPhase ? 'rgba(15,118,110,0.24)' : isSetPiecePhase ? 'rgba(15,23,42,0.28)' : 'rgba(15,23,42,0.20)';
  const timelineEvents = state.events
    .filter(ev => ev.type.startsWith('goal') || ev.type.startsWith('shot') || ev.type.startsWith('yellow') || ev.type.startsWith('red') || ev.type.startsWith('corner') || ev.type.startsWith('safe') || ev.type.startsWith('attack') || ev.type.startsWith('pressure') || ev.type.startsWith('throw') || ev.type.startsWith('free_kick') || ev.type.startsWith('foul') || ev.type.startsWith('offside') || ev.type.startsWith('sub'))
    .slice(-8);
  const statusLabel = state.status === 'half_time' ? 'HALF TIME'
    : state.status === 'finished' ? 'FULL TIME'
    : null;
  const activeShape = state.possession >= 50 ? HOME_SHAPE : AWAY_SHAPE;
  const homeSquad = getSquad(fixture.home);
  const awaySquad = getSquad(fixture.away);

  return (
    <div>
      <svg viewBox="0 0 400 224" className="w-full overflow-hidden rounded-lg border dark:border-zinc-800 border-zinc-200 bg-emerald-950">
        <defs>
          <linearGradient id="fanvibe-turf" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#12813f" />
            <stop offset="46%" stopColor="#1da454" />
            <stop offset="100%" stopColor="#0f7438" />
          </linearGradient>
          <pattern id="pitchGrain" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M0 6H12 M6 0V12" stroke="rgba(255,255,255,0.035)" strokeWidth="0.5" />
          </pattern>
          <radialGradient id="ballGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="white" stopOpacity="0.95" />
            <stop offset="45%" stopColor="white" stopOpacity="0.32" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ballFace" cx="36%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="58%" stopColor="#f4f4f5" />
            <stop offset="100%" stopColor="#d4d4d8" />
          </radialGradient>
          <filter id="softShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#001b0b" floodOpacity="0.35" />
          </filter>
          <filter id="pressureBlur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        {/* Pitch - alternating stripe turf */}
        <rect width="400" height="200" fill="url(#fanvibe-turf)" />
        {[0,1,2,3,4,5,6,7,8,9].map(i => (
          <rect key={i} x={i * 40} y="0" width="20" height="200" fill={i % 2 ? '#30c66a' : '#0b6531'} opacity={i % 2 ? 0.20 : 0.18} />
        ))}
        <rect width="400" height="200" fill="url(#pitchGrain)" />
        <ellipse
          cx={bp.x}
          cy={bp.y}
          rx={shadowRx}
          ry={shadowRy}
          fill={shadowFill}
          filter="url(#pressureBlur)"
          style={{ transition: 'cx 140ms linear, cy 140ms linear, rx 260ms ease, ry 260ms ease, fill 260ms ease' }}
        />

        {isSafePhase && (
          <ellipse
            cx={bp.x}
            cy={bp.y}
            rx="36"
            ry="19"
            fill="rgba(15,23,42,0.13)"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="0.8"
            style={{ animation: 'radarPulse 1.25s ease-in-out infinite' }}
          />
        )}

        {/* Radar beams: directional arrow from goal mouth toward ball in danger zone */}
        {phase === 'danger_home' && (
          <>
            <polygon
              points={`396,100 ${bp.x},${Math.max(16, bp.y - radarSpread)} ${bp.x},${Math.min(184, bp.y + radarSpread)}`}
              fill="rgba(239,68,68,0.11)" stroke="rgba(239,68,68,0.32)" strokeWidth="0.7"
              style={{ animation: 'radarPulse 0.85s ease-in-out infinite' }}
            />
            <line x1="396" y1="100" x2={bp.x} y2={bp.y}
              stroke="rgba(239,68,68,0.5)" strokeWidth="1" strokeDasharray="4 3"
              style={{ animation: 'radarPulse 0.85s ease-in-out infinite 0.42s' }}
            />
          </>
        )}
        {phase === 'danger_away' && (
          <>
            <polygon
              points={`4,100 ${bp.x},${Math.max(16, bp.y - radarSpread)} ${bp.x},${Math.min(184, bp.y + radarSpread)}`}
              fill="rgba(59,130,246,0.11)" stroke="rgba(59,130,246,0.32)" strokeWidth="0.7"
              style={{ animation: 'radarPulse 0.85s ease-in-out infinite' }}
            />
            <line x1="4" y1="100" x2={bp.x} y2={bp.y}
              stroke="rgba(59,130,246,0.5)" strokeWidth="1" strokeDasharray="4 3"
              style={{ animation: 'radarPulse 0.85s ease-in-out infinite 0.42s' }}
            />
          </>
        )}

        {isDangerPhase && (
          <>
            {[0, 1, 2].map(i => {
              const sweep = phase === 'danger_home' || phase === 'corner_home' ? 1 : -1;
              const x1 = sweep > 0 ? 348 - i * 14 : 52 + i * 14;
              const cx = Math.max(40, Math.min(360, bp.x + sweep * (20 + i * 16)));
              const cy = Math.max(24, Math.min(176, bp.y + (i - 1) * 18));
              return (
                <path
                  key={i}
                  d={`M ${x1} ${96 + i * 7} Q ${cx} ${cy} ${bp.x} ${bp.y}`}
                  fill="none"
                  stroke={sweep > 0 ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.28)'}
                  strokeWidth="0.8"
                  strokeDasharray="3 4"
                  style={{ animation: `radarPulse 1s ease-in-out infinite ${i * 0.12}s` }}
                />
              );
            })}
          </>
        )}

        {/* Pitch markings */}
        <rect x="8" y="8" width="384" height="184" fill="none" stroke="rgba(255,255,255,0.46)" strokeWidth="1.15" />
        <line x1="200" y1="8" x2="200" y2="192" stroke="rgba(255,255,255,0.44)" strokeWidth="1.15" />
        <circle cx="200" cy="100" r="31" fill="none" stroke="rgba(255,255,255,0.44)" strokeWidth="1.15" />
        <circle cx="200" cy="100" r="2" fill="rgba(255,255,255,0.5)" />
        <rect x="8" y="54" width="58" height="92" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.05" />
        <rect x="8" y="73" width="24" height="54" fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth="0.95" />
        <rect x="334" y="54" width="58" height="92" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.05" />
        <rect x="368" y="73" width="24" height="54" fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth="0.95" />
        <rect x="4" y="82" width="8" height="36" fill="none" stroke="rgba(255,255,255,0.48)" strokeWidth="1.5" />
        <rect x="388" y="82" width="8" height="36" fill="none" stroke="rgba(255,255,255,0.48)" strokeWidth="1.5" />

        {activeShape.map((p, i) => {
          const dot = toSVG(p.lx, p.ly);
          const homeSide = state.possession >= 50;
          return (
            <g key={`${homeSide ? 'h' : 'a'}-${i}`} opacity="0.88" filter="url(#softShadow)">
              <circle cx={dot.x} cy={dot.y} r="4.2" fill={homeSide ? '#16a34a' : '#0284c7'} stroke="rgba(255,255,255,0.62)" strokeWidth="0.8" />
              <circle cx={dot.x} cy={dot.y} r="1.2" fill="white" opacity="0.7" />
            </g>
          );
        })}

        {/* Comet trail: fading line segments, thicker + brighter toward head */}
        {trail.length > 1 && trail.map((pt, i) => {
          if (i === 0) return null;
          const a = toSVG(trail[i-1].lx, trail[i-1].ly);
          const b = toSVG(pt.lx, pt.ly);
          const op = (i / trail.length) * 0.72;
          const sw = 0.8 + (i / trail.length) * 2.1;
          return (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="rgba(255,255,255,0.92)" strokeWidth={sw} strokeOpacity={op} strokeLinecap="round" />
          );
        })}

        {/* Ball - 60 ms CSS transition bridges 20 fps setState gaps */}
        <g style={{ transform: `translate(${bp.x}px,${bp.y}px)`, transition: 'transform 60ms linear' }} filter="url(#softShadow)">
          <circle cx="0" cy="0" r={isDangerPhase ? 12 : 9} fill="url(#ballGlow)" opacity={isDangerPhase ? 0.70 : 0.38} />
          <circle cx="0" cy="0" r="5.3" fill="url(#ballFace)" opacity="0.99" />
          <path d="M -1.8 -4.3 L 2.3 -2.8 L 3.8 1.4 L 0.1 4 L -3.5 1.8 L -3.4 -2.3 Z" fill="rgba(24,24,27,0.78)" />
          <path d="M -5.2 -0.6 L -3.4 -2.3 M -3.5 1.8 L -5 3.1 M 3.8 1.4 L 5.2 2.4 M 2.3 -2.8 L 3.8 -4.2 M 0.1 4 L 0.3 5.2" stroke="rgba(24,24,27,0.7)" strokeWidth="0.75" strokeLinecap="round" />
          <circle cx="0" cy="0" r="5.3" fill="none" stroke="rgba(0,0,0,0.46)" strokeWidth="0.75" />
          <circle cx="-2" cy="-2.1" r="1" fill="rgba(255,255,255,0.76)" />
        </g>

        {/* Floating event banner at event pitch coordinates */}
        {bannerEv && !freeze && (() => {
          const bpos = toSVG(bannerEv.lx, bannerEv.ly);
          const bx = Math.max(58, Math.min(342, bpos.x));
          const by = Math.max(22, Math.min(175, bpos.y - 16));
          return (
            <g key={bannerEv.key} style={{ animation: 'bannerFade 2.8s ease-out forwards' }}>
              <text x={bx} y={by - 1} textAnchor="middle" fill="white"
                fontSize="7.8" fontFamily={BROADCAST_FONT} fontWeight="800"
                stroke="rgba(2,6,23,0.86)" strokeWidth="2.8" paintOrder="stroke">
                {bannerEv.text.toUpperCase()}
              </text>
            </g>
          );
        })()}

        {/* Action callout */}
        {displayLabel && !freeze && (() => {
          const bx = Math.max(58, Math.min(342, bp.x + (displayLabel.isHome ? -22 : 22)));
          const by = Math.max(28, Math.min(172, bp.y - 22));
          const parts = displayLabel.text.split(' - ');
          return (
            <g style={{ transition: 'transform 120ms linear' }}>
              <line
                x1={bp.x}
                y1={bp.y}
                x2={bx}
                y2={by + 10}
                stroke="rgba(255,255,255,0.26)"
                strokeWidth="0.65"
                strokeDasharray="2 3"
              />
              <text x={bx} y={by - 1} textAnchor="middle"
                fill="rgba(255,255,255,0.98)" fontSize="7.8" fontFamily={BROADCAST_FONT} fontWeight="800"
                stroke="rgba(2,6,23,0.88)" strokeWidth="2.9" paintOrder="stroke">
                {parts[0]}
              </text>
              <text x={bx} y={by + 9} textAnchor="middle"
                fill="rgba(255,255,255,0.86)" fontSize="6.8" fontFamily={BROADCAST_FONT} fontWeight="600"
                stroke="rgba(2,6,23,0.82)" strokeWidth="2.4" paintOrder="stroke">
                {(parts[1] ?? 'In Possession').toUpperCase()}
              </text>
              {parts[2] && (
                <text x={bx} y={by + 18} textAnchor="middle"
                  fill="rgba(255,255,255,0.74)" fontSize="6.1" fontFamily={BROADCAST_FONT} fontWeight="600"
                  stroke="rgba(2,6,23,0.76)" strokeWidth="2.1" paintOrder="stroke">
                  {parts[2].toUpperCase()}
                </text>
              )}
            </g>
          );
        })()}

        {statusLabel && (
          <g>
            <rect x="156" y="82" width="88" height="36" rx="5" fill="rgba(12,19,26,0.72)" stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />
            <text x="200" y="97" textAnchor="middle" fill="white" fontSize="9" fontFamily={BROADCAST_FONT} fontWeight="800">
              {statusLabel}
            </text>
            <text x="200" y="110" textAnchor="middle" fill="rgba(255,255,255,0.66)" fontSize="7" fontFamily={BROADCAST_FONT} fontWeight="600">
              {fixture.home.code} {state.homeScore} - {state.awayScore} {fixture.away.code}
            </text>
          </g>
        )}

        {/* Team labels */}
        <text x="40" y="8" textAnchor="middle" fill="rgba(74,222,128,0.85)" fontSize="9" fontFamily={BROADCAST_FONT} fontWeight="800">
          {fixture.home.code}
        </text>
        <text x="360" y="8" textAnchor="middle" fill="rgba(125,211,252,0.9)" fontSize="9" fontFamily={BROADCAST_FONT} fontWeight="800">
          {fixture.away.code}
        </text>

        <g>
          <rect x="0" y="200" width="400" height="24" fill="rgba(10,15,23,0.74)" />
          <line x1="12" y1="211" x2="388" y2="211" stroke="rgba(255,255,255,0.20)" strokeWidth="1" />
          <rect x="12" y="209.5" width={Math.max(0, Math.min(376, (state.minute / 90) * 376))} height="3" rx="1.5" fill="rgba(34,197,94,0.95)" />
          {[0, 15, 30, 45, 60, 75, 90].map(m => (
            <g key={m}>
              <line x1={12 + (m / 90) * 376} y1="207" x2={12 + (m / 90) * 376} y2="215" stroke="rgba(255,255,255,0.28)" strokeWidth="0.7" />
              <text x={12 + (m / 90) * 376} y="222" textAnchor="middle" fill="rgba(255,255,255,0.42)" fontSize="5.8" fontFamily={BROADCAST_FONT} fontWeight="600">{m}</text>
            </g>
          ))}
          {timelineEvents.map(ev => {
            const x = 12 + (Math.max(0, Math.min(90, ev.minute)) / 90) * 376;
            const color = ev.type === 'goal_home' || ev.type === 'goal_away' ? '#22c55e'
              : ev.type.startsWith('safe') ? '#e5e7eb'
              : ev.type.startsWith('shot_on') ? '#f8fafc'
              : ev.type.startsWith('shot_off') || ev.type.startsWith('goal_kick') ? '#94a3b8'
              : ev.type.startsWith('corner') ? '#38bdf8'
              : ev.type.startsWith('red') ? '#ef4444'
              : ev.type.startsWith('sub') ? '#a1a1aa'
              : '#facc15';
            return <circle key={ev.id} cx={x} cy="211" r="3" fill={color} stroke="rgba(0,0,0,0.45)" strokeWidth="0.8" />;
          })}
        </g>
      </svg>

      {/* Possession bar */}
      <div className="mt-2.5 flex items-center gap-0 overflow-hidden rounded-full dark:bg-zinc-800 bg-zinc-200 h-2">
        <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${state.possession}%` }} />
        <div className="h-full bg-zinc-500 flex-1 transition-all duration-1000" />
      </div>
      <div className="flex justify-between mt-0.5 text-[10px] font-semibold" style={{ fontFamily: BROADCAST_FONT }}>
        <span className="text-emerald-500">{fixture.home.code} {state.possession}%</span>
        <span className="dark:text-zinc-500 text-zinc-400 text-[9px] font-normal">POSSESSION</span>
        <span className="text-zinc-500">{100 - state.possession}% {fixture.away.code}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950/70 bg-zinc-50 px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wide dark:text-zinc-500 text-zinc-400" style={{ fontFamily: BROADCAST_FONT }}>{fixture.home.code} Coach</div>
          <div className="mt-0.5 truncate text-xs font-semibold dark:text-zinc-100 text-zinc-900">{homeSquad.coach}</div>
        </div>
        <div className="rounded-md border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950/70 bg-zinc-50 px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wide dark:text-zinc-500 text-zinc-400" style={{ fontFamily: BROADCAST_FONT }}>{fixture.away.code} Coach</div>
          <div className="mt-0.5 truncate text-xs font-semibold dark:text-zinc-100 text-zinc-900">{awaySquad.coach}</div>
        </div>
      </div>
    </div>
  );
}

// ── Stats tab - Sportybet style ───────────────────────────────────────────────

function StatRow({ label, home, away }: { label: string; home: number; away: number }) {
  const total = Math.max(home + away, 1);
  const hw = Math.round((home / total) * 100);
  const aw = Math.round((away / total) * 100);
  return (
    <div className="grid grid-cols-[32px_1fr_110px_1fr_32px] items-center gap-1.5">
      <span className="text-right text-sm font-bold dark:text-zinc-200 text-zinc-800 tabular-nums">{home}</span>
      <div className="flex justify-end h-1.5">
        <div className="rounded-l-full bg-emerald-500 transition-all duration-700 h-full" style={{ width: `${hw}%` }} />
      </div>
      <span className="text-center text-[10px] dark:text-zinc-500 text-zinc-500 uppercase tracking-wide leading-tight">
        {label}
      </span>
      <div className="flex justify-start h-1.5">
        <div className="rounded-r-full bg-red-500 transition-all duration-700 h-full" style={{ width: `${aw}%` }} />
      </div>
      <span className="text-left text-sm font-bold dark:text-zinc-200 text-zinc-800 tabular-nums">{away}</span>
    </div>
  );
}

function StatsPanel({ fixture, state }: { fixture: Fixture; state: MatchState }) {
  const st = computeStats(state.events);
  return (
    <div className="space-y-3">
      {/* Team header */}
      <div className="grid grid-cols-[32px_1fr_110px_1fr_32px] items-center gap-1.5 mb-1">
        <div />
        <div className="flex justify-end">
          <span className="text-[11px] font-semibold text-emerald-500">{fixture.home.code}</span>
        </div>
        <div />
        <div className="flex justify-start">
          <span className="text-[11px] font-semibold text-zinc-500">{fixture.away.code}</span>
        </div>
        <div />
      </div>
      <StatRow label="Shots on Target" home={st.shotsOn.home}    away={st.shotsOn.away} />
      <StatRow label="Shots off Target" home={st.shotsOff.home}  away={st.shotsOff.away} />
      <StatRow label="Total Shots"      home={st.totalShots.home} away={st.totalShots.away} />
      <StatRow label="Dangerous Attacks" home={st.dangerous.home} away={st.dangerous.away} />
      <StatRow label="Corner Kicks"     home={st.corners.home}   away={st.corners.away} />
      <StatRow label="Fouls"            home={st.fouls.home}     away={st.fouls.away} />
      <StatRow label="Cards"            home={st.cards.home}     away={st.cards.away} />
      {/* Possession row */}
      <div className="grid grid-cols-[32px_1fr_110px_1fr_32px] items-center gap-1.5">
        <span className="text-right text-sm font-bold text-emerald-500 tabular-nums">{state.possession}%</span>
        <div className="flex justify-end h-1.5">
          <div className="rounded-l-full bg-emerald-500 h-full" style={{ width: `${state.possession}%` }} />
        </div>
        <span className="text-center text-[10px] dark:text-zinc-500 text-zinc-500 uppercase tracking-wide">Possession</span>
        <div className="flex justify-start h-1.5">
          <div className="rounded-r-full bg-red-500 h-full" style={{ width: `${100 - state.possession}%` }} />
        </div>
        <span className="text-left text-sm font-bold text-zinc-500 tabular-nums">{100 - state.possession}%</span>
      </div>
    </div>
  );
}

// ── Commentary ────────────────────────────────────────────────────────────────

function CommentaryFeed({ state }: { state: MatchState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [state.events.length]);

  const isGoal = (t: string) => t === 'goal_home' || t === 'goal_away' || t === 'var';
  const isCard = (t: string) => t.startsWith('yellow') || t.startsWith('red');

  return (
    <div ref={ref} className="h-44 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
      {state.events.length === 0 && (
        <p className="text-xs dark:text-zinc-500 text-zinc-400 text-center pt-10">Waiting for kick off...</p>
      )}
      {[...state.events].reverse().map(ev => (
        <div key={ev.id} className={`flex items-start gap-2 text-xs rounded-lg px-2.5 py-1.5
          ${isGoal(ev.type)
            ? 'dark:bg-emerald-500/10 bg-emerald-50 border dark:border-emerald-500/20 border-emerald-200'
            : isCard(ev.type)
            ? 'dark:bg-zinc-900 bg-zinc-50 border dark:border-zinc-800 border-zinc-200'
            : 'dark:bg-zinc-900/50 bg-zinc-50 border border-transparent'}`}>
          <span className=" dark:text-zinc-500 text-zinc-400 shrink-0 w-7 text-right tabular-nums">{ev.minute}'</span>
          <span className={`leading-snug font-medium ${
            isGoal(ev.type) ? 'dark:text-emerald-300 text-emerald-700 font-semibold' :
            isCard(ev.type) ? 'dark:text-zinc-300 text-zinc-700' :
            'dark:text-zinc-300 text-zinc-700'}`}>
            {ev.commentary}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Match Chat ────────────────────────────────────────────────────────────────

function SquadPanel({ fixture, state }: { fixture: Fixture; state: MatchState }) {
  const renderTeam = (side: 'home' | 'away') => {
    const team = side === 'home' ? fixture.home : fixture.away;
    const squad = getSquad(team);
    const subEvents = state.events.filter(ev => ev.team === side && ev.type.startsWith('sub'));
    const playersOn = new Set(subEvents.map(ev => ev.player).filter(Boolean) as string[]);
    const playersOff = new Set(subEvents.map(ev => ev.player2).filter(Boolean) as string[]);
    const starters = [
      ...squad.starters.filter(player => !playersOff.has(player.name)),
      ...squad.substitutes.filter(player => playersOn.has(player.name)),
    ];
    const substitutes = [
      ...squad.substitutes.filter(player => !playersOn.has(player.name)),
      ...squad.starters.filter(player => playersOff.has(player.name)),
    ];
    const incidentMap = state.events.reduce<Record<string, string[]>>((acc, ev) => {
      if (ev.team !== side || !ev.player) return acc;
      const label = ev.type === 'goal_home' || ev.type === 'goal_away' ? 'Goal'
        : ev.type.startsWith('shot_on') ? 'SOT'
        : ev.type.startsWith('shot_off') ? 'Shot off'
        : ev.type.startsWith('yellow') ? 'Yellow'
        : ev.type.startsWith('red') ? 'Red'
        : ev.type.startsWith('foul') ? 'Foul'
        : ev.type.startsWith('offside') ? 'Offside'
        : ev.type.startsWith('sub') ? 'On'
        : '';
      if (label) acc[ev.player] = [...(acc[ev.player] ?? []), label];
      if (ev.type.startsWith('sub') && ev.player2) acc[ev.player2] = [...(acc[ev.player2] ?? []), 'Off'];
      return acc;
    }, {});

    const PlayerRow = ({ player, muted = false }: { player: typeof starters[number]; muted?: boolean }) => (
      <div className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${muted ? 'dark:bg-zinc-900/35 bg-zinc-50' : 'dark:bg-zinc-900/70 bg-white border dark:border-zinc-800 border-zinc-200'}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="w-5 text-right text-[10px] dark:text-zinc-500 text-zinc-400 tabular-nums">{player.no}</span>
          <span className="w-6 text-[10px] dark:text-zinc-500 text-zinc-400">{player.pos}</span>
          <span className={`truncate text-xs font-medium ${muted ? 'dark:text-zinc-500 text-zinc-400' : 'dark:text-zinc-200 text-zinc-800'}`}>{player.name}</span>
        </div>
        {incidentMap[player.name]?.length ? (
          <span className="shrink-0 text-[9px] font-semibold dark:text-emerald-300 text-emerald-700">
            {incidentMap[player.name].slice(-2).join(', ')}
          </span>
        ) : null}
      </div>
    );

    if (squad.officialPending) {
      return (
        <div className="min-w-0 rounded-md border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950/70 bg-zinc-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <TeamFlag iso={team.iso} fallback={team.flag} className="h-4 w-6" />
              <span className="text-xs font-bold dark:text-zinc-100 text-zinc-900">{team.code}</span>
            </div>
            <span className="truncate text-[10px] dark:text-zinc-500 text-zinc-400">{squad.coach}</span>
          </div>
          <p className="text-xs leading-relaxed dark:text-zinc-400 text-zinc-600">
            Official FIFA squad list pending June 2. Player rows will appear here once the final roster is loaded.
          </p>
        </div>
      );
    }

    return (
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <TeamFlag iso={team.iso} fallback={team.flag} className="h-4 w-6" />
            <span className="text-xs font-bold dark:text-zinc-100 text-zinc-900">{team.code}</span>
          </div>
          <span className="truncate text-[10px] dark:text-zinc-500 text-zinc-400">{squad.coach}</span>
        </div>
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-wide dark:text-zinc-500 text-zinc-400">Playing XI</div>
          {starters.map(player => <PlayerRow key={`${team.code}-xi-${player.no}-${player.name}`} player={player} />)}
        </div>
        <div className="mt-3 space-y-1">
          <div className="text-[9px] uppercase tracking-wide dark:text-zinc-500 text-zinc-400">Substitutes</div>
          {substitutes.map(player => <PlayerRow key={`${team.code}-sub-${player.no}-${player.name}`} player={player} muted />)}
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 max-h-[58vh] overflow-y-auto pr-1 scrollbar-thin">
      {renderTeam('home')}
      {renderTeam('away')}
    </div>
  );
}

function MatchChat({ fixtureId }: { fixtureId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [user, setUser] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND_HTTP}/comments/${fixtureId}`);
      setComments(await r.json());
    } catch { /* offline */ }
  }, [fixtureId]);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [comments.length]);

  const joinChat = () => {
    const n = nameInput.trim();
    if (!n) return;
    setUser(n);
  };

  const post = async () => {
    if (!user || !text.trim() || posting) return;
    setPosting(true);
    try {
      await fetch(`${BACKEND_HTTP}/comments/${fixtureId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: user, text: text.trim() }),
      });
      setText('');
      await load();
    } finally { setPosting(false); }
  };

  if (!user) {
    return (
      <div className="dark:bg-zinc-900/60 bg-zinc-50 rounded-xl p-4 border dark:border-zinc-800 border-zinc-200">
        <p className="text-sm font-semibold dark:text-zinc-200 text-zinc-800 mb-3">Join the match chat</p>
        <div className="flex gap-2">
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && joinChat()}
            placeholder="Pick a display name..."
            className="flex-1 text-sm px-3 py-2 rounded-lg dark:bg-zinc-800 bg-white border dark:border-zinc-700 border-zinc-200 dark:text-zinc-100 text-zinc-900 dark:placeholder-zinc-600 placeholder-zinc-400 focus:outline-none focus:ring-1 dark:focus:ring-emerald-500/50 focus:ring-emerald-400 transition-all"
          />
          <button onClick={joinChat} disabled={!nameInput.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-black text-sm font-semibold disabled:opacity-40 hover:bg-emerald-400 transition-colors">
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] dark:text-zinc-500 text-zinc-400 uppercase tracking-widest">Match Chat</span>
        <button onClick={() => setUser(null)}
          className="text-[10px] dark:text-zinc-600 text-zinc-400 hover:dark:text-zinc-400 hover:text-zinc-600 transition-colors">
          {user}  - change
        </button>
      </div>
      <div ref={listRef} className="h-36 overflow-y-auto space-y-1 scrollbar-thin">
        {comments.length === 0 && (
          <p className="text-xs dark:text-zinc-600 text-zinc-400 text-center pt-10">No messages yet - be first!</p>
        )}
        {comments.map(c => (
          <div key={c.id} className="flex items-start gap-2 text-xs dark:bg-zinc-900/40 bg-zinc-50 rounded-lg px-2.5 py-1.5">
            <span className="font-semibold dark:text-emerald-400 text-emerald-600 shrink-0">{c.name}</span>
            <span className="dark:text-zinc-300 text-zinc-700 leading-snug">{c.text}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && post()} placeholder="Say something..." maxLength={280}
          className="flex-1 text-sm px-3 py-2 rounded-lg dark:bg-zinc-800 bg-white border dark:border-zinc-700 border-zinc-200 dark:text-zinc-100 text-zinc-900 dark:placeholder-zinc-600 placeholder-zinc-400 focus:outline-none focus:ring-1 dark:focus:ring-emerald-500/50 focus:ring-emerald-400 transition-all" />
        <button onClick={post} disabled={!text.trim() || posting}
          className="px-3 py-2 rounded-lg dark:bg-zinc-800 bg-zinc-100 border dark:border-zinc-700 border-zinc-200 dark:text-zinc-300 text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-700 hover:bg-zinc-200 transition-colors">
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

// ── MatchViewer ───────────────────────────────────────────────────────────────

type Tab = 'stats' | 'commentary' | 'squad' | 'chat';

interface GoalBanner { flag: string; iso: string; name: string; isHome: boolean; scorer?: string; }
interface Ticker { id: number; text: string; isGoal: boolean; isHome: boolean; }

export function MatchViewer({ fixture, matchState, onClose }: Props) {
  const isLive     = matchState.status === 'live';
  const isHalfTime = matchState.status === 'half_time';
  const isFinished = matchState.status === 'finished';
  const progress   = Math.min(100, (matchState.minute / 90) * 100);
  const [tab, setTab] = useState<Tab>('stats');

  // Goal celebrations + incident ticker
  const [goalOverlay, setGoalOverlay] = useState<GoalBanner | null>(null);
  const [scorePop, setScorePop]       = useState<'home' | 'away' | null>(null);
  const [tickers, setTickers]         = useState<Ticker[]>([]);
  const tickerIdRef = useRef(0);
  const goalLenRef  = useRef(matchState.events.length);

  useEffect(() => {
    if (matchState.events.length === goalLenRef.current) return;
    goalLenRef.current = matchState.events.length;
    const ev = matchState.events[matchState.events.length - 1];
    if (!ev) return;
    if (ev.type === 'goal_home') {
      setGoalOverlay({ flag: fixture.home.flag, iso: fixture.home.iso, name: fixture.home.name, isHome: true, scorer: ev.player });
      setScorePop('home');
      setTimeout(() => setScorePop(null), 900);
    } else if (ev.type === 'goal_away') {
      setGoalOverlay({ flag: fixture.away.flag, iso: fixture.away.iso, name: fixture.away.name, isHome: false, scorer: ev.player });
      setScorePop('away');
      setTimeout(() => setScorePop(null), 900);
    }

    // Incident ticker: goals + cards
    const isGoalEv = ev.type === 'goal_home' || ev.type === 'goal_away';
    const isCardEv = ev.type.startsWith('yellow') || ev.type.startsWith('red');
    if (isGoalEv || isCardEv) {
      const tid = ++tickerIdRef.current;
      const isHome = ev.team === 'home';
      const teamFlag = isHome ? fixture.home.flag : fixture.away.flag;
      const teamCode = isHome ? fixture.home.code : fixture.away.code;
      const player = ev.player ?? teamCode;
      const assist = isGoalEv && ev.player2 ? ` (${ev.player2})` : '';
      const text = isGoalEv
        ? `${teamFlag} GOAL! ${player}${assist}`
        : `${ev.type.startsWith('red') ? 'RED' : 'YELLOW'} ${player} (${teamCode})`;
      setTickers(prev => [...prev.slice(-3), { id: tid, text, isGoal: isGoalEv, isHome }]);
      setTimeout(() => setTickers(prev => prev.filter(t => t.id !== tid)), 5000);
    }
  }, [matchState.events.length, fixture.home.flag, fixture.home.name, fixture.away.flag, fixture.away.name, fixture.home.code, fixture.away.code]);

  const outcome = isFinished
    ? matchState.homeScore > matchState.awayScore ? 'home'
    : matchState.awayScore > matchState.homeScore ? 'away'
    : 'draw'
    : null;
  const homeCards = matchState.events.filter(ev => ev.team === 'home' && (ev.type.startsWith('yellow') || ev.type.startsWith('red')));
  const awayCards = matchState.events.filter(ev => ev.team === 'away' && (ev.type.startsWith('yellow') || ev.type.startsWith('red')));
  const homeScorers = matchState.events
    .filter(ev => ev.type === 'goal_home' && ev.player)
    .map(ev => `${ev.player} ${ev.minute}'`)
    .slice(-3);
  const awayScorers = matchState.events
    .filter(ev => ev.type === 'goal_away' && ev.player)
    .map(ev => `${ev.player} ${ev.minute}'`)
    .slice(-3);
  const CardBadges = ({ cards }: { cards: MatchEvent[] }) => (
    <div className="mt-1 flex min-h-[16px] justify-center gap-1">
      {cards.slice(-4).map(card => (
        <span
          key={card.id}
          title={card.player}
          className={`h-3.5 w-2.5 rounded-[2px] border border-black/20 shadow-sm ${card.type.startsWith('red') ? 'bg-red-500' : 'bg-yellow-400'}`}
        />
      ))}
    </div>
  );

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'stats',       label: 'Statistics',  icon: <BarChart2 size={12} /> },
    { id: 'commentary',  label: 'Commentary',  icon: <List size={12} /> },
    { id: 'squad',       label: 'Squad',        icon: <Users size={12} /> },
    { id: 'chat',        label: 'Chat',        icon: <MessageCircle size={12} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div className="relative z-10 w-full max-w-6xl max-h-[94vh] overflow-y-auto dark:bg-zinc-950 bg-white border dark:border-zinc-800 border-zinc-200 rounded-lg shadow-2xl animate-slide-in">

        {/* ── Header ── */}
        <div className="relative flex items-center justify-center px-5 pt-4 pb-3 border-b dark:border-zinc-800 border-zinc-100">
          <div className="text-sm font-semibold dark:text-zinc-100 text-zinc-900">
            <span>Live Match</span>
          </div>
          <div className="absolute right-5 top-1/2 -translate-y-1/2">
            <button onClick={onClose}
              className="p-1 rounded-lg dark:text-zinc-500 text-zinc-400 dark:hover:text-zinc-200 hover:text-zinc-800 transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── Score ── */}
        <div className="flex items-center justify-center gap-8 py-4">
          <div className="text-center min-w-[68px]">
            <TeamFlag iso={fixture.home.iso} fallback={fixture.home.flag} className="mx-auto mb-2 h-8 w-12" />
            {homeScorers.length > 0 && (
              <div className="mx-auto mb-1 max-w-[116px] space-y-0.5">
                {homeScorers.map((name, idx) => (
                  <div key={`${name}-${idx}`} className="truncate text-[10px] font-bold text-emerald-600 dark:text-emerald-300">
                    {name}
                  </div>
                ))}
              </div>
            )}
            <CardBadges cards={homeCards} />
            <div className="text-xs font-semibold dark:text-zinc-300 text-zinc-700 truncate">{fixture.home.name}</div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="text-5xl font-black tabular-nums leading-none inline-block transition-colors duration-300"
              style={scorePop === 'home'
                ? { animation: 'scorePop 0.9s ease-out forwards', color: '#34d399', filter: 'drop-shadow(0 0 14px rgba(52,211,153,0.7))' }
                : { color: undefined }}
            >{matchState.homeScore}</span>
            <span className="text-xl font-thin dark:text-zinc-600 text-zinc-300">-</span>
            <span
              className="text-5xl font-black tabular-nums leading-none inline-block transition-colors duration-300"
              style={scorePop === 'away'
                ? { animation: 'scorePop 0.9s ease-out forwards', color: '#38bdf8', filter: 'drop-shadow(0 0 14px rgba(56,189,248,0.7))' }
                : { color: undefined }}
            >{matchState.awayScore}</span>
          </div>
          <div className="text-center min-w-[68px]">
            <TeamFlag iso={fixture.away.iso} fallback={fixture.away.flag} className="mx-auto mb-2 h-8 w-12" />
            {awayScorers.length > 0 && (
              <div className="mx-auto mb-1 max-w-[116px] space-y-0.5">
                {awayScorers.map((name, idx) => (
                  <div key={`${name}-${idx}`} className="truncate text-[10px] font-bold text-blue-600 dark:text-blue-300">
                    {name}
                  </div>
                ))}
              </div>
            )}
            <CardBadges cards={awayCards} />
            <div className="text-xs font-semibold dark:text-zinc-300 text-zinc-700 truncate">{fixture.away.name}</div>
          </div>
        </div>

        {/* Stadium info */}
        {fixture.stadium && (
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-5 pb-2 text-[11px]" style={{ fontFamily: BROADCAST_FONT }}>
            <span className="dark:text-zinc-300 text-zinc-700 font-semibold">{fixture.stadium.name}</span>
            <span className="dark:text-zinc-700 text-zinc-300"> -</span>
            <span className="dark:text-zinc-500 text-zinc-500">{fixture.stadium.city}, {fixture.stadium.country}</span>
            <span className="dark:text-zinc-700 text-zinc-300"> -</span>
            <span className="dark:text-zinc-500 text-zinc-500">{fixture.stadium.capacity.toLocaleString()} cap.</span>
          </div>
        )}

        {/* Result banner */}
        {isFinished && outcome && (
          <div className={`mx-5 mb-3 py-2 px-4 rounded-xl text-center text-sm font-bold
            ${outcome === 'home' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
              outcome === 'away' ? 'dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-300 text-zinc-700 border dark:border-zinc-700 border-zinc-200' :
              'dark:bg-zinc-800/60 bg-zinc-100 dark:text-zinc-300 text-zinc-600 border dark:border-zinc-700 border-zinc-200'}`}>
            {outcome === 'draw'
              ? 'Draw - all stakers refunded'
              : `${outcome === 'home' ? fixture.home.name : fixture.away.name} win - payouts sent`}
          </div>
        )}

        {/* Progress bar */}
        <div className="px-5 mb-3">
          <div className="flex justify-between text-[10px] dark:text-zinc-600 text-zinc-400 mb-1" style={{ fontFamily: BROADCAST_FONT }}>
            <span>0'</span>
            <span className={`font-semibold ${isLive ? 'dark:text-emerald-400 text-emerald-600' : 'dark:text-zinc-400 text-zinc-600'}`}>
              {isLive ? `${matchState.minute}'` : isHalfTime ? 'HT' : isFinished ? 'FT' : '-'}
            </span>
            <span>90'</span>
          </div>
          <div className="h-1 dark:bg-zinc-800 bg-zinc-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-1000 ${isFinished ? 'bg-zinc-500' : 'bg-emerald-500'}`}
              style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="grid gap-4 px-4 sm:px-5 pb-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.9fr)]">
          <div className="relative overflow-hidden rounded-lg">
            <Pitch fixture={fixture} state={matchState} freeze={!isLive} />
            {goalOverlay && (
              <div
                className="absolute inset-x-0 top-0 z-20 aspect-[400/224] overflow-hidden rounded-lg bg-black/28"
                style={{ animation: 'goalReplayFade 3.2s ease-out forwards' }}
                onAnimationEnd={() => setGoalOverlay(null)}
              >
                <svg viewBox="0 0 400 224" className="absolute inset-0 h-full w-full">
                  <defs>
                    <radialGradient id="goalReplayBall" cx="35%" cy="32%" r="72%">
                      <stop offset="0%" stopColor="#ffffff" />
                      <stop offset="62%" stopColor="#f4f4f5" />
                      <stop offset="100%" stopColor="#a1a1aa" />
                    </radialGradient>
                  </defs>
                  <rect x="0" y="0" width="400" height="224" fill="rgba(2,6,23,0.12)" />
                  <g transform={goalOverlay.isHome ? 'translate(358 100)' : 'translate(42 100)'}>
                    <rect x="-22" y="-35" width="44" height="70" rx="2" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.75)" strokeWidth="1.4" />
                    {[-24, -12, 0, 12, 24].map(y => <line key={y} x1="-22" y1={y} x2="22" y2={y} stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />)}
                    {[-12, 0, 12].map(x => <line key={x} x1={x} y1="-35" x2={x} y2="35" stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />)}
                    <path d="M -20 -30 Q 0 -44 20 -30 M -20 30 Q 0 44 20 30" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.8" style={{ animation: 'netRipple 3.2s ease-out forwards' }} />
                  </g>
                  <g style={{
                    transformOrigin: 'center',
                    animation: goalOverlay.isHome ? 'ballIntoRightGoal 3.2s ease-out forwards' : 'ballIntoLeftGoal 3.2s ease-out forwards',
                  }}>
                    <circle cx="0" cy="0" r="8" fill="url(#goalReplayBall)" />
                    <path d="M -2.6 -6 L 3.2 -4 L 5.3 1.8 L 0.1 5.8 L -4.9 2.7 L -4.8 -3.3 Z" fill="rgba(24,24,27,0.82)" />
                    <circle cx="0" cy="0" r="8" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
                  </g>
                </svg>
                <div className={`absolute ${goalOverlay.isHome ? 'right-4' : 'left-4'} top-4 flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-1.5 shadow-xl backdrop-blur-sm`}>
                  <TeamFlag iso={goalOverlay.iso} fallback={goalOverlay.flag} className="h-4 w-6" />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-white" style={{ fontFamily: BROADCAST_FONT }}>Goal</span>
                  <span className="max-w-[160px] truncate text-[11px] font-semibold text-white/80">
                    {goalOverlay.scorer ?? goalOverlay.name}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-950/80 bg-white overflow-hidden">
            <div className="flex border-b dark:border-zinc-800 border-zinc-200">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors border-b-2 -mb-px
                    ${tab === t.id
                      ? 'dark:text-zinc-100 text-zinc-900 border-emerald-500'
                      : 'dark:text-zinc-500 text-zinc-400 border-transparent dark:hover:text-zinc-300 hover:text-zinc-600'}`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
            <div className="p-4">
              {tab === 'stats'      && <StatsPanel fixture={fixture} state={matchState} />}
              {tab === 'commentary' && <CommentaryFeed state={matchState} />}
              {tab === 'squad'      && <SquadPanel fixture={fixture} state={matchState} />}
              {tab === 'chat'       && <MatchChat fixtureId={fixture.id} />}
            </div>
          </div>
        </div>

        {/* Incident ticker - fixed to viewport right edge, clear of any modal overflow clipping */}
        {tickers.length > 0 && (
          <div className="fixed top-20 right-4 z-[60] flex flex-col gap-1.5 pointer-events-none max-w-[220px]">
            {tickers.map(t => (
              <div
                key={t.id}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold shadow-xl whitespace-nowrap
                  ${t.isGoal
                    ? t.isHome
                      ? 'bg-emerald-500 text-black'
                      : 'bg-zinc-100 text-zinc-950'
                    : 'bg-zinc-900 text-zinc-100 border border-zinc-700'}`}
                style={{ animation: 'incidentSlide 5s ease-out forwards' }}
              >
                {t.text}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}



