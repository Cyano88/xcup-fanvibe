import { useState } from 'react';
import { Trophy, Zap } from 'lucide-react';
import type { Fixture, MatchState } from '../types';

interface Props {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  onWatch: (fixtureId: string) => void;
}

// ── Layout constants ──────────────────────────────────────────────────────────
const CW = 158;  // card width
const CH = 54;   // card height
const SH = 62;   // vertical slot per R32 match
const CG = 46;   // column gap

const COL_X  = [0, CW + CG, 2 * (CW + CG), 3 * (CW + CG)] as const; // [0,204,408,612]
const ELBOW  = [CW + CG / 2, COL_X[1] + CW + CG / 2, COL_X[2] + CW + CG / 2] as const; // [181,385,589]
const SVG_W  = COL_X[3] + CW;  // 770
const SVG_H  = 8 * SH;          // 496

// Per-round y-centres (relative to top of bracket half)
const R32_Y = Array.from({ length: 8 }, (_, i) => i * SH + SH / 2);
const R16_Y = [0, 1, 2, 3].map(i => (R32_Y[i * 2] + R32_Y[i * 2 + 1]) / 2);
const QF_Y  = [0, 1].map(i => (R16_Y[i * 2] + R16_Y[i * 2 + 1]) / 2);
const SF_Y  = (QF_Y[0] + QF_Y[1]) / 2;

// Bracket halves
const UPPER_IDS = {
  r32: ['r32-1','r32-2','r32-3','r32-4','r32-5','r32-6','r32-7','r32-8'],
  r16: ['r16-1','r16-2','r16-3','r16-4'],
  qf:  ['qf-1','qf-2'],
  sf:  'sf-1',
};
const LOWER_IDS = {
  r32: ['r32-9','r32-10','r32-11','r32-12','r32-13','r32-14','r32-15','r32-16'],
  r16: ['r16-5','r16-6','r16-7','r16-8'],
  qf:  ['qf-3','qf-4'],
  sf:  'sf-2',
};

// ── MiniCard ──────────────────────────────────────────────────────────────────
function MiniCard({
  fixture, ms, onClick,
}: {
  fixture?: Fixture;
  ms?: MatchState;
  onClick: () => void;
}) {
  if (!fixture) return null;

  const isTBD    = fixture.home.code === 'TBD' && fixture.away.code === 'TBD';
  const isLive   = ms?.status === 'live';
  const isDone   = ms?.status === 'finished';
  const hasScore = isLive || isDone;
  const homeWin  = isDone && ms && ms.homeScore > ms.awayScore;
  const awayWin  = isDone && ms && ms.awayScore > ms.homeScore;
  const clickable = isLive || isDone;

  return (
    <button
      onClick={clickable ? onClick : undefined}
      style={{ width: CW, height: CH }}
      className={`flex flex-col justify-between px-2.5 py-1.5 rounded-xl border text-left transition-all duration-150
        ${clickable ? 'active:scale-95 cursor-pointer' : 'cursor-default'}
        ${isTBD
          ? 'opacity-35 dark:bg-zinc-900 bg-zinc-100 dark:border-zinc-800 border-zinc-200'
          : isLive
            ? 'dark:bg-emerald-500/8 bg-emerald-50 dark:border-emerald-500/30 border-emerald-200 shadow-sm shadow-emerald-500/10 dark:hover:border-emerald-400/50 hover:border-emerald-300'
            : isDone
              ? 'dark:bg-zinc-900/70 bg-zinc-50 dark:border-zinc-700 border-zinc-200 dark:hover:border-zinc-600 hover:border-zinc-300'
              : 'dark:bg-zinc-900 bg-white dark:border-zinc-800 border-zinc-200'}`}
    >
      {/* Home row */}
      <div className="flex items-center justify-between gap-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-sm leading-none shrink-0">{fixture.home.flag}</span>
          <span className={`text-[11px] font-mono font-bold truncate ${homeWin ? 'dark:text-emerald-300 text-emerald-700' : 'dark:text-zinc-200 text-zinc-700'}`}>
            {fixture.home.code}
          </span>
        </div>
        {hasScore ? (
          <span className={`text-sm font-black tabular-nums leading-none ${homeWin ? 'dark:text-emerald-300 text-emerald-600' : 'dark:text-zinc-100 text-zinc-800'}`}>
            {ms!.homeScore}
          </span>
        ) : (
          <span className="text-[10px] font-mono dark:text-zinc-600 text-zinc-400 shrink-0">
            {fixture.baseOdds.home}%
          </span>
        )}
      </div>

      {/* Divider + status */}
      <div className="flex items-center gap-1">
        <div className="flex-1 border-t dark:border-zinc-800 border-zinc-200" />
        {isLive ? (
          <span className="text-[9px] font-mono font-bold text-emerald-400 flex items-center gap-0.5 shrink-0">
            <Zap size={7} className="animate-pulse" />{ms!.minute}&apos;
          </span>
        ) : isDone ? (
          <span className="text-[9px] font-mono text-purple-400 shrink-0">FT</span>
        ) : (
          <span className="text-[9px] font-mono dark:text-zinc-700 text-zinc-400 shrink-0">VS</span>
        )}
        <div className="flex-1 border-t dark:border-zinc-800 border-zinc-200" />
      </div>

      {/* Away row */}
      <div className="flex items-center justify-between gap-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-sm leading-none shrink-0">{fixture.away.flag}</span>
          <span className={`text-[11px] font-mono font-bold truncate ${awayWin ? 'dark:text-emerald-300 text-emerald-700' : 'dark:text-zinc-200 text-zinc-700'}`}>
            {fixture.away.code}
          </span>
        </div>
        {hasScore ? (
          <span className={`text-sm font-black tabular-nums leading-none ${awayWin ? 'dark:text-emerald-300 text-emerald-600' : 'dark:text-zinc-100 text-zinc-800'}`}>
            {ms!.awayScore}
          </span>
        ) : (
          <span className="text-[10px] font-mono dark:text-zinc-600 text-zinc-400 shrink-0">
            {fixture.baseOdds.away}%
          </span>
        )}
      </div>
    </button>
  );
}

// ── Connector SVG lines ───────────────────────────────────────────────────────
interface Seg { x1: number; y1: number; x2: number; y2: number }

function buildHalfLines(): Seg[] {
  const segs: Seg[] = [];

  // R32 → R16 (4 pairs)
  for (let i = 0; i < 4; i++) {
    const ex  = ELBOW[0];
    const y0  = R32_Y[i * 2];
    const y1  = R32_Y[i * 2 + 1];
    const yr  = R16_Y[i];
    segs.push(
      { x1: CW, y1: y0, x2: ex, y2: y0 },
      { x1: CW, y1: y1, x2: ex, y2: y1 },
      { x1: ex, y1: y0, x2: ex, y2: y1 },
      { x1: ex, y1: yr, x2: COL_X[1], y2: yr },
    );
  }

  // R16 → QF (2 pairs)
  for (let i = 0; i < 2; i++) {
    const ex  = ELBOW[1];
    const y0  = R16_Y[i * 2];
    const y1  = R16_Y[i * 2 + 1];
    const yq  = QF_Y[i];
    segs.push(
      { x1: COL_X[1] + CW, y1: y0, x2: ex, y2: y0 },
      { x1: COL_X[1] + CW, y1: y1, x2: ex, y2: y1 },
      { x1: ex, y1: y0, x2: ex, y2: y1 },
      { x1: ex, y1: yq, x2: COL_X[2], y2: yq },
    );
  }

  // QF → SF (1 pair)
  {
    const ex = ELBOW[2];
    segs.push(
      { x1: COL_X[2] + CW, y1: QF_Y[0], x2: ex, y2: QF_Y[0] },
      { x1: COL_X[2] + CW, y1: QF_Y[1], x2: ex, y2: QF_Y[1] },
      { x1: ex, y1: QF_Y[0], x2: ex, y2: QF_Y[1] },
      { x1: ex, y1: SF_Y, x2: COL_X[3], y2: SF_Y },
    );
  }

  return segs;
}
const HALF_LINES = buildHalfLines();

// ── HalfBracket ───────────────────────────────────────────────────────────────
function HalfBracket({
  ids, fixtures, matchStates, onWatch,
}: {
  ids: typeof UPPER_IDS;
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  onWatch: (id: string) => void;
}) {
  const fxMap = Object.fromEntries(fixtures.map(f => [f.id, f]));

  type Card = { id: string; x: number; yCenter: number };
  const cards: Card[] = [
    ...ids.r32.map((id, i) => ({ id, x: COL_X[0], yCenter: R32_Y[i] })),
    ...ids.r16.map((id, i) => ({ id, x: COL_X[1], yCenter: R16_Y[i] })),
    ...ids.qf.map((id, i)  => ({ id, x: COL_X[2], yCenter: QF_Y[i]  })),
    { id: ids.sf, x: COL_X[3], yCenter: SF_Y },
  ];

  return (
    <div className="relative overflow-x-auto">
      <div className="relative" style={{ width: SVG_W, height: SVG_H }}>
        <svg
          className="absolute inset-0 pointer-events-none dark:text-zinc-700 text-zinc-300"
          width={SVG_W}
          height={SVG_H}
        >
          {HALF_LINES.map((s, i) => (
            <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
              stroke="currentColor" strokeWidth={1.5} />
          ))}
        </svg>

        {cards.map(({ id, x, yCenter }) => (
          <div key={id} className="absolute" style={{ left: x, top: yCenter - CH / 2 }}>
            <MiniCard
              fixture={fxMap[id]}
              ms={matchStates[id]}
              onClick={() => onWatch(id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FinalStage ────────────────────────────────────────────────────────────────
function FinalStage({
  fixtures, matchStates, onWatch,
}: {
  fixtures: Fixture[];
  matchStates: Record<string, MatchState>;
  onWatch: (id: string) => void;
}) {
  const fxMap = Object.fromEntries(fixtures.map(f => [f.id, f]));

  const sf1Y   = 10;
  const sf2Y   = sf1Y + CH + 44;  // 108
  const midY   = (sf1Y + CH / 2 + sf2Y + CH / 2) / 2;  // center between the two SFs
  const finalY = midY - CH / 2;
  const thirdY  = sf2Y + CH + 36;

  const colSF = 0;
  const colF  = CW + CG;
  const totalW = colF + CW;
  const totalH = thirdY + CH + 24;

  const ex = CW + CG / 2;
  const segs: Seg[] = [
    { x1: CW, y1: sf1Y + CH / 2, x2: ex, y2: sf1Y + CH / 2 },
    { x1: CW, y1: sf2Y + CH / 2, x2: ex, y2: sf2Y + CH / 2 },
    { x1: ex, y1: sf1Y + CH / 2, x2: ex, y2: sf2Y + CH / 2 },
    { x1: ex, y1: midY,          x2: colF, y2: midY },
  ];

  return (
    <div className="relative overflow-x-auto">
      <div className="relative" style={{ width: totalW, height: totalH }}>
        <svg
          className="absolute inset-0 pointer-events-none dark:text-zinc-700 text-zinc-300"
          width={totalW}
          height={totalH}
        >
          {segs.map((s, i) => (
            <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
              stroke="currentColor" strokeWidth={1.5} />
          ))}
        </svg>

        <div className="absolute" style={{ left: colSF, top: sf1Y }}>
          <div className="text-[9px] font-mono dark:text-zinc-600 text-zinc-400 uppercase tracking-wider mb-1">Semi-Final 1</div>
          <MiniCard fixture={fxMap['sf-1']} ms={matchStates['sf-1']} onClick={() => onWatch('sf-1')} />
        </div>

        <div className="absolute" style={{ left: colSF, top: sf2Y }}>
          <div className="text-[9px] font-mono dark:text-zinc-600 text-zinc-400 uppercase tracking-wider mb-1">Semi-Final 2</div>
          <MiniCard fixture={fxMap['sf-2']} ms={matchStates['sf-2']} onClick={() => onWatch('sf-2')} />
        </div>

        <div className="absolute" style={{ left: colF, top: finalY }}>
          <div className="text-[9px] font-mono dark:text-zinc-600 text-zinc-400 uppercase tracking-wider mb-1 text-center">🏆 Final</div>
          <MiniCard fixture={fxMap['f-1']} ms={matchStates['f-1']} onClick={() => onWatch('f-1')} />
        </div>

        <div className="absolute" style={{ left: colSF, top: thirdY }}>
          <div className="text-[9px] font-mono dark:text-zinc-600 text-zinc-400 uppercase tracking-wider mb-1">3rd Place</div>
          <MiniCard fixture={fxMap['3pl-1']} ms={matchStates['3pl-1']} onClick={() => onWatch('3pl-1')} />
        </div>
      </div>
    </div>
  );
}

// ── BracketView ───────────────────────────────────────────────────────────────
const ROUND_COLS = ['Round of 32', 'Round of 16', 'Quarter-Final', 'Semi-Final'] as const;

export function BracketView({ fixtures, matchStates, onWatch }: Props) {
  const [half, setHalf] = useState<'upper' | 'lower' | 'final'>('upper');

  return (
    <div className="dark:bg-zinc-900/40 bg-zinc-50 border dark:border-zinc-800 border-zinc-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-zinc-800 border-zinc-200">
        <div className="flex items-center gap-2">
          <Trophy size={14} className="dark:text-zinc-400 text-zinc-500" />
          <span className="text-sm font-bold dark:text-zinc-200 text-zinc-700">Tournament Bracket</span>
        </div>
        <div className="flex items-center gap-1 p-0.5 dark:bg-zinc-800/60 bg-zinc-100 rounded-lg border dark:border-zinc-700/50 border-zinc-200">
          {(['upper', 'lower', 'final'] as const).map(h => (
            <button
              key={h}
              onClick={() => setHalf(h)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all duration-150
                ${half === h
                  ? 'dark:bg-zinc-700 bg-white dark:text-zinc-100 text-zinc-800 shadow-sm'
                  : 'dark:text-zinc-500 text-zinc-400 dark:hover:text-zinc-300 hover:text-zinc-600'}`}
            >
              {h === 'upper' ? 'M1–8' : h === 'lower' ? 'M9–16' : 'Final'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        {/* Column headers (not shown for Final tab) */}
        {half !== 'final' && (
          <div className="flex px-4 pt-3" style={{ width: SVG_W + 32, minWidth: SVG_W + 32 }}>
            {ROUND_COLS.map((label, i) => (
              <div
                key={label}
                className="shrink-0 text-[10px] font-mono font-bold dark:text-zinc-600 text-zinc-400 uppercase tracking-wider"
                style={{ width: i < 3 ? CW + CG : CW }}
              >
                {label}
              </div>
            ))}
          </div>
        )}

        <div className="px-4 pb-4 pt-2">
          {half === 'upper' && (
            <HalfBracket ids={UPPER_IDS} fixtures={fixtures} matchStates={matchStates} onWatch={onWatch} />
          )}
          {half === 'lower' && (
            <HalfBracket ids={LOWER_IDS} fixtures={fixtures} matchStates={matchStates} onWatch={onWatch} />
          )}
          {half === 'final' && (
            <FinalStage fixtures={fixtures} matchStates={matchStates} onWatch={onWatch} />
          )}
        </div>
      </div>
    </div>
  );
}
