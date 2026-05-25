import type { Fixture, MatchState, MatchEvent } from '../types';
import { SQUADS } from './squadData';

// ── Strength + squad data (mirrors backend, lives here for offline demo) ──────

export const STRENGTH: Record<string, number> = {
  // Core simulated-bracket teams
  ARG:95, FRA:93, BRA:92, ENG:88, ESP:87, GER:86, POR:85, NED:83,
  BEL:82, ITA:80, CRO:77, URU:77, MAR:75, SEN:74, JPN:73, DEN:73,
  COL:72, MEX:72, SUI:71, CAN:71, USA:70, SRB:70, TUR:69, CIV:69,
  NGA:68, AUS:67, KOR:67, ECU:66, ALG:65, EGY:64, CMR:64, KSA:61,
  // Official FIFA WC 2026 teams (realtime groups)
  SWE:76, NOR:74, AUT:68, CZE:66, SCO:65, GHA:60, PAR:60, TUN:60,
  IRN:61, RSA:57, COD:56, BIH:58, IRQ:52, QAT:52, CPV:48, PAN:48,
  JOR:48, UZB:50, NZL:45, HAI:42, CUW:35,
};

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
  ITA: ['Pellegrini','Barella','Tonali','Chiesa','Retegui','Bastoni','Di Lorenzo','Donnarumma'],
  CRO: ['Modrić','Kovačić','Gvardiol','Kramarić','Perisić','Sosa','Pašalić','Šutalo'],
  MAR: ['En-Nesyri','Hakimi','Ziyech','Ounahi','Amrabat','Boufal','Saiss','Bounou'],
  URU: ['Núñez','Valverde','Bentancur','Araújo','Pellistri','Ugarte','De Arrascaeta','Olivera'],
  COL: ['L. Díaz','J. Díaz','Cuadrado','Borré','Arias','Cuesta','Ospina','Quintero'],
  SEN: ['Mané','Dia','Sarr','Gueye','Koulibaly','Sabaly','Diatta','Mendy'],
  JPN: ['Kubo','Mitoma','Doan','Endo','Kamada','Tomiyasu','Taniguchi','Maeda'],
  DEN: ['Eriksen','Højlund','Damsgaard','Delaney','Maehle','Christiansen','Andersen','Schmeichel'],
  MEX: ['Jiménez','Lozano','Antuna','Álvarez','Herrera','Sánchez','Moreno','Ochoa'],
  USA: ['Pulisic','Reyna','McKennie','Musah','Aaronson','Turner','Dest','Richards'],
  CAN: ['Davies','David','Buchanan','Larin','Johnston','Eustáquio','Henry','Adekugbe'],
  TUR: ['Çalhanoğlu','Karaman','Yildiz','Yazici','Kahveci','Söyüncü','Çelik','Günok'],
  SRB: ['Tadic','Mitrovic','Milinkovic-Savic','Vlahovic','Ilic','Pavlovic','Grujic','Rajkovic'],
  SUI: ['Xhaka','Shaqiri','Embolo','Vargas','Freuler','Akanji','Elvedi','Sommer'],
  CMR: ['Choupo-Moting','Aboubakar','Toko Ekambi','Kunde','Bassogog','Castelletto','Fai','Epassy'],
  AUS: ['Leckie','Mabil','Irvine','Mooy','McGree','Ryan','Souttar','Rowles'],
  EGY: ['Salah','Trezeguet','Elneny','Mostafa Mohamed','El-Shenawy','Hamdy','Galal','El-Solia'],
  KOR: ['Son Heung-min','Hwang Hee-chan','Lee Jae-sung','Kim Min-jae','Jung Woo-young','Na Sang-ho','Hwang In-beom','Jo Hyeon-woo'],
  NGA: ['Osimhen','Lookman','Iheanacho','Ndidi','Iwobi','Troost-Ekong','Collins','Uzoho'],
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
  const hStr = STRENGTH[fixture.home.code] ?? 70;
  const aStr = STRENGTH[fixture.away.code] ?? 70;
  const total = hStr + aStr;
  const diff  = Math.abs(hStr - aStr);
  const boost = diff > 10 ? 0.12 : 0;

  const chaos = 0.92 + Math.random() * 0.22;
  const hGoalPerMin = 0.024 * (hStr / total) * (hStr < aStr ? 1 + boost : 1) * chaos;
  const aGoalPerMin = 0.024 * (aStr / total) * (aStr < hStr ? 1 + boost : 1) * (2 - chaos);

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
      const t = Math.random() < hStr / total ? 'home' : 'away';
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
      const t = Math.random() < hStr / total ? 'home' : 'away';
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
      const t = Math.random() < hStr / total ? 'home' : 'away';
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
      const t = Math.random() < hStr / total ? 'home' : 'away';
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
