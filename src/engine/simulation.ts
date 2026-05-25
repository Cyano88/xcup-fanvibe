import type { Fixture, MatchState, MatchEvent, Outcome, LogPrefix, LogLevel } from '../types.js';

// ── Squad registry ────────────────────────────────────────────────────────────

export const SQUAD_STRENGTH: Record<string, number> = {
  ARG:95, FRA:93, BRA:92, ENG:88, ESP:87, GER:86, POR:85, NED:83,
  BEL:82, ITA:80, CRO:77, URU:77, MAR:75, SEN:74, JPN:73, DEN:73,
  COL:72, MEX:72, SUI:71, CAN:71, USA:70, SRB:70, TUR:69, CIV:69,
  NGA:68, AUS:67, KOR:67, ECU:66, ALG:65, EGY:64, CMR:64, KSA:61,
};

const SQUAD_PLAYERS: Record<string, string[]> = {
  ARG: ['Messi', 'Lautaro Martínez', 'Di María', 'Mac Allister', 'De Paul', 'Fernández', 'Otamendi', 'Molina'],
  FRA: ['Mbappé', 'Griezmann', 'Thuram', 'Dembélé', 'Camavinga', 'Tchouaméni', 'Saliba', 'Upamecano'],
  BRA: ['Vinicius Jr', 'Rodrygo', 'Paquetá', 'Endrick', 'Savinho', 'Bruno Guimarães', 'Marquinhos', 'Militão'],
  ENG: ['Bellingham', 'Kane', 'Saka', 'Foden', 'Alexander-Arnold', 'Rice', 'Walker', 'Stones'],
  ESP: ['Yamal', 'Nico Williams', 'Pedri', 'Rodri', 'Morata', 'Gavi', 'Carvajal', 'Le Normand'],
  GER: ['Musiala', 'Wirtz', 'Havertz', 'Kimmich', 'Gündogan', 'Gnabry', 'Rüdiger', 'Schlotterbeck'],
  POR: ['Ronaldo', 'Félix', 'Leão', 'Bernardo Silva', 'Vitinha', 'Neves', 'Rúben Dias', 'Cancelo'],
  NED: ['Gakpo', 'van Dijk', 'de Jong', 'Reijnders', 'Depay', 'Dumfries', 'de Ligt', 'Veerman'],
  BEL: ['De Bruyne', 'Lukaku', 'Trossard', 'Doku', 'Onana', 'Mangala', 'Vertonghen', 'Faes'],
  ITA: ['Pellegrini', 'Barella', 'Tonali', 'Chiesa', 'Retegui', 'Bastoni', 'Di Lorenzo', 'Donnarumma'],
  CRO: ['Modrić', 'Kovačić', 'Gvardiol', 'Kramarić', 'Perisić', 'Sosa', 'Pašalić', 'Šutalo'],
  MAR: ['En-Nesyri', 'Hakimi', 'Ziyech', 'Ounahi', 'Amrabat', 'Boufal', 'Saiss', 'Bounou'],
  URU: ['Núñez', 'Valverde', 'Bentancur', 'Araújo', 'Pellistri', 'Ugarte', 'De Arrascaeta', 'Olivera'],
  COL: ['L. Díaz', 'J. Díaz', 'Cuadrado', 'Borré', 'Arias', 'Cuesta', 'Ospina', 'Quintero'],
  SEN: ['Mané', 'Dia', 'Sarr', 'Gueye', 'Koulibaly', 'Sabaly', 'Diatta', 'Mendy'],
  JPN: ['Kubo', 'Mitoma', 'Doan', 'Endo', 'Kamada', 'Tomiyasu', 'Taniguchi', 'Maeda'],
  DEN: ['Eriksen', 'Højlund', 'Damsgaard', 'Delaney', 'Maehle', 'Christiansen', 'Andersen', 'Schmeichel'],
  MEX: ['Jiménez', 'Lozano', 'Antuna', 'Álvarez', 'Herrera', 'Sánchez', 'Moreno', 'Ochoa'],
  USA: ['Pulisic', 'Reyna', 'McKennie', 'Musah', 'Aaronson', 'Turner', 'Dest', 'Richards'],
  CAN: ['Davies', 'David', 'Buchanan', 'Larin', 'Johnston', 'Eustáquio', 'Henry', 'Adekugbe'],
  TUR: ['Çalhanoğlu', 'Karaman', 'Yildiz', 'Yazici', 'Kahveci', 'Söyüncü', 'Çelik', 'Günok'],
  SRB: ['Tadic', 'Mitrovic', 'Milinkovic-Savic', 'Vlahovic', 'Ilic', 'Pavlovic', 'Grujic', 'Rajkovic'],
  SUI: ['Xhaka', 'Shaqiri', 'Embolo', 'Vargas', 'Freuler', 'Akanji', 'Elvedi', 'Sommer'],
  CMR: ['Choupo-Moting', 'Aboubakar', 'Toko Ekambi', 'Kunde', 'Bassogog', 'Castelletto', 'Fai', 'Epassy'],
  AUS: ['Leckie', 'Mabil', 'Irvine', 'Mooy', 'McGree', 'Ryan', 'Souttar', 'Rowles'],
  EGY: ['Salah', 'Trezeguet', 'Elneny', 'Mostafa Mohamed', 'El-Shenawy', 'Hamdy', 'Galal', 'El-Solia'],
  KOR: ['Son Heung-min', 'Hwang Hee-chan', 'Lee Jae-sung', 'Kim Min-jae', 'Jung Woo-young', 'Na Sang-ho', 'Hwang In-beom', 'Jo Hyeon-woo'],
  NGA: ['Osimhen', 'Lookman', 'Iheanacho', 'Ndidi', 'Iwobi', 'Troost-Ekong', 'Collins', 'Uzoho'],
  CIV: ['Haller', 'Zaha', 'Kessié', 'Sangaré', 'Konaté', 'Gradel', 'Bailly', 'Fofana'],
  ECU: ['Valencia', 'Caicedo', 'Plata', 'Preciado', 'Estupiñán', 'Pacho', 'Cifuentes', 'Domínguez'],
  ALG: ['Mahrez', 'Bennacer', 'Bensebaini', 'Atal', 'Slimani', 'Feghouli', 'Boudaoui', 'Zerrouki'],
  KSA: ['Al-Dawsari', 'Al-Shahrani', 'Al-Malki', 'Al-Faraj', 'Al-Buraikan', 'Al-Hamdan', 'Al-Owais', 'Al-Ghannam'],
};

// ── Commentary templates ──────────────────────────────────────────────────────

const TEMPLATES: Record<string, string[]> = {
  kickoff:     ['{home} vs {away} — the referee blows and we are underway at {venue}!', 'Kick off! The battle begins — {home} vs {away}.'],
  goal_home:   ['{player} — GOAL! Clinical finish from {home}! {hs}–{as}!', '{player} fires it home! {home} lead {hs}–{as}!', 'GOLAZO! {player} makes it {hs}–{as} for {home}!', '{player} with a brilliant strike — {hs}–{as}!'],
  goal_away:   ['{player} equalises for {away}! {hs}–{as}!', '{player} strikes! {away} level things up — {hs}–{as}!', '{player} fires past the keeper — {away} lead {hs}–{as}!', '{player} with a stunning effort! {hs}–{as}!'],
  shot_home:   ['{player} drives at goal — strong save!', '{player} shoots... just wide of the post!', '{player} from distance — keeper dives to push it away!', '{player} twists and fires — saved brilliantly!'],
  shot_away:   ['{player} tests the keeper — straight at him!', '{player} fires — the ball clips the bar!', '{player} with a rasping drive — tipped over!', '{player} shoots from range — wide by inches!'],
  yellow_home: ['{player} ({home}) is shown a yellow card for a reckless challenge.', 'Booking for {player} — {home} need to be careful.'],
  yellow_away: ['{player} ({away}) picks up a yellow card. Referee clamps down.', '{player} is cautioned — {away} playing on the edge.'],
  corner_home: ['{home} win a corner after good pressing from {player}.', 'Corner for {home} — set piece danger coming up.'],
  corner_away: ['{away} earn a corner kick. {player} driven wide.', 'Corner flag given to {away}. Dangerous delivery expected.'],
  safe_home:   ['Ball safe with {home}. {player} recycles possession.', '{home} settle the ball and reset the shape.'],
  safe_away:   ['Ball safe with {away}. {player} slows the tempo.', '{away} hold possession and reset from deep.'],
  foul_home:   ['{player} ({home}) brings down the attacker — free kick awarded.', 'Foul from {player} — {away} free kick in a good position.'],
  foul_away:   ['{player} ({away}) is penalised for a late tackle.', 'Dangerous challenge from {player} — free kick to {home}.'],
  half_time:   ['HALF TIME — {home} {hs}–{as} {away}. Teams head in at the break.', 'The referee brings the first half to an end. {home} {hs}–{as} {away}.'],
  full_time:   ['FULL TIME — {home} {hs}–{as} {away}. That is the final whistle!', 'Game over! Final score: {home} {hs}–{as} {away}.', 'What a match! {home} {hs}–{as} {away} at full time.'],
  second_half: ['Second half underway. {home} {hs}–{as} {away}.'],
  var_goal:    ['VAR review underway... the goal stands! {hs}–{as}!'],
};

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function pickPlayer(teamCode: string): string {
  const players = SQUAD_PLAYERS[teamCode];
  if (!players?.length) return 'the striker';
  return players[Math.floor(Math.random() * players.length)];
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function makeCommentary(type: string, fixture: Fixture, state: MatchState, teamCode?: string, player?: string): string {
  const templates = TEMPLATES[type] ?? [type];
  const p = player ?? (teamCode ? pickPlayer(teamCode) : 'the captain');
  return fillTemplate(pick(templates), {
    home:   fixture.home.name,
    away:   fixture.away.name,
    player: p,
    hs:     String(state.homeScore),
    as:     String(state.awayScore),
    venue:  fixture.venue.split('·')[0].trim(),
  });
}

// ── Logical pitch coordinates for events ─────────────────────────────────────
// X ∈ [-100,100]: home goal = +100, away goal = -100
// Y ∈ [-50,50]:   top touchline = -50, bottom = +50

function getEventCoords(type: string, team: 'home' | 'away' | 'neutral'): { lx: number; ly: number } {
  const r1 = Math.random(), r2 = Math.random();
  const sign = team === 'home' ? 1 : team === 'away' ? -1 : 0;
  if (type.includes('goal'))   return { lx: sign * (84 + r1 * 12),  ly: (r2 - 0.5) * 28 };
  if (type.includes('shot'))   return { lx: sign * (68 + r1 * 20),  ly: (r2 - 0.5) * 46 };
  if (type.includes('corner')) return { lx: sign * 97,               ly: (r2 > 0.5 ? 1 : -1) * (42 + r1 * 6) };
  if (type.includes('safe'))   return { lx: -sign * (34 + r1 * 30),  ly: (r2 - 0.5) * 54 };
  if (type === 'kickoff' || type === 'half_time' || type === 'full_time') return { lx: 0, ly: 0 };
  if (type.includes('foul') || type.includes('yellow') || type.includes('red'))
    return { lx: sign * (25 + r1 * 55), ly: (r2 - 0.5) * 80 };
  return { lx: sign * (20 + r1 * 40), ly: (r2 - 0.5) * 70 };
}

// ── MatchSimulator ────────────────────────────────────────────────────────────

type LogFn    = (prefix: LogPrefix, level: LogLevel, msg: string) => void;
type EventFn  = (fixtureId: string, state: MatchState) => void;
type SettleFn = (fixtureId: string, outcome: Outcome) => Promise<void>;

export class MatchSimulator {
  private states  = new Map<string, MatchState>();
  private timers  = new Map<string, ReturnType<typeof setTimeout>>();
  private eventId = 0;
  private readonly minuteMs = Number(process.env.SIM_MINUTE_MS ?? '6667');
  private readonly halfTimeBreakMs = Number(process.env.SIM_HALFTIME_BREAK_MS ?? '15000');

  constructor(
    private readonly onEvent:  EventFn,
    private readonly onSettle: SettleFn,
    private readonly log:      LogFn,
  ) {}

  schedule(fixtures: Fixture[], firstKickoffMs: number, intervalMs: number): void {
    fixtures.forEach((fixture, idx) => {
      const kickoffMs     = firstKickoffMs + idx * intervalMs;
      const stakingOpenMs = kickoffMs - 30 * 60_000;
      const now           = Date.now();

      fixture.simulatedKickoff = new Date(kickoffMs).toISOString();

      if (kickoffMs <= now) {
        const elapsed = Math.floor((now - kickoffMs) / this.minuteMs);
        if (elapsed < 90) { fixture.status = 'locked'; this.runMatch(fixture, elapsed); }
      } else {
        fixture.status = stakingOpenMs <= now ? 'open' : 'upcoming';
        if (stakingOpenMs > now) {
          setTimeout(() => {
            fixture.status = 'open';
            this.log('SYSTEM', 'info', `Staking open — ${fixture.home.code} vs ${fixture.away.code} kicks off in 30 min`);
            this.onEvent(fixture.id, this.states.get(fixture.id) ?? this.blankState(fixture, kickoffMs));
          }, stakingOpenMs - now);
        }
        setTimeout(() => {
          fixture.status = 'locked';
          this.log('SYSTEM', 'info', `Match locked — ${fixture.home.code} vs ${fixture.away.code} kicks off now`);
          this.runMatch(fixture, 0);
        }, kickoffMs - now);
      }
    });
  }

  getStates(): Record<string, MatchState> {
    return Object.fromEntries(this.states);
  }

  private blankState(fixture: Fixture, kickoffMs: number): MatchState {
    return { fixtureId: fixture.id, status: 'scheduled', minute: 0, homeScore: 0, awayScore: 0,
             events: [], simulatedKickoff: new Date(kickoffMs).toISOString(), possession: 50 };
  }

  private addEvent(
    state: MatchState,
    type: string,
    fixture: Fixture,
    team: 'home' | 'away' | 'neutral' = 'neutral',
    player?: string,
  ): MatchEvent {
    const teamCode = team === 'home' ? fixture.home.code : team === 'away' ? fixture.away.code : undefined;
    const resolvedPlayer = player ?? (teamCode ? pickPlayer(teamCode) : undefined);
    const coords = getEventCoords(type, team);
    const event: MatchEvent = {
      id:          ++this.eventId,
      minute:      state.minute,
      type,
      team,
      commentary:  makeCommentary(type, fixture, state, teamCode, resolvedPlayer),
      player:      resolvedPlayer,
      lx:          coords.lx,
      ly:          coords.ly,
    };
    state.events.push(event);
    if (state.events.length > 80) state.events.shift();
    this.log('SYSTEM', type.startsWith('goal') ? 'success' : 'info',
      `[${fixture.home.code} vs ${fixture.away.code}] ${event.commentary}`);
    return event;
  }

  private runMatch(fixture: Fixture, startMinute: number): void {
    const state: MatchState = {
      fixtureId:        fixture.id,
      status:           'live',
      minute:           startMinute,
      homeScore:        0,
      awayScore:        0,
      events:           [],
      simulatedKickoff: fixture.simulatedKickoff ?? new Date().toISOString(),
      possession:       50,
    };
    this.states.set(fixture.id, state);
    if (startMinute === 0) this.addEvent(state, 'kickoff', fixture, 'neutral');
    this.onEvent(fixture.id, state);

    const homeStr = SQUAD_STRENGTH[fixture.home.code] ?? 70;
    const awayStr = SQUAD_STRENGTH[fixture.away.code] ?? 70;

    const interval = setInterval(async () => {
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
        this.log('SYSTEM', 'success',
          `Final: ${fixture.home.code} ${state.homeScore}–${state.awayScore} ${fixture.away.code} — ${outcome.toUpperCase()}`);
        await this.onSettle(fixture.id, outcome);
        return;
      }

      this.simulateMinute(state, fixture, homeStr, awayStr);
      this.onEvent(fixture.id, state);
    }, this.minuteMs);

    this.timers.set(fixture.id, interval);
  }

  private simulateMinute(
    state: MatchState,
    fixture: Fixture,
    homeStr: number,
    awayStr: number,
  ): void {
    const rng = Math.random;

    // ── 12% Upset Bias Vector ────────────────────────────────────────────────
    // When a weaker team faces a stronger opponent (diff > 10 pts),
    // the underdog gets a 12% boost to their attacking probabilities,
    // forcing periodic defensive collapse and realistic upset variance.
    const diff = homeStr - awayStr;
    const upsetBias = 0.12;
    const homeBoost = diff < -10 ? upsetBias : 0;  // home is underdog
    const awayBoost = diff >  10 ? upsetBias : 0;  // away is underdog

    const homeGoalProb = (homeStr / 100) * 0.033 * 1.05 * (1 + homeBoost);
    const awayGoalProb = (awayStr / 100) * 0.028         * (1 + awayBoost);
    const totalStr     = homeStr + awayStr;
    const homePossProb = homeStr / totalStr;

    if (rng() < homeGoalProb) {
      state.homeScore++;
      state.possession = Math.min(72, state.possession + 5);
      this.addEvent(state, 'goal_home', fixture, 'home');
      if (rng() < 0.08) this.addEvent(state, 'var_goal', fixture, 'neutral');
    } else if (rng() < awayGoalProb) {
      state.awayScore++;
      state.possession = Math.max(28, state.possession - 5);
      this.addEvent(state, 'goal_away', fixture, 'away');
      if (rng() < 0.08) this.addEvent(state, 'var_goal', fixture, 'neutral');
    } else if (rng() < 0.13) {
      const team = rng() < homePossProb ? 'home' : 'away';
      this.addEvent(state, `shot_${team}`, fixture, team);
      state.possession += team === 'home' ? 2 : -2;
    } else if (rng() < 0.08) {
      const team = rng() < homePossProb ? 'home' : 'away';
      this.addEvent(state, `corner_${team}`, fixture, team);
    } else if (rng() < 0.12) {
      const team = rng() < homePossProb ? 'home' : 'away';
      this.addEvent(state, `safe_${team}`, fixture, team);
    } else if (rng() < 0.06) {
      const team = rng() < 0.5 ? 'home' : 'away';
      this.addEvent(state, `foul_${team}`, fixture, team);
    } else if (rng() < 0.025) {
      const team = rng() < 0.5 ? 'home' : 'away';
      this.addEvent(state, `yellow_${team}`, fixture, team);
    } else if (rng() < 0.003) {
      const team = rng() < 0.5 ? 'home' : 'away';
      this.addEvent(state, `red_${team}`, fixture, team);
    }

    // Possession drifts toward strength ratio
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
