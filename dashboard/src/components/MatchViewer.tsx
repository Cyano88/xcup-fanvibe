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

// ── Continuous live pitch animation ──────────────────────────────────────────

function getEventTarget(ev: MatchEvent | undefined, poss: number): { x: number; y: number } {
  const r1 = Math.random(), r2 = Math.random();
  const t = ev?.type ?? '';
  if (t === 'goal_home' || t === 'shot_home')  return { x: 305 + r1 * 60, y: 45 + r2 * 110 };
  if (t === 'corner_home')                      return { x: 355 + r1 * 18, y: r2 > 0.5 ? 14 + r2*14 : 172 + r2*14 };
  if (t === 'goal_away' || t === 'shot_away')   return { x: 35 + r1 * 60,  y: 45 + r2 * 110 };
  if (t === 'corner_away')                      return { x: 27 + r1 * 18,  y: r2 > 0.5 ? 14 + r2*14 : 172 + r2*14 };
  if (t.startsWith('foul') || t.startsWith('yellow') || t.startsWith('red'))
                                                return { x: 90 + r1 * 220, y: 40 + r2 * 120 };
  if (t === 'half_time' || t === 'kickoff' || t === 'full_time') return { x: 200, y: 100 };
  // free wander weighted by possession
  return { x: Math.max(30, Math.min(370, 85 + (poss / 100) * 230 + (r1 - 0.5) * 110)),
           y: Math.max(22, Math.min(178, 100 + (r2 - 0.5) * 130)) };
}

function Pitch({ fixture, state }: { fixture: Fixture; state: MatchState }) {
  // Physics: smooth ball that lerps toward target — never stops moving
  const smoothRef  = useRef({ x: 200, y: 100 });   // current rendered position
  const targetRef  = useRef({ x: 200, y: 100 });   // where we're heading
  const possRef    = useRef(state.possession);
  const eventLenRef = useRef(state.events.length);

  const [renderPos, setRenderPos] = useState({ x: 200, y: 100 });
  const [trail, setTrail]         = useState<{ x: number; y: number }[]>([]);
  const [action, setAction]       = useState<{ text: string } | null>(null);
  const [coneHome, setConeHome]   = useState<string | null>(null);
  const [coneAway, setConeAway]   = useState<string | null>(null);
  const [goalFlash, setGoalFlash] = useState(false);

  // Keep possession ref current
  useEffect(() => { possRef.current = state.possession; }, [state.possession]);

  // Snap target + action on new event
  useEffect(() => {
    if (state.events.length === eventLenRef.current) return;
    eventLenRef.current = state.events.length;
    const ev = state.events[state.events.length - 1];
    if (!ev) return;
    targetRef.current = getEventTarget(ev, possRef.current);
    const a = getActionLabel(ev, fixture.home.code, fixture.away.code);
    setAction(a);
    const isGoal = ev.type === 'goal_home' || ev.type === 'goal_away';
    if (isGoal) { setGoalFlash(true); setTimeout(() => setGoalFlash(false), 1200); }
  }, [state.events.length, fixture.home.code, fixture.away.code]);

  // Wander: new waypoint every ~1.8 s when no event is forcing a target
  useEffect(() => {
    const wander = setInterval(() => {
      const lastEv = state.events[state.events.length - 1];
      // Only update target from wander if last event was not an attack event
      const t = lastEv?.type ?? '';
      const isHot = t.includes('goal') || t.includes('shot') || t.includes('corner');
      if (!isHot) {
        targetRef.current = getEventTarget(undefined, possRef.current);
      } else {
        // near the event area but slightly shifted
        const cur = targetRef.current;
        targetRef.current = {
          x: Math.max(22, Math.min(378, cur.x + (Math.random() - 0.5) * 55)),
          y: Math.max(18, Math.min(182, cur.y + (Math.random() - 0.5) * 45)),
        };
      }
    }, 1800);
    return () => clearInterval(wander);
  }, [state.events.length]);

  // Physics tick: lerp smooth → target at 20 fps, update render state
  useEffect(() => {
    const tick = setInterval(() => {
      const s = smoothRef.current;
      const t = targetRef.current;
      s.x += (t.x - s.x) * 0.10;
      s.y += (t.y - s.y) * 0.10;
      setRenderPos({ x: s.x, y: s.y });
    }, 50); // 20 fps
    return () => clearInterval(tick);
  }, []);

  // Trail: sample position every 300 ms — fades from tail (transparent) to head (bright)
  useEffect(() => {
    const t = setInterval(() => {
      setTrail(prev => [...prev.slice(-11), { x: smoothRef.current.x, y: smoothRef.current.y }]);
    }, 300);
    return () => clearInterval(t);
  }, []);

  // Attack cones: update every render pass based on current renderPos
  useEffect(() => {
    const ev = state.events[state.events.length - 1];
    const bx = renderPos.x, by = renderPos.y;
    const isAttackHome = ev?.type === 'goal_home' || ev?.type === 'shot_home';
    const isAttackAway = ev?.type === 'goal_away' || ev?.type === 'shot_away';
    setConeHome(isAttackHome ? `392,100 ${bx},${Math.max(16,by-55)} ${bx},${Math.min(184,by+55)}` : null);
    setConeAway(isAttackAway ? `8,100 ${bx},${Math.max(16,by-55)} ${bx},${Math.min(184,by+55)}` : null);
  }, [renderPos, state.events.length]);

  return (
    <div>
      <svg viewBox="0 0 400 200" className="w-full rounded-xl overflow-hidden" style={{ maxHeight: 210 }}>
        {/* Pitch base */}
        <rect width="400" height="200" fill="#1a5c1a" />
        {[0,1,2,3,4,5,6].map(i => (
          <rect key={i} x={i * 57} y="0" width="28" height="200" fill="#1e671e" opacity="0.55" />
        ))}

        {/* Goal flash */}
        {goalFlash && <rect width="400" height="200" fill="rgba(52,211,153,0.16)" />}

        {/* Attack cones */}
        {coneHome && <polygon points={coneHome} fill="rgba(74,222,128,0.14)" />}
        {coneAway && <polygon points={coneAway} fill="rgba(251,191,36,0.14)" />}

        {/* Pitch markings */}
        <rect x="12" y="10" width="376" height="180" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.5" />
        <line x1="200" y1="10" x2="200" y2="190" stroke="rgba(255,255,255,0.38)" strokeWidth="1.5" />
        <circle cx="200" cy="100" r="32" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.5" />
        <circle cx="200" cy="100" r="2" fill="rgba(255,255,255,0.5)" />
        <rect x="12" y="55" width="56" height="90" fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth="1.5" />
        <rect x="12" y="73" width="22" height="54" fill="none" stroke="rgba(255,255,255,0.26)" strokeWidth="1" />
        <rect x="332" y="55" width="56" height="90" fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth="1.5" />
        <rect x="366" y="73" width="22" height="54" fill="none" stroke="rgba(255,255,255,0.26)" strokeWidth="1" />
        <rect x="4" y="82" width="8" height="36" fill="none" stroke="rgba(255,255,255,0.48)" strokeWidth="1.5" />
        <rect x="388" y="82" width="8" height="36" fill="none" stroke="rgba(255,255,255,0.48)" strokeWidth="1.5" />

        {/* Fading ball trail — each segment brighter toward head */}
        {trail.length > 1 && trail.map((pt, i) => {
          if (i === 0) return null;
          const op = ((i) / trail.length) * 0.7;
          const sw = 1 + (i / trail.length) * 2.5;
          return (
            <line key={i}
              x1={trail[i-1].x} y1={trail[i-1].y}
              x2={pt.x} y2={pt.y}
              stroke="white" strokeWidth={sw} strokeOpacity={op} strokeLinecap="round"
            />
          );
        })}

        {/* Ball — CSS transition for extra smoothness between 20fps ticks */}
        <g style={{ transform: `translate(${renderPos.x}px, ${renderPos.y}px)`, transition: 'transform 60ms linear' }}>
          <circle cx="0" cy="0" r="6" fill="white" opacity="0.95" />
          <circle cx="0" cy="0" r="6" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.2" />
        </g>

        {/* Action text */}
        {action && (
          <text x="200" y="194" textAnchor="middle"
            fill="rgba(255,255,255,0.62)" fontSize="9" fontFamily="monospace" fontWeight="700" letterSpacing="0.5">
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
