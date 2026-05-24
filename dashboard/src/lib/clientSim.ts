import type { Fixture, MatchState, MatchEvent } from '../types';

// ── Strength + squad data (mirrors backend, lives here for offline demo) ──────

export const STRENGTH: Record<string, number> = {
  ARG:95, FRA:93, BRA:92, ENG:88, ESP:87, GER:86, POR:85, NED:83,
  BEL:82, ITA:80, CRO:77, URU:77, MAR:75, SEN:74, JPN:73, DEN:73,
  COL:72, MEX:72, SUI:71, CAN:71, USA:70, SRB:70, TUR:69, CIV:69,
  NGA:68, AUS:67, KOR:67, ECU:66, ALG:65, EGY:64, CMR:64, KSA:61,
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
  const p = PLAYERS[code];
  return p?.length ? pick(p) : 'the striker';
};

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
    lx: sign * (84 + Math.random() * 12),
    ly: (Math.random() - 0.5) * 28,
  };
}

/**
 * Simulate a single match at `tickMs` per game-minute (200ms default → ~18s per match).
 * Returns a cleanup function.
 */
export function simulateMatch(
  fixture: Fixture,
  onUpdate: (state: MatchState) => void,
  tickMs = 200,
): () => void {
  const hStr = STRENGTH[fixture.home.code] ?? 70;
  const aStr = STRENGTH[fixture.away.code] ?? 70;
  const total = hStr + aStr;
  const diff  = Math.abs(hStr - aStr);
  const boost = diff > 10 ? 0.12 : 0;

  const hGoalPerMin = 0.022 * (hStr / total) * (hStr < aStr ? 1 + boost : 1);
  const aGoalPerMin = 0.022 * (aStr / total) * (aStr < hStr ? 1 + boost : 1);

  const state: MatchState = {
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
  onUpdate({ ...state, events: [...state.events] });

  let minute = 0;
  const timer = setInterval(() => {
    minute++;
    state.minute = minute;
    state.possession = Math.round(
      Math.max(28, Math.min(72, state.possession + (Math.random() - 0.5) * 10 + (hStr - aStr) * 0.08))
    );

    if (Math.random() < hGoalPerMin) {
      state.homeScore++;
      state.events.push(goalEvent(minute, 'home', fixture, state.homeScore, state.awayScore));
    }
    if (Math.random() < aGoalPerMin) {
      state.awayScore++;
      state.events.push(goalEvent(minute, 'away', fixture, state.homeScore, state.awayScore));
    }
    if (Math.random() < 0.05) {
      const t = Math.random() < hStr / total ? 'home' : 'away';
      const code = t === 'home' ? fixture.home.code : fixture.away.code;
      state.events.push({ id: ++eid, minute, type: `shot_${t}`, team: t as 'home' | 'away',
        player: pickPlayer(code),
        commentary: `Shot! Dangerous chance for ${t === 'home' ? fixture.home.name : fixture.away.name}!`,
        lx: (t === 'home' ? 1 : -1) * (68 + Math.random() * 22), ly: (Math.random() - 0.5) * 46 });
    }
    if (Math.random() < 0.008) {
      const t = Math.random() < 0.5 ? 'home' : 'away';
      const code = t === 'home' ? fixture.home.code : fixture.away.code;
      state.events.push({ id: ++eid, minute, type: `yellow_${t}`, team: t as 'home' | 'away',
        player: pickPlayer(code),
        commentary: `Yellow card!`,
        lx: (t === 'home' ? 1 : -1) * (30 + Math.random() * 50), ly: (Math.random() - 0.5) * 80 });
    }
    if (minute === 45) {
      state.events.push({ id: ++eid, minute: 45, type: 'half_time', team: 'neutral',
        commentary: `HALF TIME — ${fixture.home.name} ${state.homeScore}–${state.awayScore} ${fixture.away.name}`,
        lx: 0, ly: 0 });
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

  return () => clearInterval(timer);
}
