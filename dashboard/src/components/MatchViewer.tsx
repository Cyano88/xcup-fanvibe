import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Zap, Send, MessageCircle } from 'lucide-react';
import type { Fixture, MatchState } from '../types';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';

interface Comment { id: number; name: string; text: string; ts: string; fixtureId: string; }

interface Props {
  fixture: Fixture;
  matchState: MatchState;
  onClose: () => void;
}

// ── Sportybet-style pitch ─────────────────────────────────────────────────────

function Pitch({ fixture, state }: { fixture: Fixture; state: MatchState }) {
  const push = Math.max(-20, Math.min(20, (state.possession - 50) * 0.6));

  // Home players: GK fixed, rest shift right with possession
  const homePlayers: [number, number][] = [
    [28, 110],
    [78, 70],  [78, 150],
    [128 + push * 0.4, 88],  [128 + push * 0.4, 132],
    [175 + push * 0.8, 110],
  ];
  const awayPlayers: [number, number][] = [
    [372, 110],
    [322, 70],  [322, 150],
    [272 - push * 0.4, 88],  [272 - push * 0.4, 132],
    [225 - push * 0.8, 110],
  ];

  // Ball follows the action zone
  const ballX = 200 + push * 1.2;
  const lastEvent = state.events[state.events.length - 1];
  const isGoalMoment = lastEvent && (lastEvent.type.startsWith('goal') || lastEvent.type === 'var');
  const isCardMoment = lastEvent && (lastEvent.type.startsWith('yellow') || lastEvent.type.startsWith('red'));

  return (
    <div>
      <svg viewBox="0 0 400 215" className="w-full rounded-xl overflow-hidden" style={{ maxHeight: 215 }}>
        {/* Pitch surface */}
        <rect width="400" height="200" fill="#1c5c1c" />
        {/* Stripe pattern */}
        {[0,1,2,3,4,5,6].map(i => (
          <rect key={i} x={i * 57} y="0" width="28" height="200" fill="#1f661f" opacity="0.55" />
        ))}

        {/* Attack zone highlight */}
        {state.possession > 58 && (
          <rect x="260" y="0" width="125" height="200" fill="rgba(52,211,153,0.06)" />
        )}
        {state.possession < 42 && (
          <rect x="15" y="0" width="125" height="200" fill="rgba(251,191,36,0.06)" />
        )}

        {/* Boundary */}
        <rect x="15" y="10" width="370" height="180" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        {/* Center line */}
        <line x1="200" y1="10" x2="200" y2="190" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        {/* Center circle */}
        <circle cx="200" cy="100" r="33" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        <circle cx="200" cy="100" r="2" fill="rgba(255,255,255,0.5)" />
        {/* Left penalty box */}
        <rect x="15" y="52" width="58" height="96" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <rect x="15" y="75" width="22" height="50" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        {/* Right penalty box */}
        <rect x="327" y="52" width="58" height="96" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <rect x="363" y="75" width="22" height="50" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        {/* Goals */}
        <rect x="7" y="82" width="8" height="36" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
        <rect x="385" y="82" width="8" height="36" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />

        {/* Goal flash */}
        {isGoalMoment && (
          <rect width="400" height="200" fill="rgba(52,211,153,0.12)" />
        )}

        {/* Home players */}
        {homePlayers.map(([x, y], i) => (
          <g key={`h${i}`} style={{ transition: 'all 2s ease-in-out' }}>
            <circle cx={x} cy={y} r="8" fill="rgba(52,211,153,0.9)" stroke="white" strokeWidth="1.5" />
            {i === 0 && <text x={x} y={y + 4} textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">GK</text>}
          </g>
        ))}

        {/* Away players */}
        {awayPlayers.map(([x, y], i) => (
          <g key={`a${i}`} style={{ transition: 'all 2s ease-in-out' }}>
            <circle cx={x} cy={y} r="8" fill="rgba(251,191,36,0.9)" stroke="white" strokeWidth="1.5" />
            {i === 0 && <text x={x} y={y + 4} textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">GK</text>}
          </g>
        ))}

        {/* Ball */}
        <circle cx={ballX} cy="100" r="5.5" fill="white" opacity="0.95"
          style={{ transition: 'cx 2s ease-in-out' }}>
          {!isGoalMoment && (
            <animate attributeName="cy" values="97;103;97" dur="1.8s" repeatCount="indefinite" />
          )}
        </circle>
        {isCardMoment && (
          <rect x={ballX + 6} y="88" width="10" height="14" rx="1.5"
            fill={lastEvent.type.startsWith('red') ? '#ef4444' : '#eab308'} opacity="0.9" />
        )}

        {/* Team labels */}
        <text x="68" y="207" textAnchor="middle" fill="rgba(52,211,153,0.85)" fontSize="10" fontFamily="monospace" fontWeight="bold">
          {fixture.home.code}
        </text>
        <text x="332" y="207" textAnchor="middle" fill="rgba(251,191,36,0.85)" fontSize="10" fontFamily="monospace" fontWeight="bold">
          {fixture.away.code}
        </text>
      </svg>

      {/* Possession bar */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] font-mono font-bold text-emerald-400 w-7 text-right">{state.possession}%</span>
        <div className="flex-1 h-2 rounded-full dark:bg-zinc-800 bg-zinc-200 overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-l-full transition-all duration-1000"
            style={{ width: `${state.possession}%` }}
          />
        </div>
        <span className="text-[10px] font-mono font-bold text-amber-400 w-7">{100 - state.possession}%</span>
      </div>
      <div className="flex justify-between text-[9px] font-mono dark:text-zinc-600 text-zinc-400 mt-0.5 px-9">
        <span>Possession</span>
        <span>Possession</span>
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

  const isGoal = (type: string) => type.startsWith('goal') || type === 'var';
  const isCard = (type: string) => type.startsWith('yellow') || type.startsWith('red');

  return (
    <div ref={ref} className="h-36 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
      {state.events.length === 0 && (
        <p className="text-xs dark:text-zinc-500 text-zinc-400 text-center pt-8 font-mono">Waiting for kick off…</p>
      )}
      {[...state.events].reverse().map(ev => (
        <div key={ev.id} className={`flex items-start gap-2 text-xs rounded-lg px-2.5 py-1.5
          ${isGoal(ev.type) ? 'dark:bg-emerald-500/10 bg-emerald-50 border dark:border-emerald-500/20 border-emerald-200' :
            isCard(ev.type) ? 'dark:bg-amber-500/10 bg-amber-50 border dark:border-amber-500/20 border-amber-100' :
            'dark:bg-zinc-900/60 bg-zinc-50 border border-transparent'}`}>
          <span className="font-mono dark:text-zinc-500 text-zinc-400 shrink-0 w-6 text-right tabular-nums">{ev.minute}'</span>
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

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_HTTP}/comments/${fixtureId}`);
      const data: Comment[] = await res.json();
      setComments(data);
    } catch { /* offline */ }
  }, [fixtureId]);

  useEffect(() => {
    loadComments();
    const t = setInterval(loadComments, 5000);
    return () => clearInterval(t);
  }, [loadComments]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments.length]);

  const setName = () => {
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
      await loadComments();
    } finally {
      setPosting(false);
    }
  };

  if (!user) {
    return (
      <div className="dark:bg-zinc-900/60 bg-zinc-50 rounded-xl p-4 border dark:border-zinc-800 border-zinc-200">
        <div className="flex items-center gap-2 mb-3">
          <MessageCircle size={14} className="dark:text-zinc-400 text-zinc-500" />
          <span className="text-sm font-semibold dark:text-zinc-200 text-zinc-800">Join the match chat</span>
        </div>
        <div className="flex gap-2">
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setName()}
            placeholder="Pick a display name…"
            className="flex-1 text-sm px-3 py-2 rounded-lg dark:bg-zinc-800 bg-white dark:border-zinc-700 border-zinc-200 border dark:text-zinc-100 text-zinc-900 dark:placeholder-zinc-600 placeholder-zinc-400 focus:outline-none dark:focus:border-emerald-500/50 focus:border-emerald-500 transition-colors"
          />
          <button
            onClick={setName}
            disabled={!nameInput.trim()}
            className="px-3 py-2 rounded-lg bg-emerald-500 text-black text-sm font-semibold disabled:opacity-40 hover:bg-emerald-400 transition-colors"
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle size={13} className="dark:text-zinc-500 text-zinc-400" />
          <span className="text-[11px] font-mono dark:text-zinc-500 text-zinc-400 uppercase tracking-widest">Match Chat</span>
        </div>
        <button onClick={() => { localStorage.removeItem('fanvibe_name'); setUser(null); }}
          className="text-[10px] font-mono dark:text-zinc-600 text-zinc-400 hover:text-zinc-500 transition-colors">
          {user} · change
        </button>
      </div>

      <div ref={listRef} className="h-28 overflow-y-auto space-y-1 scrollbar-thin">
        {comments.length === 0 && (
          <p className="text-xs dark:text-zinc-600 text-zinc-400 text-center pt-8 font-mono">No messages yet — say something!</p>
        )}
        {comments.map(c => (
          <div key={c.id} className="flex items-start gap-2 text-xs dark:bg-zinc-900/40 bg-zinc-50 rounded-lg px-2.5 py-1.5">
            <span className="font-semibold dark:text-emerald-400 text-emerald-600 shrink-0">{c.name}</span>
            <span className="dark:text-zinc-300 text-zinc-700 leading-snug">{c.text}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && post()}
          placeholder="Say something…"
          maxLength={280}
          className="flex-1 text-sm px-3 py-2 rounded-lg dark:bg-zinc-800 bg-white dark:border-zinc-700 border-zinc-200 border dark:text-zinc-100 text-zinc-900 dark:placeholder-zinc-600 placeholder-zinc-400 focus:outline-none dark:focus:border-emerald-500/50 focus:border-emerald-500 transition-colors"
        />
        <button
          onClick={post}
          disabled={!text.trim() || posting}
          className="px-3 py-2 rounded-lg dark:bg-zinc-800 bg-zinc-100 dark:border-zinc-700 border-zinc-200 border dark:text-zinc-300 text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-700 hover:bg-zinc-200 transition-colors"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Main MatchViewer ──────────────────────────────────────────────────────────

export function MatchViewer({ fixture, matchState, onClose }: Props) {
  const isLive     = matchState.status === 'live';
  const isFinished = matchState.status === 'finished';
  const progress   = Math.min(100, (matchState.minute / 90) * 100);
  const [tab, setTab] = useState<'commentary' | 'chat'>('commentary');

  const outcome = isFinished
    ? matchState.homeScore > matchState.awayScore ? 'home'
    : matchState.awayScore > matchState.homeScore ? 'away'
    : 'draw'
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg dark:bg-zinc-950 bg-white border dark:border-zinc-800 border-zinc-200 rounded-2xl shadow-2xl overflow-hidden animate-slide-in">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b dark:border-zinc-800 border-zinc-100">
          <div className="flex items-center gap-2.5">
            {isLive && <Zap size={14} className="text-emerald-400 animate-pulse" />}
            <span className="text-sm font-bold dark:text-zinc-100 text-zinc-900">
              {fixture.home.flag} {fixture.home.code} <span className="dark:text-zinc-500 text-zinc-400 font-normal">vs</span> {fixture.away.code} {fixture.away.flag}
            </span>
          </div>
          <div className="flex items-center gap-3">
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
            <button onClick={onClose} className="p-1 rounded-lg dark:text-zinc-500 text-zinc-400 dark:hover:text-zinc-200 hover:text-zinc-700 transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Score */}
        <div className="flex items-center justify-center gap-6 py-4">
          <div className="text-center min-w-[72px]">
            <div className="text-3xl mb-1">{fixture.home.flag}</div>
            <div className="text-xs font-semibold dark:text-zinc-300 text-zinc-700">{fixture.home.name}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-5xl font-black dark:text-white text-zinc-900 tabular-nums leading-none">{matchState.homeScore}</span>
            <span className="text-xl font-light dark:text-zinc-600 text-zinc-300">–</span>
            <span className="text-5xl font-black dark:text-white text-zinc-900 tabular-nums leading-none">{matchState.awayScore}</span>
          </div>
          <div className="text-center min-w-[72px]">
            <div className="text-3xl mb-1">{fixture.away.flag}</div>
            <div className="text-xs font-semibold dark:text-zinc-300 text-zinc-700">{fixture.away.name}</div>
          </div>
        </div>

        {/* Result banner */}
        {isFinished && outcome && (
          <div className={`mx-5 mb-3 py-2 px-4 rounded-xl text-center text-sm font-bold
            ${outcome === 'home' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
              outcome === 'away' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
              'dark:bg-zinc-700/40 bg-zinc-100 dark:text-zinc-300 text-zinc-600 border dark:border-zinc-600/30 border-zinc-200'}`}>
            {outcome === 'draw' ? 'Draw — stakers refunded' :
             outcome === 'home' ? `${fixture.home.name} win — payouts sent` :
             `${fixture.away.name} win — payouts sent`}
          </div>
        )}

        {/* Progress bar */}
        <div className="px-5 mb-3">
          <div className="flex justify-between text-[10px] font-mono dark:text-zinc-600 text-zinc-400 mb-1">
            <span>0'</span>
            <span className="dark:text-zinc-400 text-zinc-600 font-semibold">{isLive ? `${matchState.minute}'` : isFinished ? 'FT' : '—'}</span>
            <span>90'</span>
          </div>
          <div className="h-1.5 dark:bg-zinc-800 bg-zinc-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${isFinished ? 'bg-purple-500' : 'bg-emerald-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] font-mono dark:text-zinc-700 text-zinc-400 mt-0.5">
            <span>HT 45'</span>
            <span>FT 90'</span>
          </div>
        </div>

        {/* Pitch */}
        <div className="px-5 mb-3">
          <Pitch fixture={fixture} state={matchState} />
        </div>

        {/* Tab bar */}
        <div className="flex border-b dark:border-zinc-800 border-zinc-200 mx-5 mb-3">
          {(['commentary', 'chat'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs font-semibold capitalize transition-colors border-b-2 -mb-px
                ${tab === t
                  ? 'dark:text-zinc-100 text-zinc-900 border-emerald-500'
                  : 'dark:text-zinc-500 text-zinc-400 border-transparent dark:hover:text-zinc-300 hover:text-zinc-600'}`}
            >
              {t === 'chat' ? 'Chat' : 'Commentary'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="px-5 pb-5">
          {tab === 'commentary' && <CommentaryFeed state={matchState} />}
          {tab === 'chat' && <MatchChat fixtureId={fixture.id} />}
        </div>
      </div>
    </div>
  );
}
