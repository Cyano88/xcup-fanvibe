import type { Fixture, MatchState, MatchEvent, Outcome, LogPrefix, LogLevel } from '../types.js';

// ── Squad data ────────────────────────────────────────────────────────────────

export const SQUAD_STRENGTH: Record<string, number> = {
  ARG: 94, FRA: 92, BRA: 91, ENG: 87, ESP: 86,
  GER: 85, POR: 85, NED: 83, BEL: 81, URU: 77,
  MEX: 75, CRO: 75, MAR: 74, SEN: 73, JPN: 73,
  CAN: 73, COL: 72, USA: 71, CIV: 69, ALG: 67,
  EGY: 67, BIH: 65, PAR: 64, RSA: 61,
};

const SQUAD_PLAYERS: Record<string, string[]> = {
  ARG: ['Messi', 'Álvarez', 'Di María', 'De Paul', 'Otamendi'],
  FRA: ['Mbappé', 'Griezmann', 'Camavinga', 'Tchouaméni', 'Thuram'],
  BRA: ['Vinicius Jr', 'Rodrygo', 'Paquetá', 'Endrick', 'Marquinhos'],
  ENG: ['Bellingham', 'Saka', 'Kane', 'Foden', 'Alexander-Arnold'],
  ESP: ['Yamal', 'Nico Williams', 'Pedri', 'Rodri', 'Morata'],
  GER: ['Musiala', 'Wirtz', 'Havertz', 'Kimmich', 'Rüdiger'],
  POR: ['Ronaldo', 'B. Silva', 'Leão', 'Vitinha', 'Neves'],
  NED: ['Van Dijk', 'Gakpo', 'Reijnders', 'De Jong', 'Dumfries'],
  BEL: ['De Bruyne', 'Lukaku', 'Trossard', 'Doku', 'Vertonghen'],
  URU: ['Núñez', 'Valverde', 'Bentancur', 'Araújo', 'Suárez'],
  MEX: ['Jiménez', 'Lozano', 'Guardado', 'Herrera', 'Álvarez'],
  CRO: ['Modrić', 'Kovačić', 'Perisić', 'Gvardiol', 'Kramarić'],
  MAR: ['Ziyech', 'En-Nesyri', 'Hakimi', 'Amrabat', 'Boufal'],
  SEN: ['Mané', 'Dia', 'Gueye', 'Koulibaly', 'Sabaly'],
  JPN: ['Kubo', 'Mitoma', 'Endo', 'Doan', 'Tomiyasu'],
  CAN: ['Davies', 'David', 'Johnston', 'Buchanan', 'Eustáquio'],
  COL: ['L. Díaz', 'J. Díaz', 'Arias', 'Cuadrado', 'Borré'],
  USA: ['Pulisic', 'Reyna', 'McKennie', 'Turner', 'Dest'],
  CIV: ['Haller', 'Zaha', 'Kessié', 'Sangaré', 'Konaté'],
  ALG: ['Mahrez', 'Bennacer', 'Slimani', 'Atal', 'Bounedjah'],
  EGY: ['Salah', 'Trezeguet', 'Elneny', 'Hamdy', 'El-Shenawy'],
  BIH: ['Džeko', 'Hadžiahmetović', 'Šunjić', 'Kolasinac', 'Kotnik'],
  PAR: ['Almirón', 'Sanabria', 'Gómez', 'Balbuena', 'Villasanti'],
  RSA: ['Tau', 'Dolly', 'Zwane', 'Maart', 'Monyane'],
};

// ── Commentary templates ──────────────────────────────────────────────────────

const TEMPLATES: Record<string, string[]> = {
  kickoff:     ['⚽ Kick off! The match is underway in {venue}!', '⚽ The referee blows — we are off! {home} vs {away}.'],
  goal_home:   ['⚽ GOAL! {player} fires past the keeper! {home} lead {hs}–{as}!', '⚽ {player} with a clinical finish! {hs}–{as}!', '⚽ GOLAZO! {player} makes it {hs}–{as} for {home}!'],
  goal_away:   ['⚽ GOAL! {player} levels it up for {away}! {hs}–{as}!', '⚽ {player} strikes! {away} pull one back — {hs}–{as}!', '⚽ What a hit from {player}! {hs}–{as}!'],
  shot_home:   ['{player} drives at goal — saved!', '{player} shoots... just wide of the post!', 'Corner for {home} after {player}\'s effort is blocked!'],
  shot_away:   ['{player} tests the keeper — straight at him!', '{player} fires over — close!', '{player} from distance, keeper tips it over!'],
  yellow_home: ['🟨 {player} ({home}) picks up a yellow for a late challenge.', '🟨 Booking for {player} — {home} must be careful now.'],
  yellow_away: ['🟨 Yellow card shown to {player} of {away}.', '🟨 The referee has a word with {player} before showing the card.'],
  corner_home: ['{home} win a corner. Quality delivery coming up...', 'Set piece opportunity for {home}...'],
  corner_away: ['{away} earn a corner kick.', 'Corner for {away} — danger from the set piece!'],
  half_time:   ['🔔 HALF TIME — {home} {hs}–{as} {away}', '🔔 The referee ends the first half. {home} {hs}–{as} {away} at the break.'],
  full_time:   ['🏁 FULL TIME — {home} {hs}–{as} {away}', '🏁 That\'s the final whistle! {home} {hs}–{as} {away}', '🏁 It\'s all over! Final score: {home} {hs}–{as} {away}'],
  var_goal:    ['📺 VAR check underway... the goal stands! {hs}–{as}!'],
};

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function makeCommentary(
  type: string,
  fixture: Fixture,
  state: MatchState,
  playerCode?: string,
): string {
  const templates = TEMPLATES[type] ?? [type];
  const players = SQUAD_PLAYERS[playerCode ?? ''] ?? ['the captain', 'the striker', 'the midfielder'];
  return fillTemplate(pick(templates), {
    home:   fixture.home.name,
    away:   fixture.away.name,
    player: pick(players),
    hs:     String(state.homeScore),
    as:     String(state.awayScore),
    venue:  fixture.venue.split('·')[0].trim(),
  });
}

// ── MatchSimulator ────────────────────────────────────────────────────────────

type LogFn   = (prefix: LogPrefix, level: LogLevel, msg: string) => void;
type EventFn = (fixtureId: string, state: MatchState) => void;
type SettleFn = (fixtureId: string, outcome: Outcome) => Promise<void>;

export class MatchSimulator {
  private states  = new Map<string, MatchState>();
  private timers  = new Map<string, ReturnType<typeof setInterval>>();
  private eventId = 0;

  constructor(
    private readonly onEvent:  EventFn,
    private readonly onSettle: SettleFn,
    private readonly log:      LogFn,
  ) {}

  // ── Schedule all fixtures from a start time ──────────────────────────────

  schedule(fixtures: Fixture[], firstKickoffMs: number, intervalMs: number): void {
    fixtures.forEach((fixture, idx) => {
      const kickoffMs      = firstKickoffMs + idx * intervalMs;
      const stakingOpenMs  = kickoffMs - 30 * 60 * 1000;
      const now            = Date.now();

      // Assign simulatedKickoff
      fixture.simulatedKickoff = new Date(kickoffMs).toISOString();

      if (kickoffMs <= now) {
        // Already started — run immediately (server restart recovery)
        const elapsed = Math.floor((now - kickoffMs) / 20_000);
        if (elapsed < 90) {
          fixture.status = 'locked';
          this.runMatch(fixture, elapsed);
        }
        // else: match would already be over — leave as open for re-staking demo
      } else {
        // Future match — set initial status
        fixture.status = stakingOpenMs <= now ? 'open' : 'upcoming';

        // Open staking
        if (stakingOpenMs > now) {
          setTimeout(() => {
            fixture.status = 'open';
            this.log('SYSTEM', 'info', `Staking open — ${fixture.home.code} vs ${fixture.away.code} kicks off in 30 min`);
            this.onEvent(fixture.id, this.states.get(fixture.id) ?? this.blankState(fixture, kickoffMs));
          }, stakingOpenMs - now);
        }

        // Lock + kick off
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

  // ── Internal ─────────────────────────────────────────────────────────────

  private blankState(fixture: Fixture, kickoffMs: number): MatchState {
    return {
      fixtureId:        fixture.id,
      status:           'scheduled',
      minute:           0,
      homeScore:        0,
      awayScore:        0,
      events:           [],
      simulatedKickoff: new Date(kickoffMs).toISOString(),
      possession:       50,
    };
  }

  private addEvent(state: MatchState, type: string, fixture: Fixture, team: 'home' | 'away' | 'neutral' = 'neutral'): MatchEvent {
    const playerCode = team === 'home' ? fixture.home.code : team === 'away' ? fixture.away.code : undefined;
    const event: MatchEvent = {
      id:          ++this.eventId,
      minute:      state.minute,
      type:        type as MatchEvent['type'],
      team,
      commentary:  makeCommentary(type, fixture, state, playerCode),
    };
    state.events.push(event);
    if (state.events.length > 60) state.events.shift();
    this.log('SYSTEM', type.startsWith('goal') ? 'success' : 'info', `[${fixture.home.code} vs ${fixture.away.code}] ${event.commentary}`);
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

    if (startMinute === 0) {
      this.addEvent(state, 'kickoff', fixture, 'neutral');
    }

    this.onEvent(fixture.id, state);

    const homeStr  = SQUAD_STRENGTH[fixture.home.code] ?? 70;
    const awayStr  = SQUAD_STRENGTH[fixture.away.code] ?? 70;

    const interval = setInterval(async () => {
      state.minute++;

      if (state.minute === 45) {
        this.addEvent(state, 'half_time', fixture, 'neutral');
        this.onEvent(fixture.id, state);
        return;
      }

      if (state.minute >= 90) {
        clearInterval(interval);
        this.timers.delete(fixture.id);
        this.addEvent(state, 'full_time', fixture, 'neutral');
        state.status = 'finished';
        this.onEvent(fixture.id, state);

        const outcome = this.determineOutcome(state);
        this.log('SYSTEM', 'success', `Final: ${fixture.home.code} ${state.homeScore}–${state.awayScore} ${fixture.away.code} — settling as ${outcome.toUpperCase()}`);
        await this.onSettle(fixture.id, outcome);
        return;
      }

      // Simulate the minute
      this.simulateMinute(state, fixture, homeStr, awayStr);
      this.onEvent(fixture.id, state);
    }, 20_000); // 20 real seconds = 1 game minute → 30 real min = 90 game min

    this.timers.set(fixture.id, interval);
  }

  private simulateMinute(state: MatchState, fixture: Fixture, homeStr: number, awayStr: number): void {
    const rng = Math.random;
    const homeGoalProb = (homeStr / 100) * 0.033 * 1.05; // home advantage
    const awayGoalProb = (awayStr / 100) * 0.028;

    if (rng() < homeGoalProb) {
      state.homeScore++;
      state.possession = Math.min(70, state.possession + 5);
      this.addEvent(state, 'goal_home', fixture, 'home');
      if (rng() < 0.1) this.addEvent(state, 'var_goal', fixture, 'neutral');
    } else if (rng() < awayGoalProb) {
      state.awayScore++;
      state.possession = Math.max(30, state.possession - 5);
      this.addEvent(state, 'goal_away', fixture, 'away');
      if (rng() < 0.1) this.addEvent(state, 'var_goal', fixture, 'neutral');
    } else if (rng() < 0.12) {
      const team = rng() < homeStr / (homeStr + awayStr) ? 'home' : 'away';
      this.addEvent(state, `shot_${team}`, fixture, team);
      state.possession += team === 'home' ? 2 : -2;
    } else if (rng() < 0.07) {
      const team = rng() < 0.5 ? 'home' : 'away';
      this.addEvent(state, `corner_${team}`, fixture, team);
    } else if (rng() < 0.025) {
      const team = rng() < 0.5 ? 'home' : 'away';
      this.addEvent(state, `yellow_${team}`, fixture, team);
    }

    // Possession drift toward 50
    state.possession = Math.round(state.possession * 0.95 + 50 * 0.05);
    state.possession = Math.max(30, Math.min(70, state.possession));
  }

  private determineOutcome(state: MatchState): Outcome {
    if (state.homeScore > state.awayScore) return 'home';
    if (state.awayScore > state.homeScore) return 'away';
    return 'draw';
  }
}
