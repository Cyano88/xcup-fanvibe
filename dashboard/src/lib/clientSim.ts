import type { Fixture, MatchState, MatchEvent } from '../types';
import { SQUADS } from './squadData';

// ── Strength + squad data (mirrors backend, lives here for offline demo) ──────

export const STRENGTH: Record<string, number> = {
  ARG:95, FRA:93, BRA:92, ENG:88, ESP:87, GER:86, POR:85, NED:83,
  BEL:82, CRO:77, URU:77, MAR:75, SEN:74, JPN:73, SWE:76, NOR:74,
  COL:72, MEX:72, SUI:71, CAN:71, USA:70, TUR:69, CIV:69, AUS:67,
  KOR:67, ECU:66, ALG:65, EGY:64, KSA:61, AUT:68, CZE:66, SCO:65,
  GHA:60, PAR:60, TUN:60, IRN:61, RSA:57, COD:56, BIH:58, IRQ:52,
  QAT:52, CPV:48, PAN:48, JOR:48, UZB:50, NZL:45, HAI:42, CUW:35,
};

type Confederation = 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'CAF' | 'AFC' | 'OFC';
type TeamCalibration = {
  fifaPoints?: number;
  recentForm: number;
  confederation: Confederation;
};

const TEAM_CALIBRATION: Record<string, TeamCalibration> = {
  FRA: { fifaPoints: 1877.32, recentForm: 5, confederation: 'UEFA' },
  ESP: { fifaPoints: 1876.40, recentForm: 5, confederation: 'UEFA' },
  ARG: { fifaPoints: 1874.81, recentForm: 4, confederation: 'CONMEBOL' },
  ENG: { fifaPoints: 1816.00, recentForm: 3, confederation: 'UEFA' },
  POR: { fifaPoints: 1778.00, recentForm: 4, confederation: 'UEFA' },
  BRA: { fifaPoints: 1776.00, recentForm: 1, confederation: 'CONMEBOL' },
  NED: { fifaPoints: 1750.00, recentForm: 2, confederation: 'UEFA' },
  MAR: { fifaPoints: 1710.00, recentForm: 5, confederation: 'CAF' },
  BEL: { fifaPoints: 1705.00, recentForm: 0, confederation: 'UEFA' },
  GER: { fifaPoints: 1700.00, recentForm: 2, confederation: 'UEFA' },
  CRO: { fifaPoints: 1690.00, recentForm: 1, confederation: 'UEFA' },
  URU: { fifaPoints: 1680.00, recentForm: 4, confederation: 'CONMEBOL' },
  COL: { fifaPoints: 1665.00, recentForm: 4, confederation: 'CONMEBOL' },
  MEX: { fifaPoints: 1650.00, recentForm: 1, confederation: 'CONCACAF' },
  USA: { fifaPoints: 1640.00, recentForm: 1, confederation: 'CONCACAF' },
  SUI: { fifaPoints: 1635.00, recentForm: 1, confederation: 'UEFA' },
  SEN: { fifaPoints: 1628.00, recentForm: 4, confederation: 'CAF' },
  JPN: { fifaPoints: 1620.00, recentForm: 4, confederation: 'AFC' },
  IRN: { fifaPoints: 1610.00, recentForm: 2, confederation: 'AFC' },
  KOR: { fifaPoints: 1585.00, recentForm: 2, confederation: 'AFC' },
  ECU: { fifaPoints: 1580.00, recentForm: 2, confederation: 'CONMEBOL' },
  AUT: { fifaPoints: 1575.00, recentForm: 3, confederation: 'UEFA' },
  AUS: { fifaPoints: 1545.00, recentForm: 1, confederation: 'AFC' },
  ALG: { fifaPoints: 1538.00, recentForm: 1, confederation: 'CAF' },
  EGY: { fifaPoints: 1535.00, recentForm: 1, confederation: 'CAF' },
  TUR: { fifaPoints: 1530.00, recentForm: 1, confederation: 'UEFA' },
  CIV: { fifaPoints: 1525.00, recentForm: 2, confederation: 'CAF' },
  SWE: { fifaPoints: 1520.00, recentForm: 0, confederation: 'UEFA' },
  NOR: { fifaPoints: 1515.00, recentForm: 1, confederation: 'UEFA' },
  CZE: { fifaPoints: 1510.00, recentForm: 0, confederation: 'UEFA' },
  SCO: { fifaPoints: 1505.00, recentForm: 0, confederation: 'UEFA' },
  KSA: { fifaPoints: 1450.00, recentForm: 0, confederation: 'AFC' },
  GHA: { fifaPoints: 1448.00, recentForm: -1, confederation: 'CAF' },
  PAR: { fifaPoints: 1445.00, recentForm: -1, confederation: 'CONMEBOL' },
  TUN: { fifaPoints: 1440.00, recentForm: 0, confederation: 'CAF' },
  RSA: { fifaPoints: 1410.00, recentForm: 2, confederation: 'CAF' },
  COD: { fifaPoints: 1400.00, recentForm: 1, confederation: 'CAF' },
  BIH: { fifaPoints: 1395.00, recentForm: -1, confederation: 'UEFA' },
  IRQ: { fifaPoints: 1388.00, recentForm: 2, confederation: 'AFC' },
  QAT: { fifaPoints: 1380.00, recentForm: 0, confederation: 'AFC' },
  UZB: { fifaPoints: 1375.00, recentForm: 3, confederation: 'AFC' },
  JOR: { fifaPoints: 1355.00, recentForm: 2, confederation: 'AFC' },
  CPV: { fifaPoints: 1340.00, recentForm: 3, confederation: 'CAF' },
  PAN: { fifaPoints: 1338.00, recentForm: 2, confederation: 'CONCACAF' },
  NZL: { fifaPoints: 1295.00, recentForm: 2, confederation: 'OFC' },
  HAI: { fifaPoints: 1265.00, recentForm: 0, confederation: 'CONCACAF' },
  CUW: { fifaPoints: 1235.00, recentForm: 1, confederation: 'CONCACAF' },
};

const CONFEDERATION_ADJUSTMENT: Record<Confederation, number> = {
  UEFA: 1.4,
  CONMEBOL: 1.2,
  CAF: 0.4,
  CONCACAF: 0.1,
  AFC: -0.3,
  OFC: -1.0,
};

type CalibratedStrength = {
  homeRating: number;
  awayRating: number;
  ratingGap: number;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  homeAttackShare: number;
  awayAttackShare: number;
  homeGoalPerMinute: number;
  awayGoalPerMinute: number;
  upsetVolatility: number;
  knockoutPressure: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function calibrateTeamStrength(fixture: Fixture): CalibratedStrength {
  const homeRating = calibratedRating(fixture.home.code);
  const awayRating = calibratedRating(fixture.away.code);
  const ratingGap = homeRating - awayRating;
  const knockoutPressure = fixture.round && fixture.round !== 'R32' ? 1 : 0;
  const upsetVolatility = clamp(0.10 + Math.abs(ratingGap) * 0.004 + knockoutPressure * 0.05, 0.10, 0.24);
  const compressedGap = ratingGap * (1 - upsetVolatility);
  const expectedHome = 1 / (1 + 10 ** (-compressedGap / 42));
  const drawProbability = clamp(0.30 - Math.abs(compressedGap) * 0.003 + knockoutPressure * 0.025, 0.18, 0.33);
  const decisiveProbability = 1 - drawProbability;
  const homeWinProbability = decisiveProbability * expectedHome;
  const awayWinProbability = decisiveProbability - homeWinProbability;
  const homeAttackShare = clamp(homeWinProbability + drawProbability * 0.5, 0.36, 0.64);
  const awayAttackShare = 1 - homeAttackShare;
  const averageRating = (homeRating + awayRating) / 2;
  const totalGoalsPerMatch = clamp(
    2.18 + (averageRating - 62) * 0.012 + Math.abs(compressedGap) * 0.005 - knockoutPressure * 0.08,
    1.75,
    3.15,
  );

  return {
    homeRating,
    awayRating,
    ratingGap,
    homeWinProbability,
    drawProbability,
    awayWinProbability,
    homeAttackShare,
    awayAttackShare,
    homeGoalPerMinute: (totalGoalsPerMatch * homeAttackShare) / 90,
    awayGoalPerMinute: (totalGoalsPerMatch * awayAttackShare) / 90,
    upsetVolatility,
    knockoutPressure,
  };
}

function calibratedRating(teamCode: string): number {
  const baseRating = STRENGTH[teamCode] ?? 62;
  const context = TEAM_CALIBRATION[teamCode];
  if (!context) return baseRating;

  const fifaRating = context.fifaPoints
    ? clamp(42 + (context.fifaPoints - 1230) / 10.2, 36, 96)
    : baseRating;
  const confedAdjustment = CONFEDERATION_ADJUSTMENT[context.confederation] ?? 0;
  return clamp(baseRating * 0.58 + fifaRating * 0.42 + context.recentForm * 0.75 + confedAdjustment, 34, 97);
}

const PLAYERS: Record<string, string[]> = {
  ARG: ['Messi','Lautaro','Di María','Mac Allister','De Paul','Fernández','Otamendi','Molina'],
  FRA: ['Mbappé','Griezmann','Thuram','Dembélé','Camavinga','Tchouaméni','Saliba','Upamecano'],
  BRA: ['Vinicius Jr','Rodrygo','Paquetá','Endrick','Savinho','Bruno Guimarães','Marquinhos','Militão'],
  ENG: ['Bellingham','Kane','Saka','Foden','Alexander-Arnold','Rice','Walker','Stones'],
  ESP: ['Yamal','Nico Williams','Pedri','Rodri','Morata','Gavi','Carvajal','Le Normand'],
  GER: ['Musiala','Wirtz','Havertz','Kimmich','Gündogan','Gnabry','Rüdiger','Schlotterbeck'],
  POR: ['Ronaldo','Félix','Leão','Bernardo Silva','Vitinha','Neves','Rúben Dias','Cancelo'],
  NED: ['Gakpo','van Dijk','de Jong','Reijnders','Depay','Dumfries','de Ligt','Veerman'],
  BEL: ['De Bruyne','Lukaku','Trossard','Doku','Onana','Mangala','Vertonghen','Faes'],
  CRO: ['Modrić','Kovačić','Gvardiol','Kramarić','Perisić','Sosa','Pašalić','Šutalo'],
  MAR: ['En-Nesyri','Hakimi','Ziyech','Ounahi','Amrabat','Boufal','Saiss','Bounou'],
  URU: ['Núñez','Valverde','Bentancur','Araújo','Pellistri','Ugarte','De Arrascaeta','Olivera'],
  COL: ['L. Díaz','J. Díaz','Cuadrado','Borré','Arias','Cuesta','Ospina','Quintero'],
  SEN: ['Mané','Dia','Sarr','Gueye','Koulibaly','Sabaly','Diatta','Mendy'],
  JPN: ['Kubo','Mitoma','Doan','Endo','Kamada','Tomiyasu','Taniguchi','Maeda'],
  MEX: ['Jiménez','Lozano','Antuna','Álvarez','Herrera','Sánchez','Moreno','Ochoa'],
  USA: ['Pulisic','Reyna','McKennie','Musah','Aaronson','Turner','Dest','Richards'],
  CAN: ['Davies','David','Buchanan','Larin','Johnston','Eustáquio','Henry','Adekugbe'],
  TUR: ['Çalhanoğlu','Karaman','Yildiz','Yazici','Kahveci','Söyüncü','Çelik','Günok'],
  SUI: ['Xhaka','Shaqiri','Embolo','Vargas','Freuler','Akanji','Elvedi','Sommer'],
  AUS: ['Leckie','Mabil','Irvine','Mooy','McGree','Ryan','Souttar','Rowles'],
  EGY: ['Salah','Trezeguet','Elneny','Mostafa Mohamed','El-Shenawy','Hamdy','Galal','El-Solia'],
  KOR: ['Son Heung-min','Hwang Hee-chan','Lee Jae-sung','Kim Min-jae','Jung Woo-young','Na Sang-ho','Hwang In-beom','Jo Hyeon-woo'],
  CIV: ['Haller','Zaha','Kessié','Sangaré','Konaté','Gradel','Bailly','Fofana'],
  ECU: ['Valencia','Caicedo','Plata','Preciado','Estupiñán','Pacho','Cifuentes','Domínguez'],
  ALG: ['Mahrez','Bennacer','Bensebaini','Atal','Slimani','Feghouli','Boudaoui','Zerrouki'],
  KSA: ['Al-Dawsari','Al-Shahrani','Al-Malki','Al-Faraj','Al-Buraikan','Al-Hamdan','Al-Owais','Al-Ghannam'],
};

let eid = 1000;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const pickPlayer = (code: string) => {
  const squad = SQUADS[code];
  const loaded = squad ? [...squad.starters, ...squad.substitutes].map(p => p.name) : [];
  if (loaded.length) return pick(loaded);
  const p = PLAYERS[code];
  return p?.length ? pick(p) : `${code} striker`;
};

function pickStarter(code: string): string {
  const squad = SQUADS[code];
  return squad?.starters.length ? pick(squad.starters).name : pickPlayer(code);
}

function pickSubstitution(code: string): { on: string; off: string } {
  const squad = SQUADS[code];
  if (!squad?.substitutes.length || !squad.starters.length) return { on: pickPlayer(code), off: pickPlayer(code) };
  return { on: pick(squad.substitutes).name, off: pick(squad.starters).name };
}

type LiveStateType = 'safe' | 'attack' | 'pressure' | 'throw' | 'free_kick' | 'foul' | 'offside';
const STOPPAGE_HOLD_MS = 7000;
const SHOT_RESTART_MS = 1800;

function goalEvent(minute: number, team: 'home' | 'away', fx: Fixture, hs: number, as_: number): MatchEvent {
  const code = team === 'home' ? fx.home.code : fx.away.code;
  const name = team === 'home' ? fx.home.name : fx.away.name;
  const scorer = pickPlayer(code);
  const assister = pickPlayer(code);
  const sign = team === 'home' ? 1 : -1;
  return {
    id: ++eid, minute, type: `goal_${team}`, team,
    player: scorer,
    player2: assister !== scorer ? assister : undefined,
    commentary: `${scorer} — GOAL! ${name} ${hs}–${as_}!`,
    lx: sign * 98,
    ly: (Math.random() - 0.5) * 16,
  };
}

function shotEvent(minute: number, team: 'home' | 'away', fx: Fixture, onTarget: boolean): MatchEvent {
  const side = team === 'home' ? fx.home : fx.away;
  const shooter = pickPlayer(side.code);
  const sign = team === 'home' ? 1 : -1;
  return {
    id: ++eid,
    minute,
    type: `${onTarget ? 'shot_on' : 'shot_off'}_${team}`,
    team,
    player: shooter,
    commentary: onTarget
      ? `${shooter} forces a save. Shot on target for ${side.name}.`
      : `${shooter} shoots off target. Goal kick coming.`,
    lx: sign * (onTarget ? 93 : 99),
    ly: (Math.random() > 0.5 ? 1 : -1) * (onTarget ? Math.random() * 18 : 24 + Math.random() * 20),
  };
}

function goalKickEvent(minute: number, team: 'home' | 'away', fx: Fixture): MatchEvent {
  const side = team === 'home' ? fx.home : fx.away;
  const taker = pickStarter(side.code);
  const sign = team === 'home' ? -1 : 1;
  return {
    id: ++eid,
    minute,
    type: `goal_kick_${team}`,
    team,
    player: taker,
    commentary: `Goal kick for ${side.name}. ${taker} restarts play.`,
    lx: sign * 86,
    ly: (Math.random() - 0.5) * 18,
  };
}

function liveStateEvent(minute: number, team: 'home' | 'away', fx: Fixture, type: LiveStateType): MatchEvent {
  const side = team === 'home' ? fx.home : fx.away;
  const actor = type === 'safe' ? pickStarter(side.code) : pickPlayer(side.code);
  const sign = team === 'home' ? 1 : -1;
  const finalThird = type === 'attack' || type === 'pressure' || type === 'free_kick' || type === 'offside';
  const lx = type === 'throw'
    ? sign * (-8 + Math.random() * 58)
    : type === 'foul'
      ? sign * (Math.random() * 46)
      : finalThird
        ? sign * (42 + Math.random() * 34)
        : -sign * (28 + Math.random() * 36);
  const ly = type === 'throw'
    ? (Math.random() > 0.5 ? 1 : -1) * (46 + Math.random() * 3)
    : (Math.random() - 0.5) * (finalThird ? 52 : 62);
  const label = type === 'safe' ? `Ball safe with ${side.name}.`
    : type === 'pressure' ? `${side.name} moving through the final third.`
    : type === 'throw' ? `Throw-in for ${side.name}. ${actor} to restart.`
    : type === 'free_kick' ? `Free kick for ${side.name}. ${actor} stands over it.`
    : type === 'foul' ? `Foul by ${actor}.`
    : type === 'offside' ? `${actor} caught offside.`
    : `${actor} leads the attack for ${side.name}.`;

  return {
    id: ++eid,
    minute,
    type: `${type}_${team}`,
    team,
    player: actor,
    commentary: label,
    lx,
    ly,
  };
}

function defendingTeam(team: 'home' | 'away'): 'home' | 'away' {
  return team === 'home' ? 'away' : 'home';
}

/**
 * Simulate a single match at `tickMs` per game-minute (6667ms default → ~10 min per match).
 * Returns a cleanup function.
 */
export function simulateMatch(
  fixture: Fixture,
  onUpdate: (state: MatchState) => void,
  tickMs = 6667,
  initialState?: MatchState,
): () => void {
  const calibration = calibrateTeamStrength(fixture);
  const hStr = calibration.homeRating;
  const aStr = calibration.awayRating;
  const hGoalPerMin = calibration.homeGoalPerMinute * (0.94 + Math.random() * 0.12);
  const aGoalPerMin = calibration.awayGoalPerMinute * (0.94 + Math.random() * 0.12);

  const state: MatchState = initialState
    ? {
      ...initialState,
      status: initialState.status === 'finished' ? 'finished' : initialState.status,
      events: [...initialState.events],
    }
    : {
      fixtureId: fixture.id,
      status: 'live',
      minute: 0,
      homeScore: 0,
      awayScore: 0,
      events: [{ id: ++eid, minute: 0, type: 'kickoff', team: 'neutral',
        commentary: `Kick off! ${fixture.home.name} vs ${fixture.away.name}`, lx: 0, ly: 0 }],
      simulatedKickoff: new Date().toISOString(),
      possession: Math.round(50 + (hStr - aStr) * 0.28),
    };
  if (state.status === 'finished') return () => {};
  onUpdate({ ...state, events: [...state.events] });

  let minute = Math.max(0, state.minute);
  const halfTimeBreakMs = Math.max(5000, Math.round(tickMs * 2.25));
  let halfTimeResume: ReturnType<typeof setTimeout> | null = null;
  const delayedEvents = new Set<ReturnType<typeof setTimeout>>();
  const substitutionsUsed: Record<'home' | 'away', number> = { home: 0, away: 0 };
  let pauseUntil = 0;

  const scheduleFollowUp = (delayMs: number, fn: () => void) => {
    const id = setTimeout(() => {
      delayedEvents.delete(id);
      if (state.status !== 'live') return;
      fn();
      onUpdate({ ...state, events: [...state.events] });
    }, delayMs);
    delayedEvents.add(id);
  };

  const holdForIncident = () => {
    pauseUntil = Math.max(pauseUntil, Date.now() + STOPPAGE_HOLD_MS);
  };

  const timer = setInterval(() => {
    if (state.status === 'half_time') return;
    if (Date.now() < pauseUntil) return;
    minute++;
    state.minute = minute;
    const eventsBefore = state.events.length;
    let incidentStopsPlay = false;
    state.possession = Math.round(
      Math.max(28, Math.min(72, state.possession + (Math.random() - 0.5) * 10 + (hStr - aStr) * 0.08))
    );

    if (Math.random() < hGoalPerMin) {
      state.homeScore++;
      state.events.push(goalEvent(minute, 'home', fixture, state.homeScore, state.awayScore));
      incidentStopsPlay = true;
      holdForIncident();
      scheduleFollowUp(STOPPAGE_HOLD_MS, () => {
        state.events.push(liveStateEvent(minute, 'away', fixture, 'safe'));
      });
    } else if (Math.random() < aGoalPerMin) {
      state.awayScore++;
      state.events.push(goalEvent(minute, 'away', fixture, state.homeScore, state.awayScore));
      incidentStopsPlay = true;
      holdForIncident();
      scheduleFollowUp(STOPPAGE_HOLD_MS, () => {
        state.events.push(liveStateEvent(minute, 'home', fixture, 'safe'));
      });
    }
    if (!incidentStopsPlay && Math.random() < 0.24) {
      const t = Math.random() < clamp(calibration.homeAttackShare + (Math.random() - 0.5) * calibration.upsetVolatility * 0.18, 0.34, 0.66) ? 'home' : 'away';
      const onTarget = Math.random() < 0.38;
      state.events.push(shotEvent(minute, t as 'home' | 'away', fixture, onTarget));
      if (!onTarget) {
        incidentStopsPlay = true;
        pauseUntil = Math.max(pauseUntil, Date.now() + SHOT_RESTART_MS);
        scheduleFollowUp(SHOT_RESTART_MS, () => {
          const restartTeam = defendingTeam(t as 'home' | 'away');
          state.events.push(goalKickEvent(minute, restartTeam, fixture));
          pauseUntil = Math.max(pauseUntil, Date.now() + STOPPAGE_HOLD_MS);
          scheduleFollowUp(STOPPAGE_HOLD_MS, () => {
            state.events.push(liveStateEvent(minute, restartTeam, fixture, 'safe'));
          });
        });
      }
    }
    if (Math.random() < 0.09) {
      const t = Math.random() < clamp(calibration.homeAttackShare + (Math.random() - 0.5) * calibration.upsetVolatility * 0.18, 0.34, 0.66) ? 'home' : 'away';
      const code = t === 'home' ? fixture.home.code : fixture.away.code;
      const taker = pickPlayer(code);
      const y = (Math.random() > 0.5 ? 1 : -1) * (42 + Math.random() * 6);
      state.events.push({ id: ++eid, minute, type: `corner_${t}`, team: t as 'home' | 'away',
        player: taker,
        commentary: `Corner for ${t === 'home' ? fixture.home.name : fixture.away.name}. ${taker} to take it.`,
        lx: (t === 'home' ? 1 : -1) * 97, ly: y });
      incidentStopsPlay = true;
      holdForIncident();
      scheduleFollowUp(STOPPAGE_HOLD_MS, () => {
        const attackingRetains = Math.random() < 0.54;
        const nextTeam = attackingRetains ? t : defendingTeam(t as 'home' | 'away');
        state.possession = nextTeam === 'home'
          ? Math.max(45, Math.min(72, state.possession + 8))
          : Math.max(28, Math.min(55, state.possession - 8));
        state.events.push(liveStateEvent(minute, nextTeam as 'home' | 'away', fixture, attackingRetains ? 'pressure' : 'safe'));
      });
    }
    if (Math.random() < 0.07) {
      const t = Math.random() < clamp(calibration.homeAttackShare + (Math.random() - 0.5) * calibration.upsetVolatility * 0.18, 0.34, 0.66) ? 'home' : 'away';
      const roll = Math.random();
      const type: LiveStateType = roll < 0.36 ? 'throw' : roll < 0.68 ? 'foul' : roll < 0.88 ? 'free_kick' : 'offside';
      const eventTeam = type === 'foul' ? (Math.random() < 0.5 ? 'home' : 'away') : t;
      state.events.push(liveStateEvent(minute, eventTeam as 'home' | 'away', fixture, type));
      incidentStopsPlay = true;
      holdForIncident();
      if (type === 'throw' || type === 'free_kick' || type === 'offside') {
        scheduleFollowUp(STOPPAGE_HOLD_MS, () => {
          const restartTeam = type === 'offside' ? defendingTeam(eventTeam as 'home' | 'away') : eventTeam;
          state.events.push(liveStateEvent(minute, restartTeam as 'home' | 'away', fixture, type === 'free_kick' && Math.random() < 0.48 ? 'pressure' : 'attack'));
        });
      }
    }
    if (Math.random() < 0.024) {
      const t = Math.random() < 0.5 ? 'home' : 'away';
      const code = t === 'home' ? fixture.home.code : fixture.away.code;
      const red = Math.random() < 0.12;
      const booked = pickPlayer(code);
      state.events.push({ id: ++eid, minute, type: `${red ? 'red' : 'yellow'}_${t}`, team: t as 'home' | 'away',
        player: booked,
        commentary: red ? `Red card for ${booked}. ${t === 'home' ? fixture.home.name : fixture.away.name} are down to ten.` : `Yellow card for ${booked}.`,
        lx: (t === 'home' ? 1 : -1) * (30 + Math.random() * 50), ly: (Math.random() - 0.5) * 80 });
      incidentStopsPlay = true;
      holdForIncident();
    }
    if (minute >= 55 && minute <= 82 && Math.random() < 0.055) {
      const t = Math.random() < 0.5 ? 'home' : 'away';
      if (substitutionsUsed[t] < 5) {
        substitutionsUsed[t]++;
        const code = t === 'home' ? fixture.home.code : fixture.away.code;
        const sub = pickSubstitution(code);
        state.events.push({
          id: ++eid,
          minute,
          type: `sub_${t}`,
          team: t,
          player: sub.on,
          player2: sub.off,
          commentary: `Substitution ${t === 'home' ? fixture.home.name : fixture.away.name}: ${sub.on} replaces ${sub.off}.`,
          lx: 0,
          ly: t === 'home' ? 48 : -48,
        });
        incidentStopsPlay = true;
        holdForIncident();
      }
    }
    if (!incidentStopsPlay && Math.random() < 0.12) {
      const t = Math.random() < clamp(calibration.homeAttackShare + (Math.random() - 0.5) * calibration.upsetVolatility * 0.18, 0.34, 0.66) ? 'home' : 'away';
      state.events.push(liveStateEvent(minute, t as 'home' | 'away', fixture, 'safe'));
    }
    if (!incidentStopsPlay && state.events.length === eventsBefore) {
      const t = Math.random() < (state.possession / 100) ? 'home' : 'away';
      const roll = Math.random();
      state.events.push(liveStateEvent(
        minute,
        t as 'home' | 'away',
        fixture,
        roll < 0.34 ? 'safe' : roll < 0.78 ? 'attack' : 'pressure',
      ));
    }
    if (minute === 45) {
      state.status = 'half_time';
      state.events.push({ id: ++eid, minute: 45, type: 'half_time', team: 'neutral',
        commentary: `HALF TIME — ${fixture.home.name} ${state.homeScore}–${state.awayScore} ${fixture.away.name}`,
        lx: 0, ly: 0 });
      onUpdate({ ...state, events: [...state.events] });
      halfTimeResume = setTimeout(() => {
        state.status = 'live';
        state.events.push({ id: ++eid, minute: 45, type: 'second_half', team: 'neutral',
          commentary: `Second half underway — ${fixture.home.name} ${state.homeScore}–${state.awayScore} ${fixture.away.name}`,
          lx: 0, ly: 0 });
        onUpdate({ ...state, events: [...state.events] });
      }, halfTimeBreakMs);
      return;
    }

    if (state.events.length > 80) state.events.splice(0, state.events.length - 80);
    onUpdate({ ...state, events: [...state.events] });

    if (minute >= 90) {
      state.status = 'finished';
      state.finishedAt = Date.now();
      state.events.push({ id: ++eid, minute: 90, type: 'full_time', team: 'neutral',
        commentary: `FULL TIME — ${fixture.home.name} ${state.homeScore}–${state.awayScore} ${fixture.away.name}`,
        lx: 0, ly: 0 });
      onUpdate({ ...state, events: [...state.events] });
      clearInterval(timer);
    }
  }, tickMs);

  return () => {
    clearInterval(timer);
    if (halfTimeResume) clearTimeout(halfTimeResume);
    delayedEvents.forEach(id => clearTimeout(id));
    delayedEvents.clear();
  };
}
