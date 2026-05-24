import { useEffect, useRef } from 'react';
import { X, Zap } from 'lucide-react';
import type { Fixture, MatchState } from '../types';

interface Props {
  fixture: Fixture;
  matchState: MatchState;
  onClose: () => void;
}

// ── SVG Pitch ────────────────────────────────────────────────────────────────

function Pitch({ fixture, state }: { fixture: Fixture; state: MatchState }) {
  const homeAttacking = state.possession > 50;
  // Blob center X: home blob shifts right when attacking, left when defending
  const homeBlobX = homeAttacking ? 55 + (state.possession - 50) * 0.6 : 45 - (50 - state.possession) * 0.4;
  const awayBlobX = 100 - homeBlobX;

  return (
    <svg viewBox="0 0 400 220" className="w-full rounded-xl overflow-hidden" style={{ maxHeight: 220 }}>
      {/* Pitch surface */}
      <rect width="400" height="220" fill="#1a4a1a" rx="8" />
      {/* Stripe pattern */}
      {[0,1,2,3,4,5,6].map(i => (
        <rect key={i} x={i * 57} y="0" width="28" height="220" fill="#1d521d" opacity="0.5" />
      ))}
      {/* Boundary */}
      <rect x="15" y="15" width="370" height="190" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      {/* Center line */}
      <line x1="200" y1="15" x2="200" y2="205" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      {/* Center circle */}
      <circle cx="200" cy="110" r="35" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      <circle cx="200" cy="110" r="2" fill="rgba(255,255,255,0.6)" />
      {/* Left penalty box */}
      <rect x="15" y="60" width="60" height="100" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      <rect x="15" y="82" width="25" height="56" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      <circle cx="70" cy="110" r="2" fill="rgba(255,255,255,0.5)" />
      {/* Right penalty box */}
      <rect x="325" y="60" width="60" height="100" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      <rect x="360" y="82" width="25" height="56" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      <circle cx="330" cy="110" r="2" fill="rgba(255,255,255,0.5)" />
      {/* Goals */}
      <rect x="8" y="90" width="8" height="40" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
      <rect x="384" y="90" width="8" height="40" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />

      {/* Home team pressure blob */}
      <ellipse
        cx={`${homeBlobX * 4}`}
        cy="110"
        rx="55" ry="42"
        fill="rgba(52,211,153,0.18)"
        style={{ transition: 'cx 2s ease-in-out' }}
      />
      {/* Away team pressure blob */}
      <ellipse
        cx={`${awayBlobX * 4}`}
        cy="110"
        rx="55" ry="42"
        fill="rgba(251,191,36,0.18)"
        style={{ transition: 'cx 2s ease-in-out' }}
      />

      {/* Team labels */}
      <text x="80" y="210" textAnchor="middle" fill="rgba(52,211,153,0.8)" fontSize="11" fontFamily="monospace" fontWeight="bold">
        {fixture.home.code}
      </text>
      <text x="320" y="210" textAnchor="middle" fill="rgba(251,191,36,0.8)" fontSize="11" fontFamily="monospace" fontWeight="bold">
        {fixture.away.code}
      </text>

      {/* Ball — positioned near most recent event */}
      <circle cx="200" cy="110" r="5" fill="white" opacity="0.9">
        <animate attributeName="cx" values="195;205;195" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="cy" values="108;112;108" dur="2.1s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

// ── Commentary feed ───────────────────────────────────────────────────────────

function CommentaryFeed({ state }: { state: MatchState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [state.events.length]);

  const isGoal = (type: string) => type.startsWith('goal') || type === 'var';
  const isCard = (type: string) => type.startsWith('yellow') || type.startsWith('red');

  return (
    <div ref={ref} className="h-40 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
      {state.events.length === 0 && (
        <p className="text-xs text-zinc-500 text-center pt-8 font-mono">Waiting for kick off…</p>
      )}
      {[...state.events].reverse().map(ev => (
        <div key={ev.id} className={`flex items-start gap-2 text-xs rounded-lg px-2 py-1.5 transition-colors
          ${isGoal(ev.type) ? 'bg-emerald-500/10 border border-emerald-500/20' :
            isCard(ev.type) ? 'bg-amber-500/10 border border-amber-500/20' :
            'bg-zinc-900/60 dark:bg-zinc-900/60 border border-transparent'}`}>
          <span className="font-mono text-zinc-600 shrink-0 w-6 text-right">{ev.minute}'</span>
          <span className={`leading-snug ${isGoal(ev.type) ? 'text-emerald-300 font-semibold' : isCard(ev.type) ? 'text-amber-300' : 'text-zinc-300 dark:text-zinc-300'}`}>
            {ev.commentary}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main MatchViewer ──────────────────────────────────────────────────────────

export function MatchViewer({ fixture, matchState, onClose }: Props) {
  const isLive     = matchState.status === 'live';
  const isFinished = matchState.status === 'finished';
  const progress   = Math.min(100, (matchState.minute / 90) * 100);

  const outcome = isFinished
    ? matchState.homeScore > matchState.awayScore ? 'home'
    : matchState.awayScore > matchState.homeScore ? 'away'
    : 'draw'
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg dark:bg-zinc-950 bg-white border dark:border-zinc-800 border-zinc-200 rounded-2xl shadow-2xl overflow-hidden animate-slide-in">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b dark:border-zinc-800 border-zinc-100">
          <div className="flex items-center gap-2">
            {isLive && <Zap size={14} className="text-emerald-400 animate-pulse" />}
            <span className="text-sm font-bold dark:text-zinc-100 text-zinc-900">
              {fixture.home.flag} {fixture.home.code} vs {fixture.away.code} {fixture.away.flag}
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
        <div className="flex items-center justify-center gap-6 py-5">
          <div className="text-center">
            <div className="text-4xl mb-1">{fixture.home.flag}</div>
            <div className="text-xs font-mono dark:text-zinc-400 text-zinc-500">{fixture.home.name}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-5xl font-black dark:text-white text-zinc-900 tabular-nums">{matchState.homeScore}</span>
            <span className="text-2xl dark:text-zinc-600 text-zinc-300">–</span>
            <span className="text-5xl font-black dark:text-white text-zinc-900 tabular-nums">{matchState.awayScore}</span>
          </div>
          <div className="text-center">
            <div className="text-4xl mb-1">{fixture.away.flag}</div>
            <div className="text-xs font-mono dark:text-zinc-400 text-zinc-500">{fixture.away.name}</div>
          </div>
        </div>

        {/* Match result banner */}
        {isFinished && outcome && (
          <div className={`mx-5 mb-3 py-2 px-4 rounded-xl text-center text-sm font-bold
            ${outcome === 'home' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
              outcome === 'away' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
              'bg-zinc-700/40 text-zinc-300 border border-zinc-600/30'}`}>
            {outcome === 'draw' ? '🤝 Draw — stakers refunded' :
             outcome === 'home' ? `🏆 ${fixture.home.name} win — payouts sent` :
             `🏆 ${fixture.away.name} win — payouts sent`}
          </div>
        )}

        {/* Progress bar */}
        <div className="px-5 mb-3">
          <div className="flex justify-between text-[10px] font-mono dark:text-zinc-700 text-zinc-400 mb-1">
            <span>0'</span>
            <span className="dark:text-zinc-500 text-zinc-500">{isLive ? `${matchState.minute}'` : isFinished ? 'FT' : '—'}</span>
            <span>90'</span>
          </div>
          <div className="h-1 dark:bg-zinc-800 bg-zinc-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${isFinished ? 'bg-purple-500' : 'bg-emerald-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] font-mono dark:text-zinc-700 text-zinc-300 mt-0.5">
            <span>HT 45'</span>
            <span className="dark:text-zinc-600 text-zinc-400">{fixture.home.code} {matchState.possession}% poss</span>
            <span>FT 90'</span>
          </div>
        </div>

        {/* Pitch */}
        <div className="px-5 mb-3">
          <Pitch fixture={fixture} state={matchState} />
        </div>

        {/* Commentary */}
        <div className="px-5 pb-5">
          <div className="text-[10px] font-mono dark:text-zinc-600 text-zinc-400 uppercase tracking-widest mb-2">Commentary</div>
          <CommentaryFeed state={matchState} />
        </div>
      </div>
    </div>
  );
}
