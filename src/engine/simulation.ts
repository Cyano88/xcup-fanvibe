import type { Fixture, MatchState, MatchEvent, Outcome, LogPrefix, LogLevel } from '../types.js';

export const SQUAD_STRENGTH: Record<string, number> = {
  ARG: 95, FRA: 93, BRA: 92, ENG: 88, ESP: 87, GER: 86, POR: 85, NED: 83,
  BEL: 82, CRO: 77, URU: 77, MAR: 75, SEN: 74, JPN: 73, SWE: 76, NOR: 74,
  COL: 72, MEX: 72, SUI: 71, CAN: 71, USA: 70, TUR: 69, CIV: 69, AUS: 67,
  KOR: 67, ECU: 66, ALG: 65, EGY: 64, KSA: 61, AUT: 68, CZE: 66, SCO: 65,
  GHA: 60, PAR: 60, TUN: 60, IRN: 61, RSA: 57, COD: 56, BIH: 58, IRQ: 52,
  QAT: 52, CPV: 48, PAN: 48, JOR: 48, UZB: 50, NZL: 45, HAI: 42, CUW: 35,
};

const TEAM_PLAYERS: Record<string, string[]> = {
  ARG: ['Messi', 'Lautaro Martinez', 'Mac Allister', 'De Paul', 'Fernandez', 'Otamendi', 'Molina', 'Dibu Martinez'],
  FRA: ['Mbappe', 'Griezmann', 'Thuram', 'Dembele', 'Camavinga', 'Tchouameni', 'Saliba', 'Maignan'],
  BRA: ['Vinicius Jr', 'Rodrygo', 'Paqueta', 'Endrick', 'Savinho', 'Bruno Guimaraes', 'Marquinhos', 'Alisson'],
  ENG: ['Bellingham', 'Kane', 'Saka', 'Foden', 'Rice', 'Walker', 'Stones', 'Pickford'],
  ESP: ['Yamal', 'Nico Williams', 'Pedri', 'Rodri', 'Morata', 'Carvajal', 'Le Normand', 'Unai Simon'],
  GER: ['Musiala', 'Wirtz', 'Havertz', 'Kimmich', 'Gundogan', 'Rudiger', 'Schlotterbeck', 'Neuer'],
  POR: ['Ronaldo', 'Felix', 'Leao', 'Bernardo Silva', 'Vitinha', 'Ruben Dias', 'Cancelo', 'Diogo Costa'],
  NED: ['Gakpo', 'Depay', 'De Jong', 'Reijnders', 'Van Dijk', 'Dumfries', 'De Ligt', 'Verbruggen'],
  BEL: ['De Bruyne', 'Lukaku', 'Trossard', 'Doku', 'Onana', 'Faes', 'Theate', 'Casteels'],
  CRO: ['Modric', 'Kovacic', 'Gvardiol', 'Kramaric', 'Perisic', 'Sosa', 'Pasalic', 'Livakovic'],
  URU: ['Nunez', 'Valverde', 'Bentancur', 'Araujo', 'Pellistri', 'Ugarte', 'De Arrascaeta', 'Rochet'],
  MAR: ['En-Nesyri', 'Hakimi', 'Ziyech', 'Ounahi', 'Amrabat', 'Saiss', 'Bounou', 'Adli'],
  SEN: ['Mane', 'Dia', 'Sarr', 'Gueye', 'Koulibaly', 'Sabaly', 'Diatta', 'Mendy'],
  JPN: ['Kubo', 'Mitoma', 'Doan', 'Endo', 'Kamada', 'Tomiyasu', 'Taniguchi', 'Suzuki'],
  SWE: ['Isak', 'Gyokeres', 'Kulusevski', 'Forsberg', 'Elanga', 'Lindelof', 'Hien', 'Olsen'],
  NOR: ['Haaland', 'Odegaard', 'Sorloth', 'Nusa', 'Berge', 'Ajer', 'Ryerson', 'Nyland'],
  COL: ['Luis Diaz', 'James Rodriguez', 'Borre', 'Arias', 'Cuesta', 'Lerma', 'Quintero', 'Ospina'],
  MEX: ['Jimenez', 'Lozano', 'Antuna', 'Alvarez', 'Herrera', 'Sanchez', 'Moreno', 'Ochoa'],
  SUI: ['Xhaka', 'Shaqiri', 'Embolo', 'Vargas', 'Freuler', 'Akanji', 'Elvedi', 'Sommer'],
  CAN: ['Davies', 'David', 'Buchanan', 'Larin', 'Johnston', 'Eustaquio', 'Cornelius', 'Crepeau'],
  USA: ['Pulisic', 'Reyna', 'McKennie', 'Musah', 'Aaronson', 'Dest', 'Richards', 'Turner'],
  TUR: ['Calhanoglu', 'Yildiz', 'Yazici', 'Kahveci', 'Soyuncu', 'Celik', 'Akturkoglu', 'Gunok'],
  CIV: ['Haller', 'Kessie', 'Sangare', 'Konate', 'Gradel', 'Bailly', 'Fofana', 'Yahia Fofana'],
  AUS: ['Leckie', 'Mabil', 'Irvine', 'McGree', 'Goodwin', 'Souttar', 'Rowles', 'Ryan'],
  KOR: ['Son Heung-min', 'Hwang Hee-chan', 'Lee Kang-in', 'Lee Jae-sung', 'Kim Min-jae', 'Hwang In-beom', 'Seol Young-woo', 'Jo Hyeon-woo'],
  ECU: ['Valencia', 'Caicedo', 'Plata', 'Preciado', 'Estupinan', 'Pacho', 'Cifuentes', 'Dominguez'],
  ALG: ['Mahrez', 'Bennacer', 'Bensebaini', 'Atal', 'Slimani', 'Feghouli', 'Boudaoui', 'Mandrea'],
  EGY: ['Salah', 'Trezeguet', 'Elneny', 'Mostafa Mohamed', 'Hamdy', 'Galal', 'Hegazy', 'El-Shenawy'],
  KSA: ['Al-Dawsari', 'Al-Buraikan', 'Al-Hamdan', 'Al-Faraj', 'Al-Malki', 'Al-Shahrani', 'Al-Ghannam', 'Al-Owais'],
  AUT: ['Arnautovic', 'Sabitzer', 'Laimer', 'Baumgartner', 'Alaba', 'Lienhart', 'Posch', 'Pentz'],
  CZE: ['Schick', 'Soucek', 'Coufal', 'Hlozek', 'Provod', 'Krejci', 'Kral', 'Stanek'],
  SCO: ['McTominay', 'Robertson', 'McGinn', 'Gilmour', 'Tierney', 'Adams', 'Christie', 'Gordon'],
  GHA: ['Kudus', 'Partey', 'Ayew', 'Williams', 'Salisu', 'Lamptey', 'Semenyo', 'Ati-Zigi'],
  PAR: ['Almiron', 'Enciso', 'Gomez', 'Sosa', 'Balbuena', 'Alderete', 'Villasanti', 'Coronel'],
  TUN: ['Msakni', 'Skhiri', 'Laidouni', 'Jebali', 'Talbi', 'Bronn', 'Sliti', 'Dahmen'],
  IRN: ['Taremi', 'Azmoun', 'Jahanbakhsh', 'Gholizadeh', 'Ezatolahi', 'Mohammadi', 'Kanaani', 'Beiranvand'],
  RSA: ['Tau', 'Foster', 'Zwane', 'Mokoena', 'Modiba', 'Mvala', 'Mudau', 'Williams'],
  COD: ['Wissa', 'Bakambu', 'Bongonda', 'Kakuta', 'Mbemba', 'Masuaku', 'Kayembe', 'Mpasi'],
  BIH: ['Dzeko', 'Demirovic', 'Ahmedhodzic', 'Kolasinac', 'Tahirovic', 'Gigovic', 'Hadzikadunic', 'Sehic'],
  IRQ: ['Al-Hamadi', 'Hussein', 'Iqbal', 'Bayesh', 'Adnan', 'Natiq', 'Jalal', 'Hassan'],
  QAT: ['Afif', 'Almoez Ali', 'Hatem', 'Al-Haydos', 'Khoukhi', 'Miguel', 'Salman', 'Barsham'],
  CPV: ['Bebe', 'Tavares', 'Monteiro', 'Semedo', 'Borges', 'Lopes', 'Duarte', 'Vozinha'],
  PAN: ['Fajardo', 'Waterman', 'Godoy', 'Carrasquilla', 'Murillo', 'Escobar', 'Mosquera', 'Mejia'],
  JOR: ['Olwan', 'Al-Taamari', 'Al-Naimat', 'Mardi', 'Rashdan', 'Nasib', 'Al-Arab', 'Abu Laila'],
  UZB: ['Shomurodov', 'Urunov', 'Masharipov', 'Khamrobekov', 'Ashurmatov', 'Alijonov', 'Nasrullaev', 'Yusupov'],
  NZL: ['Wood', 'Singh', 'Garbett', 'Stamenic', 'Cacace', 'Boxall', 'Payne', 'Sail'],
  HAI: ['Nazon', 'Pierrot', 'Louicius', 'Antoine', 'Etienne', 'Arcus', 'Ade', 'Placide'],
  CUW: ['Bacuna', 'Janga', 'Gorre', 'Anita', 'Martina', 'Van Eijma', 'Kastaneer', 'Room'],
};

const GOALKEEPERS = new Set([
  'Dibu Martinez', 'Maignan', 'Alisson', 'Pickford', 'Unai Simon', 'Neuer', 'Diogo Costa',
  'Verbruggen', 'Casteels', 'Livakovic', 'Rochet', 'Bounou', 'Mendy', 'Suzuki', 'Olsen',
  'Nyland', 'Ospina', 'Ochoa', 'Sommer', 'Crepeau', 'Turner', 'Gunok', 'Yahia Fofana',
  'Ryan', 'Jo Hyeon-woo', 'Dominguez', 'Mandrea', 'El-Shenawy', 'Al-Owais', 'Pentz',
  'Stanek', 'Gordon', 'Ati-Zigi', 'Coronel', 'Dahmen', 'Beiranvand', 'Williams', 'Mpasi',
  'Sehic', 'Jalal', 'Barsham', 'Vozinha', 'Mejia', 'Abu Laila', 'Yusupov', 'Sail',
  'Placide', 'Room',
]);

const DEFENDERS = new Set([
  'Otamendi', 'Molina', 'Saliba', 'Marquinhos', 'Walker', 'Stones', 'Carvajal', 'Le Normand',
  'Rudiger', 'Schlotterbeck', 'Ruben Dias', 'Cancelo', 'Van Dijk', 'Dumfries', 'De Ligt',
  'Faes', 'Theate', 'Gvardiol', 'Sosa', 'Araujo', 'Hakimi', 'Saiss', 'Koulibaly', 'Sabaly',
  'Tomiyasu', 'Taniguchi', 'Sanchez', 'Moreno', 'Akanji', 'Elvedi', 'Johnston', 'Cornelius',
  'Dest', 'Richards', 'Soyuncu', 'Celik', 'Bailly', 'Fofana', 'Souttar', 'Rowles', 'Kim Min-jae',
  'Seol Young-woo', 'Preciado', 'Estupinan', 'Pacho', 'Bensebaini', 'Atal', 'Hamdy', 'Galal',
  'Hegazy', 'Al-Shahrani', 'Al-Ghannam', 'Alaba', 'Lienhart', 'Posch', 'Coufal', 'Krejci',
  'Robertson', 'Tierney', 'Salisu', 'Lamptey', 'Balbuena', 'Alderete', 'Talbi', 'Bronn',
  'Mohammadi', 'Kanaani', 'Modiba', 'Mvala', 'Mudau', 'Mbemba', 'Masuaku', 'Ahmedhodzic',
  'Kolasinac', 'Hadzikadunic', 'Adnan', 'Natiq', 'Khoukhi', 'Miguel', 'Salman', 'Duarte',
  'Murillo', 'Escobar', 'Mosquera', 'Nasib', 'Al-Arab', 'Ashurmatov', 'Alijonov', 'Nasrullaev',
  'Cacace', 'Boxall', 'Payne', 'Arcus', 'Ade', 'Martina', 'Van Eijma',
]);

const TEMPLATES: Record<string, string[]> = {
  kickoff: ['Kick off. {home} and {away} are underway at {venue}.'],
  second_half: ['Second half underway. {home} {hs}-{as} {away}.'],
  half_time: ['Half time. {home} {hs}-{as} {away}.'],
  full_time: ['Full time. {home} {hs}-{as} {away}.'],
  attack_home: ['{home} build from midfield through {player}.'],
  attack_away: ['{away} move the ball quickly through {player}.'],
  pressure_home: ['{player} carries {home} into the final third.'],
  pressure_away: ['{player} drives {away} into a dangerous area.'],
  safe_home: ['{player} settles possession for {home}.'],
  safe_away: ['{player} slows it down for {away}.'],
  shot_on_home: ['{player} hits the target for {home}. The keeper has work to do.'],
  shot_on_away: ['{player} tests the goalkeeper for {away}.'],
  shot_off_home: ['{player} shoots for {home}, but it drifts wide. Goal kick.'],
  shot_off_away: ['{player} lets fly for {away}, but the ball goes behind. Goal kick.'],
  goal_home: ['Goal for {home}. {player} finishes it. {hs}-{as}.'],
  goal_away: ['Goal for {away}. {player} finds the net. {hs}-{as}.'],
  corner_home: ['Corner for {home}. {player} forces the defender behind.'],
  corner_away: ['Corner for {away}. {player} keeps the pressure on.'],
  throw_home: ['Throw in for {home}. {player} restarts play.'],
  throw_away: ['Throw in for {away}. {player} restarts play.'],
  free_kick_home: ['Free kick for {home}. {player} stands over it.'],
  free_kick_away: ['Free kick for {away}. {player} stands over it.'],
  goal_kick_home: ['Goal kick for {home}. {player} gets the ball back in play.'],
  goal_kick_away: ['Goal kick for {away}. {player} gets the ball back in play.'],
  foul_home: ['Foul by {player}. {away} get the free kick.'],
  foul_away: ['Foul by {player}. {home} get the free kick.'],
  yellow_home: ['Yellow card for {player} of {home}.'],
  yellow_away: ['Yellow card for {player} of {away}.'],
  red_home: ['Red card for {player} of {home}.'],
  red_away: ['Red card for {player} of {away}.'],
  offside_home: ['{player} goes too early. Offside against {home}.'],
  offside_away: ['{player} goes too early. Offside against {away}.'],
  sub_home: ['Change for {home}. {player} comes on for {player2}.'],
  sub_away: ['Change for {away}. {player} comes on for {player2}.'],
  var_goal: ['VAR check complete. The goal stands.'],
};

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
type PlayerRole = 'any' | 'attacker' | 'defender' | 'goalkeeper' | 'outfield';
type LogFn = (prefix: LogPrefix, level: LogLevel, msg: string) => void;
type EventFn = (fixtureId: string, state: MatchState) => void;
type SettleFn = (fixtureId: string, outcome: Outcome) => Promise<void>;
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
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function calibrateTeamStrength(fixture: Fixture): CalibratedStrength {
  const homeRating = SQUAD_STRENGTH[fixture.home.code] ?? 62;
  const awayRating = SQUAD_STRENGTH[fixture.away.code] ?? 62;
  const ratingGap = homeRating - awayRating;
  const expectedHome = 1 / (1 + 10 ** (-ratingGap / 42));
  const drawProbability = clamp(0.30 - Math.abs(ratingGap) * 0.003, 0.18, 0.30);
  const decisiveProbability = 1 - drawProbability;
  const homeWinProbability = decisiveProbability * expectedHome;
  const awayWinProbability = decisiveProbability - homeWinProbability;
  const homeAttackShare = clamp(homeWinProbability + drawProbability * 0.5, 0.34, 0.66);
  const awayAttackShare = 1 - homeAttackShare;
  const averageRating = (homeRating + awayRating) / 2;
  const totalGoalsPerMatch = clamp(2.18 + (averageRating - 62) * 0.012 + Math.abs(ratingGap) * 0.005, 1.75, 3.15);

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
  };
}

function playersFor(teamCode: string, role: PlayerRole): string[] {
  const players = TEAM_PLAYERS[teamCode] ?? [];
  if (!players.length) return [];
  if (role === 'goalkeeper') return players.filter(p => GOALKEEPERS.has(p));
  if (role === 'defender') return players.filter(p => DEFENDERS.has(p) && !GOALKEEPERS.has(p));
  if (role === 'attacker') return players.filter(p => !DEFENDERS.has(p) && !GOALKEEPERS.has(p));
  if (role === 'outfield') return players.filter(p => !GOALKEEPERS.has(p));
  return players;
}

function pickPlayer(teamCode: string, role: PlayerRole = 'any'): string {
  const pool = playersFor(teamCode, role);
  const fallback = playersFor(teamCode, role === 'goalkeeper' ? 'any' : 'outfield');
  const safePool = pool.length ? pool : fallback.length ? fallback : TEAM_PLAYERS[teamCode] ?? [];
  if (safePool.length) return pick(safePool);
  if (role === 'goalkeeper') return 'the goalkeeper';
  if (role === 'defender') return 'the centre-back';
  if (role === 'attacker') return 'the forward';
  return 'the captain';
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function makeCommentary(type: string, fixture: Fixture, state: MatchState, teamCode?: string, player?: string, player2?: string): string {
  const p = player ?? (teamCode ? pickPlayer(teamCode) : 'the captain');
  return fillTemplate(pick(TEMPLATES[type] ?? ['{player} keeps the move alive.']), {
    home: fixture.home.name,
    away: fixture.away.name,
    player: p,
    player2: player2 ?? 'a teammate',
    hs: String(state.homeScore),
    as: String(state.awayScore),
    venue: fixture.venue.split('·')[0].trim(),
  });
}

function getEventCoords(type: string, team: 'home' | 'away' | 'neutral'): { lx: number; ly: number } {
  const r1 = Math.random(), r2 = Math.random();
  const sign = team === 'home' ? 1 : team === 'away' ? -1 : 0;
  if (type.startsWith('goal_')) return { lx: sign * 99, ly: (r2 - 0.5) * 12 };
  if (type.startsWith('shot_on')) return { lx: sign * (88 + r1 * 8), ly: (r2 - 0.5) * 22 };
  if (type.startsWith('shot_off')) return { lx: sign * (92 + r1 * 8), ly: (r2 > 0.5 ? 1 : -1) * (26 + r1 * 18) };
  if (type.startsWith('corner')) return { lx: sign * 97, ly: (r2 > 0.5 ? 1 : -1) * (42 + r1 * 6) };
  if (type.startsWith('goal_kick')) return { lx: -sign * (86 + r1 * 8), ly: (r2 - 0.5) * 16 };
  if (type.startsWith('throw')) return { lx: sign * (18 + r1 * 56), ly: (r2 > 0.5 ? 1 : -1) * 48 };
  if (type.startsWith('free_kick')) return { lx: sign * (34 + r1 * 34), ly: (r2 - 0.5) * 42 };
  if (type.startsWith('pressure')) return { lx: sign * (50 + r1 * 28), ly: (r2 - 0.5) * 54 };
  if (type.startsWith('attack')) return { lx: sign * (18 + r1 * 40), ly: (r2 - 0.5) * 66 };
  if (type.startsWith('safe')) return { lx: -sign * (34 + r1 * 30), ly: (r2 - 0.5) * 54 };
  if (type === 'kickoff' || type === 'half_time' || type === 'full_time' || type === 'second_half') return { lx: 0, ly: 0 };
  if (type.startsWith('foul') || type.startsWith('yellow') || type.startsWith('red')) {
    return { lx: sign * (20 + r1 * 55), ly: (r2 - 0.5) * 78 };
  }
  return { lx: sign * (20 + r1 * 40), ly: (r2 - 0.5) * 70 };
}

function shouldPause(type: string): boolean {
  return type.startsWith('goal') ||
    type.startsWith('corner') ||
    type.startsWith('throw') ||
    type.startsWith('free_kick') ||
    type.startsWith('goal_kick') ||
    type.startsWith('foul') ||
    type.startsWith('yellow') ||
    type.startsWith('red') ||
    type.startsWith('offside') ||
    type.startsWith('sub');
}

export class MatchSimulator {
  private states = new Map<string, MatchState>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pauseUntil = new Map<string, number>();
  private eventId = 0;
  private readonly minuteMs = Number(process.env.SIM_MINUTE_MS ?? '6667');
  private readonly halfTimeBreakMs = Number(process.env.SIM_HALFTIME_BREAK_MS ?? '15000');

  constructor(
    private readonly onEvent: EventFn,
    private readonly onSettle: SettleFn,
    private readonly log: LogFn,
  ) {}

  schedule(fixtures: Fixture[], firstKickoffMs: number, intervalMs: number): void {
    fixtures.forEach((fixture, idx) => {
      if (this.states.get(fixture.id)?.status === 'live') return;
      const kickoffMs = firstKickoffMs + idx * intervalMs;
      const stakingOpenMs = kickoffMs - 30 * 60_000;
      const now = Date.now();

      fixture.simulatedKickoff = new Date(kickoffMs).toISOString();

      if (kickoffMs <= now) {
        const elapsed = Math.floor((now - kickoffMs) / this.minuteMs);
        if (elapsed < 90) {
          fixture.status = 'locked';
          this.runMatch(fixture, Math.max(0, elapsed));
        }
      } else {
        fixture.status = stakingOpenMs <= now ? 'open' : 'upcoming';
        if (stakingOpenMs > now) {
          setTimeout(() => {
            fixture.status = 'open';
            this.onEvent(fixture.id, this.states.get(fixture.id) ?? this.blankState(fixture, kickoffMs));
          }, stakingOpenMs - now);
        }
        setTimeout(() => {
          if (fixture.status === 'settled') return;
          fixture.status = 'locked';
          this.log('SYSTEM', 'info', `Match locked - ${fixture.home.code} vs ${fixture.away.code} kicks off now`);
          this.runMatch(fixture, 0);
        }, kickoffMs - now);
      }
    });
  }

  getStates(): Record<string, MatchState> {
    return Object.fromEntries(this.states);
  }

  private blankState(fixture: Fixture, kickoffMs: number): MatchState {
    return {
      fixtureId: fixture.id,
      status: 'scheduled',
      minute: 0,
      homeScore: 0,
      awayScore: 0,
      events: [],
      simulatedKickoff: new Date(kickoffMs).toISOString(),
      possession: 50,
    };
  }

  private addEvent(
    state: MatchState,
    type: string,
    fixture: Fixture,
    team: 'home' | 'away' | 'neutral' = 'neutral',
    role: PlayerRole = 'any',
    player?: string,
    player2?: string,
  ): MatchEvent {
    const teamCode = team === 'home' ? fixture.home.code : team === 'away' ? fixture.away.code : undefined;
    const resolvedPlayer = player ?? (teamCode ? pickPlayer(teamCode, role) : undefined);
    const coords = getEventCoords(type, team);
    const event: MatchEvent = {
      id: ++this.eventId,
      minute: state.minute,
      type,
      team,
      commentary: makeCommentary(type, fixture, state, teamCode, resolvedPlayer, player2),
      player: resolvedPlayer,
      player2,
      lx: coords.lx,
      ly: coords.ly,
    };
    state.events.push(event);
    if (state.events.length > 180) state.events.shift();
    this.log('SYSTEM', type.startsWith('goal') ? 'success' : 'info', `[${fixture.home.code} vs ${fixture.away.code}] ${event.commentary}`);
    if (shouldPause(type)) this.pauseUntil.set(fixture.id, Date.now() + 7000);
    return event;
  }

  private runMatch(fixture: Fixture, startMinute: number): void {
    const state: MatchState = {
      fixtureId: fixture.id,
      status: 'live',
      minute: startMinute,
      homeScore: 0,
      awayScore: 0,
      events: [],
      simulatedKickoff: fixture.simulatedKickoff ?? new Date().toISOString(),
      possession: 50,
    };
    this.states.set(fixture.id, state);
    if (startMinute === 0) this.addEvent(state, 'kickoff', fixture, 'neutral');
    this.onEvent(fixture.id, state);

    const calibration = calibrateTeamStrength(fixture);

    const interval = setInterval(async () => {
      if ((this.pauseUntil.get(fixture.id) ?? 0) > Date.now()) return;
      if (state.status === 'half_time') return;
      state.minute++;

      if (state.minute === 45) {
        state.status = 'half_time';
        this.addEvent(state, 'half_time', fixture, 'neutral');
        this.onEvent(fixture.id, state);
        setTimeout(() => {
          state.status = 'live';
          this.addEvent(state, 'second_half', fixture, 'neutral');
          this.onEvent(fixture.id, state);
        }, this.halfTimeBreakMs);
        return;
      }

      if (state.minute >= 90) {
        clearInterval(interval);
        this.timers.delete(fixture.id);
        this.addEvent(state, 'full_time', fixture, 'neutral');
        state.status = 'finished';
        state.finishedAt = Date.now();
        this.onEvent(fixture.id, state);
        const outcome = this.determineOutcome(state);
        this.log('SYSTEM', 'success', `Final: ${fixture.home.code} ${state.homeScore}-${state.awayScore} ${fixture.away.code} - ${outcome.toUpperCase()}`);
        await this.onSettle(fixture.id, outcome);
        return;
      }

      this.simulateMinute(state, fixture, calibration);
      this.onEvent(fixture.id, state);
    }, this.minuteMs);

    this.timers.set(fixture.id, interval);
  }

  private simulateMinute(state: MatchState, fixture: Fixture, calibration: CalibratedStrength): void {
    const rng = Math.random;
    const chasingHome = state.homeScore < state.awayScore ? 1.08 : state.homeScore > state.awayScore ? 0.94 : 1;
    const chasingAway = state.awayScore < state.homeScore ? 1.08 : state.awayScore > state.homeScore ? 0.94 : 1;
    const homeGoalProb = calibration.homeGoalPerMinute * chasingHome;
    const awayGoalProb = calibration.awayGoalPerMinute * chasingAway;
    const homePossProb = calibration.homeAttackShare;
    const team = rng() < homePossProb ? 'home' : 'away';

    if (rng() < homeGoalProb) {
      state.homeScore++;
      state.possession = Math.min(72, state.possession + 5);
      this.addEvent(state, 'goal_home', fixture, 'home', 'attacker', undefined, rng() < 0.58 ? pickPlayer(fixture.home.code, 'outfield') : undefined);
      if (rng() < 0.08) this.addEvent(state, 'var_goal', fixture, 'neutral');
    } else if (rng() < awayGoalProb) {
      state.awayScore++;
      state.possession = Math.max(28, state.possession - 5);
      this.addEvent(state, 'goal_away', fixture, 'away', 'attacker', undefined, rng() < 0.58 ? pickPlayer(fixture.away.code, 'outfield') : undefined);
      if (rng() < 0.08) this.addEvent(state, 'var_goal', fixture, 'neutral');
    } else if (rng() < 0.12) {
      this.addEvent(state, rng() < 0.44 ? `shot_on_${team}` : `shot_off_${team}`, fixture, team, 'attacker');
      state.possession += team === 'home' ? 2 : -2;
    } else if (rng() < 0.08) {
      this.addEvent(state, `corner_${team}`, fixture, team, 'outfield');
      if (rng() < 0.38) this.addEvent(state, rng() < 0.5 ? `shot_on_${team}` : `shot_off_${team}`, fixture, team, 'attacker');
    } else if (rng() < 0.10) {
      this.addEvent(state, `attack_${team}`, fixture, team, 'outfield');
    } else if (rng() < 0.09) {
      this.addEvent(state, `pressure_${team}`, fixture, team, 'outfield');
    } else if (rng() < 0.12) {
      this.addEvent(state, `safe_${team}`, fixture, team, 'defender');
    } else if (rng() < 0.07) {
      this.addEvent(state, `throw_${team}`, fixture, team, 'outfield');
    } else if (rng() < 0.05) {
      this.addEvent(state, `free_kick_${team}`, fixture, team, 'outfield');
    } else if (rng() < 0.04) {
      this.addEvent(state, `goal_kick_${team}`, fixture, team, rng() < 0.75 ? 'goalkeeper' : 'defender');
    } else if (rng() < 0.06) {
      const offender = rng() < 0.5 ? 'home' : 'away';
      this.addEvent(state, `foul_${offender}`, fixture, offender, 'outfield');
    } else if (rng() < 0.025) {
      const booked = rng() < 0.5 ? 'home' : 'away';
      this.addEvent(state, `yellow_${booked}`, fixture, booked, 'outfield');
    } else if (rng() < 0.003) {
      const sentOff = rng() < 0.5 ? 'home' : 'away';
      this.addEvent(state, `red_${sentOff}`, fixture, sentOff, 'outfield');
    } else if (rng() < 0.02) {
      this.addEvent(state, `offside_${team}`, fixture, team, 'attacker');
    }

    const targetPoss = Math.round(homePossProb * 100);
    state.possession = Math.round(state.possession * 0.92 + targetPoss * 0.08);
    state.possession = Math.max(28, Math.min(72, state.possession));
  }

  private determineOutcome(state: MatchState): Outcome {
    if (state.homeScore > state.awayScore) return 'home';
    if (state.awayScore > state.homeScore) return 'away';
    return 'draw';
  }
}
