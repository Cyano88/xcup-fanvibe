import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Zap, Send, MessageCircle, BarChart2, List } from 'lucide-react';
import type { Fixture, MatchState, MatchEvent } from '../types';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';

interface Comment { id: number; name: string; text: string; ts: string; fixtureId: string; }
interface Props { fixture: Fixture; matchState: MatchState; onClose: () => void; }

// ── Stat helpers ──────────────────────────────────────────────────────────────

function computeStats(events: MatchEvent[]) {
  let shotsOnHome = 0, shotsOnAway = 0;
  let shotsOffHome = 0, shotsOffAway = 0;
  let cornersHome = 0, cornersAway = 0;
  let foulsHome = 0, foulsAway = 0;
  let cardsHome = 0, cardsAway = 0;

  for (const e of events) {
    if (e.type === 'goal_home')        shotsOnHome++;
    else if (e.type === 'goal_away')   shotsOnAway++;
    else if (e.type === 'shot_home')   shotsOffHome++;
    else if (e.type === 'shot_away')   shotsOffAway++;
    else if (e.type === 'corner_home') cornersHome++;
    else if (e.type === 'corner_away') cornersAway++;
    else if (e.type === 'foul_home')   foulsHome++;
    else if (e.type === 'foul_away')   foulsAway++;
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
  };
}

function getActionLabel(ev: MatchEvent | undefined, home: string, away: string): { text: string; isHome: boolean } | null {
  if (!ev) return null;
  const isHome = ev.team === 'home';
  const team = isHome ? home : away;
  if (ev.type === 'goal_home' || ev.type === 'goal_away') return { text: `${team} — Goal!`, isHome };
  if (ev.type === 'shot_home' || ev.type === 'shot_away') return { text: `${team} — Dangerous Attack`, isHome };
  if (ev.type === 'corner_home' || ev.type === 'corner_away') return { text: `${team} — Corner Kick`, isHome };
  if (ev.type === 'foul_home' || ev.type === 'foul_away') return { text: `${team} — Free Kick`, isHome };
  if (ev.type.startsWith('yellow')) return { text: `${team} — Yellow Card`, isHome };
  if (ev.type.startsWith('red'))    return { text: `${team} — Red Card`, isHome };
  if (ev.type === 'half_time')  return { text: 'Half Time', isHome: true };
  if (ev.type === 'full_time')  return { text: 'Full Time', isHome: true };
  if (ev.type === 'kickoff')    return { text: 'Kick Off', isHome: true };
  return { text: `${team} — Attacking`, isHome };
}

// smooth cubic bezier through points
function buildTrailPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2;
    const my = (pts[i - 1].y + pts[i].y) / 2;
    d += ` Q${pts[i - 1].x},${pts[i - 1].y} ${mx},${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last.x},${last.y}`;
  return d;
}

// ── Sportybet-style Pitch ─────────────────────────────────────────────────────

function Pitch({ fixture, state }: { fixture: Fixture; state: MatchState }) {
  const [ballPos, setBallPos] = useState({ x: 200, y: 100 });
  const [trail, setTrail] = useState<{ x: number; y: number }[]>([{ x: 200, y: 100 }]);
  const rng = useRef(0);

  const lastEvent = state.events[state.events.length - 1];
  const action = getActionLabel(lastEvent, fixture.home.code, fixture.away.code);

  useEffect(() => {
    const ev = state.events[state.events.length - 1];
    // deterministic jitter from event id
    const seed = ev ? ev.id * 9301 + 49297 : rng.current++;
    const r1 = ((seed % 233280) / 233280);
    const r2 = (((seed * 3) % 233280) / 233280);

    let tx: number, ty: number;
    const t = ev?.type ?? '';

    if (t === 'goal_home' || t === 'shot_home') {
      tx = 310 + r1 * 55; ty = 45 + r2 * 110;
    } else if (t === 'corner_home') {
      tx = 350 + r1 * 20; ty = r2 > 0.5 ? 15 + r2 * 15 : 170 + r2 * 15;
    } else if (t === 'goal_away' || t === 'shot_away') {
      tx = 35 + r1 * 55; ty = 45 + r2 * 110;
    } else if (t === 'corner_away') {
      tx = 30 + r1 * 20; ty = r2 > 0.5 ? 15 + r2 * 15 : 170 + r2 * 15;
    } else if (t.startsWith('foul') || t.startsWith('yellow') || t.startsWith('red')) {
      tx = 80 + r1 * 240; ty = 40 + r2 * 120;
    } else if (t === 'half_time' || t === 'kickoff' || t === 'full_time') {
      tx = 200; ty = 100;
    } else {
      // general midfield drift weighted by possession
      tx = 100 + (state.possession / 100) * 200 + (r1 - 0.5) * 80;
      ty = 50 + r2 * 100;
    }

    const newPos = { x: Math.max(22, Math.min(378, tx)), y: Math.max(18, Math.min(182, ty)) };
    setBallPos(newPos);
    setTrail(prev => [...prev.slice(-8), newPos]);
  }, [state.events.length, state.possession]);

  const isGoal = lastEvent?.type === 'goal_home' || lastEvent?.type === 'goal_away';
  const isAttackHome = lastEvent?.type === 'goal_home' || lastEvent?.type === 'shot_home';
  const isAttackAway = lastEvent?.type === 'goal_away' || lastEvent?.type === 'shot_away';

  // attack cone: tip at goal mouth, base at ball position
  const coneHome = isAttackHome
    ? `390,100 ${ballPos.x},${Math.max(16, ballPos.y - 52)} ${ballPos.x},${Math.min(184, ballPos.y + 52)}`
    : null;
  const coneAway = isAttackAway
    ? `10,100 ${ballPos.x},${Math.max(16, ballPos.y - 52)} ${ballPos.x},${Math.min(184, ballPos.y + 52)}`
    : null;

  const trailPath = buildTrailPath(trail);

  return (
    <div>
      <svg viewBox="0 0 400 200" className="w-full rounded-xl overflow-hidden" style={{ maxHeight: 210 }}>
        {/* Pitch base */}
        <rect width="400" height="200" fill="#1a5c1a" />
        {/* Stripe pattern */}
        {[0,1,2,3,4,5,6].map(i => (
          <rect key={i} x={i * 57} y="0" width="28" height="200" fill="#1e671e" opacity="0.6" />
        ))}

        {/* Goal flash */}
        {isGoal && <rect width="400" height="200" fill="rgba(52,211,153,0.14)" />}

        {/* Attack cones */}
        {coneHome && <polygon points={coneHome} fill="rgba(74,222,128,0.13)" />}
        {coneAway && <polygon points={coneAway} fill="rgba(251,191,36,0.13)" />}

        {/* Boundary */}
        <rect x="12" y="10" width="376" height="180" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
        {/* Centre line */}
        <line x1="200" y1="10" x2="200" y2="190" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
        {/* Centre circle */}
        <circle cx="200" cy="100" r="32" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
        <circle cx="200" cy="100" r="2" fill="rgba(255,255,255,0.55)" />
        {/* Left penalty box */}
        <rect x="12" y="55" width="56" height="90" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        <rect x="12" y="73" width="22" height="54" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1" />
        <circle cx="68" cy="100" r="1.5" fill="rgba(255,255,255,0.45)" />
        {/* Right penalty box */}
        <rect x="332" y="55" width="56" height="90" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        <rect x="366" y="73" width="22" height="54" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1" />
        <circle cx="332" cy="100" r="1.5" fill="rgba(255,255,255,0.45)" />
        {/* Goals */}
        <rect x="4" y="82" width="8" height="36" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
        <rect x="388" y="82" width="8" height="36" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />

        {/* Ball trail */}
        {trail.length > 1 && (
          <path
            d={trailPath}
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Ball */}
        <circle cx={ballPos.x} cy={ballPos.y} r="5.5" fill="white" opacity="0.96" />
        <circle cx={ballPos.x} cy={ballPos.y} r="5.5" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1" />

        {/* Action text on pitch */}
        {action && (
          <text
            x="200" y="192"
            textAnchor="middle"
            fill="rgba(255,255,255,0.65)"
            fontSize="9.5"
            fontFamily="monospace"
            fontWeight="600"
            letterSpacing="0.3"
          >
            {action.text.toUpperCase()}
          </text>
        )}

        {/* Team labels */}
        <text x="40" y="8" textAnchor="middle" fill="rgba(74,222,128,0.8)" fontSize="9" fontFamily="monospace" fontWeight="bold">
          {fixture.home.code}
        </text>
        <text x="360" y="8" textAnchor="middle" fill="rgba(251,191,36,0.8)" fontSize="9" fontFamily="monospace" fontWeight="bold">
          {fixture.away.code}
        </text>
      </svg>

      {/* Possession bar — Sportybet style */}
      <div className="mt-2.5 flex items-center gap-0 overflow-hidden rounded-full dark:bg-zinc-800 bg-zinc-200 h-2">
        <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${state.possession}%` }} />
        <div className="h-full bg-amber-500 flex-1 transition-all duration-1000" />
      </div>
      <div className="flex justify-between mt-0.5 text-[10px] font-mono font-semibold">
        <span className="text-emerald-500">{fixture.home.code} {state.possession}%</span>
        <span className="dark:text-zinc-500 text-zinc-400 text-[9px] font-normal">POSSESSION</span>
        <span className="text-amber-500">{100 - state.possession}% {fixture.away.code}</span>
      </div>
    </div>
  );
}

// ── Stats tab — Sportybet style ───────────────────────────────────────────────

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
      <span className="text-center text-[10px] font-mono dark:text-zinc-500 text-zinc-500 uppercase tracking-wide leading-tight">
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
          <span className="text-[11px] font-semibold text-amber-500">{fixture.away.code}</span>
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
        <span className="text-center text-[10px] font-mono dark:text-zinc-500 text-zinc-500 uppercase tracking-wide">Possession</span>
        <div className="flex justify-start h-1.5">
          <div className="rounded-r-full bg-red-500 h-full" style={{ width: `${100 - state.possession}%` }} />
        </div>
        <span className="text-left text-sm font-bold text-amber-500 tabular-nums">{100 - state.possession}%</span>
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

  const isGoal = (t: string) => t.startsWith('goal') || t === 'var';
  const isCard = (t: string) => t.startsWith('yellow') || t.startsWith('red');

  return (
    <div ref={ref} className="h-44 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
      {state.events.length === 0 && (
        <p className="text-xs dark:text-zinc-500 text-zinc-400 text-center pt-10 font-mono">Waiting for kick off…</p>
      )}
      {[...state.events].reverse().map(ev => (
        <div key={ev.id} className={`flex items-start gap-2 text-xs rounded-lg px-2.5 py-1.5
          ${isGoal(ev.type)
            ? 'dark:bg-emerald-500/10 bg-emerald-50 border dark:border-emerald-500/20 border-emerald-200'
            : isCard(ev.type)
            ? 'dark:bg-amber-500/10 bg-amber-50 border dark:border-amber-500/20 border-amber-100'
            : 'dark:bg-zinc-900/50 bg-zinc-50 border border-transparent'}`}>
          <span className="font-mono dark:text-zinc-500 text-zinc-400 shrink-0 w-7 text-right tabular-nums">{ev.minute}'</span>
          <span className={`leading-snug font-medium ${
            isGoal(ev.type) ? 'dark:text-emerald-300 text-emerald-700 font-semibold' :
            isCard(ev.type) ? 'dark:text-amber-300 text-amber-700' :
            'dark:text-zinc-300 text-zinc-700'}`}>
            {ev.commentary}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Match Chat ────────────────────────────────────────────────────────────────

function MatchChat({ fixtureId }: { fixtureId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [user, setUser] = useState<string | null>(() => localStorage.getItem('fanvibe_name'));
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
    localStorage.setItem('fanvibe_name', n);
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
            placeholder="Pick a display name…"
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
        <span className="text-[11px] font-mono dark:text-zinc-500 text-zinc-400 uppercase tracking-widest">Match Chat</span>
        <button onClick={() => { localStorage.removeItem('fanvibe_name'); setUser(null); }}
          className="text-[10px] font-mono dark:text-zinc-600 text-zinc-400 hover:dark:text-zinc-400 hover:text-zinc-600 transition-colors">
          {user} · change
        </button>
      </div>
      <div ref={listRef} className="h-36 overflow-y-auto space-y-1 scrollbar-thin">
        {comments.length === 0 && (
          <p className="text-xs dark:text-zinc-600 text-zinc-400 text-center pt-10 font-mono">No messages yet — be first!</p>
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
          onKeyDown={e => e.key === 'Enter' && post()} placeholder="Say something…" maxLength={280}
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

type Tab = 'stats' | 'commentary' | 'chat';

export function MatchViewer({ fixture, matchState, onClose }: Props) {
  const isLive     = matchState.status === 'live';
  const isFinished = matchState.status === 'finished';
  const progress   = Math.min(100, (matchState.minute / 90) * 100);
  const [tab, setTab] = useState<Tab>('stats');

  const outcome = isFinished
    ? matchState.homeScore > matchState.awayScore ? 'home'
    : matchState.awayScore > matchState.homeScore ? 'away'
    : 'draw'
    : null;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'stats',       label: 'Statistics',  icon: <BarChart2 size={12} /> },
    { id: 'commentary',  label: 'Commentary',  icon: <List size={12} /> },
    { id: 'chat',        label: 'Chat',        icon: <MessageCircle size={12} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div className="relative z-10 w-full max-w-xl dark:bg-zinc-950 bg-white border dark:border-zinc-800 border-zinc-200 rounded-2xl shadow-2xl overflow-hidden animate-slide-in">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b dark:border-zinc-800 border-zinc-100">
          <div className="flex items-center gap-2.5">
            {isLive && <Zap size={13} className="text-emerald-400 animate-pulse" />}
            <span className="text-sm font-bold dark:text-zinc-100 text-zinc-900">
              {fixture.home.flag} {fixture.home.code}
              <span className="dark:text-zinc-600 text-zinc-400 font-light mx-2">vs</span>
              {fixture.away.code} {fixture.away.flag}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            {isLive && (
              <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE {matchState.minute}'
              </span>
            )}
            {isFinished && (
              <span className="text-[10px] font-mono font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
                FULL TIME
              </span>
            )}
            <button onClick={onClose}
              className="p-1 rounded-lg dark:text-zinc-500 text-zinc-400 dark:hover:text-zinc-200 hover:text-zinc-800 transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── Score ── */}
        <div className="flex items-center justify-center gap-8 py-4">
          <div className="text-center min-w-[68px]">
            <div className="text-3xl mb-1">{fixture.home.flag}</div>
            <div className="text-xs font-semibold dark:text-zinc-300 text-zinc-700 truncate">{fixture.home.name}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-5xl font-black dark:text-white text-zinc-900 tabular-nums leading-none">{matchState.homeScore}</span>
            <span className="text-xl font-thin dark:text-zinc-600 text-zinc-300">–</span>
            <span className="text-5xl font-black dark:text-white text-zinc-900 tabular-nums leading-none">{matchState.awayScore}</span>
          </div>
          <div className="text-center min-w-[68px]">
            <div className="text-3xl mb-1">{fixture.away.flag}</div>
            <div className="text-xs font-semibold dark:text-zinc-300 text-zinc-700 truncate">{fixture.away.name}</div>
          </div>
        </div>

        {/* Result banner */}
        {isFinished && outcome && (
          <div className={`mx-5 mb-3 py-2 px-4 rounded-xl text-center text-sm font-bold
            ${outcome === 'home' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
              outcome === 'away' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
              'dark:bg-zinc-800/60 bg-zinc-100 dark:text-zinc-300 text-zinc-600 border dark:border-zinc-700 border-zinc-200'}`}>
            {outcome === 'draw'
              ? 'Draw — all stakers refunded'
              : `${outcome === 'home' ? fixture.home.name : fixture.away.name} win — payouts sent`}
          </div>
        )}

        {/* Progress bar */}
        <div className="px-5 mb-3">
          <div className="flex justify-between text-[10px] font-mono dark:text-zinc-600 text-zinc-400 mb-1">
            <span>0'</span>
            <span className={`font-semibold ${isLive ? 'dark:text-emerald-400 text-emerald-600' : 'dark:text-zinc-400 text-zinc-600'}`}>
              {isLive ? `${matchState.minute}'` : isFinished ? 'FT' : '—'}
            </span>
            <span>90'</span>
          </div>
          <div className="h-1 dark:bg-zinc-800 bg-zinc-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-1000 ${isFinished ? 'bg-purple-500' : 'bg-emerald-500'}`}
              style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Pitch */}
        <div className="px-5 mb-3">
          <Pitch fixture={fixture} state={matchState} />
        </div>

        {/* Tab bar */}
        <div className="flex border-b dark:border-zinc-800 border-zinc-200 mx-5">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 -mb-px
                ${tab === t.id
                  ? 'dark:text-zinc-100 text-zinc-900 border-emerald-500'
                  : 'dark:text-zinc-500 text-zinc-400 border-transparent dark:hover:text-zinc-300 hover:text-zinc-600'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="px-5 py-4">
          {tab === 'stats'      && <StatsPanel fixture={fixture} state={matchState} />}
          {tab === 'commentary' && <CommentaryFeed state={matchState} />}
          {tab === 'chat'       && <MatchChat fixtureId={fixture.id} />}
        </div>
      </div>
    </div>
  );
}
