import type { RefereeEngine } from './referee.js';
import { MatchSimulator } from './simulation.js';
import {
  DEFAULT_SEASON_TIMING,
  TEST_SEASON_TIMING,
  advanceKnockout,
  allGroupMatchesFinished,
  createSeasonFixtures,
  currentGroupMatchday,
  isGroupStageFixture,
  isSeasonFixtureDue,
  matchOutcome,
  qualifiedTeams,
  seedRoundOf32,
  setSeasonTiming,
  type SeasonTiming,
} from './seasonTournament.js';
import {
  readSeasonState,
  writeSeasonState,
  type PersistedSeasonState,
  type SeasonPhase,
} from '../seasonStore.js';
import type { DaemonLog, Fixture, MatchState, Outcome, Team } from '../types.js';

type LogFn = (prefix: DaemonLog['prefix'], level: DaemonLog['level'], message: string, txHash?: string) => void;

const VERIFIED_SEASON_ONE_WINNER: { seasonNumber: number; team: Team } = {
  seasonNumber: 1,
  team: { name: 'South Africa', code: 'RSA', flag: '🇿🇦', iso: 'za' },
};

function freshSeasonState(seasonNumber = 1, now = Date.now(), timings: SeasonTiming = DEFAULT_SEASON_TIMING): PersistedSeasonState {
  return {
    version: 1,
    mode: 'prod',
    seasonNumber,
    phase: 'preseason',
    phaseEndsAt: now + timings.preseasonSeconds * 1000,
    phaseTimer: timings.preseasonSeconds,
    fixtures: createSeasonFixtures(seasonNumber),
    matchStates: {},
    eliminatedTeams: [],
    champion: null,
    previousKnockoutResults: null,
    seasonWinners: [],
    tournamentGen: 0,
    timings,
    updatedAt: now,
  };
}

function outcomeFromState(state: MatchState): Outcome {
  if (state.penaltyWinner) return state.penaltyWinner;
  if (state.homeScore > state.awayScore) return 'home';
  if (state.awayScore > state.homeScore) return 'away';
  return 'draw';
}

export class SeasonController {
  private state: PersistedSeasonState = freshSeasonState();
  private readonly timing: SeasonTiming;
  private readonly simulator: MatchSimulator;
  private readonly scheduled = new Set<string>();
  private readonly processed = new Set<string>();
  private tickTimer?: ReturnType<typeof setInterval>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private championTriggered = false;

  public onUpdate?: (state: PersistedSeasonState) => void;

  constructor(
    private readonly referee: RefereeEngine,
    private readonly log: LogFn,
  ) {
    this.timing = process.env.SEASON_RUNTIME_MODE === 'test' ? TEST_SEASON_TIMING : DEFAULT_SEASON_TIMING;
    setSeasonTiming(this.timing);
    this.simulator = new MatchSimulator(
      (fixtureId, matchState) => this.handleMatchUpdate(fixtureId, matchState),
      async (fixtureId, outcome) => this.handleSettle(fixtureId, outcome),
      this.log,
    );
  }

  async start(): Promise<void> {
    const stored = await readSeasonState('prod');
    this.state = stored?.mode === 'prod' ? this.normalizeStoredState(stored) : freshSeasonState(1, Date.now(), this.timing);
    this.referee.syncFixtures(this.state.fixtures);
    this.resumeStoredLiveMatches();
    this.emit();
    this.tick();
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.log('SYSTEM', 'success', `Server-owned season clock active - Season ${this.state.seasonNumber}`);
  }

  getState(): PersistedSeasonState {
    return {
      ...this.state,
      phaseTimer: Math.max(0, Math.ceil((this.state.phaseEndsAt - Date.now()) / 1000)),
      updatedAt: Date.now(),
    };
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }

  async resetToFreshSeason(seasonNumber = 1): Promise<PersistedSeasonState> {
    this.simulator.cancelAll();
    this.scheduled.clear();
    this.processed.clear();
    this.championTriggered = false;
    this.state = freshSeasonState(seasonNumber, Date.now(), this.timing);
    this.referee.syncFixtures(this.state.fixtures);
    await writeSeasonState('prod', this.getState());
    this.log('SYSTEM', 'success', `Production season reset to fresh preseason - Season ${seasonNumber}`);
    this.emit(false);
    return this.getState();
  }

  private normalizeStoredState(stored: PersistedSeasonState): PersistedSeasonState {
    const timings = stored.timings?.waveGapMs === undefined ? this.timing : stored.timings;
    const seasonWinners = this.withVerifiedSeasonOneWinner(stored.seasonWinners ?? [], stored.seasonNumber ?? 1);
    return {
      ...stored,
      mode: 'prod',
      timings,
      fixtures: stored.fixtures?.length ? stored.fixtures : createSeasonFixtures(stored.seasonNumber || 1),
      matchStates: stored.matchStates ?? {},
      eliminatedTeams: stored.eliminatedTeams ?? [],
      champion: stored.champion ?? null,
      previousKnockoutResults: stored.previousKnockoutResults ?? null,
      seasonWinners,
      updatedAt: Date.now(),
    };
  }

  private startPreseason(nextSeasonNumber: number): void {
    const now = Date.now();
    const previousKnockoutResults = this.archiveCurrentSeason();
    const seasonWinners = this.nextWinnerHistory(previousKnockoutResults?.champion ?? null);
    this.simulator.cancelAll();
    this.scheduled.clear();
    this.processed.clear();
    this.championTriggered = false;
    this.state = freshSeasonState(nextSeasonNumber, now, this.timing);
    this.state.previousKnockoutResults = previousKnockoutResults;
    this.state.seasonWinners = seasonWinners;
    this.log('SYSTEM', 'info', `Season ${nextSeasonNumber} preseason started`);
    this.emit();
  }

  private archiveCurrentSeason(): PersistedSeasonState['previousKnockoutResults'] {
    const champion = this.state.champion;
    const fixtures = this.state.fixtures.filter(fixture =>
      fixture.round === 'R16' ||
      fixture.round === 'QF' ||
      fixture.round === 'SF' ||
      fixture.round === '3PL' ||
      fixture.round === 'F'
    );
    if (!champion || fixtures.length === 0) return null;
    const fixtureIds = new Set(fixtures.map(fixture => fixture.id));
    const matchStates = Object.fromEntries(
      Object.entries(this.state.matchStates).filter(([fixtureId]) => fixtureIds.has(fixtureId))
    );
    return {
      seasonNumber: this.state.seasonNumber,
      champion,
      fixtures,
      matchStates,
    };
  }

  private nextWinnerHistory(champion: Team | null): NonNullable<PersistedSeasonState['seasonWinners']> {
    const existing = this.withVerifiedSeasonOneWinner(this.state.seasonWinners ?? [], this.state.seasonNumber);
    if (!champion) return existing;
    const withoutCurrent = existing.filter(item => item.seasonNumber !== this.state.seasonNumber);
    return [...withoutCurrent, { seasonNumber: this.state.seasonNumber, team: champion }].slice(-12);
  }

  private withVerifiedSeasonOneWinner(
    winners: NonNullable<PersistedSeasonState['seasonWinners']>,
    seasonNumber: number,
  ): NonNullable<PersistedSeasonState['seasonWinners']> {
    if (seasonNumber < 2 || winners.some(item => item.seasonNumber === 1)) return winners;
    return [VERIFIED_SEASON_ONE_WINNER, ...winners].slice(-12);
  }

  private startPlaying(): void {
    this.state.phase = 'playing';
    this.state.phaseEndsAt = Date.now();
    this.state.phaseTimer = 0;
    this.state.updatedAt = Date.now();
    this.referee.syncFixtures(this.state.fixtures);
    this.log('SYSTEM', 'success', `Season ${this.state.seasonNumber} group stage started`);
    this.emit();
  }

  private tick(): void {
    const now = Date.now();
    this.state.phaseTimer = Math.max(0, Math.ceil((this.state.phaseEndsAt - now) / 1000));

    if (this.state.phase === 'preseason' && this.state.phaseTimer <= 0) {
      this.startPlaying();
      return;
    }

    if (this.state.phase === 'champion' && this.state.phaseTimer <= 0) {
      this.startPreseason(this.state.seasonNumber + 1);
      return;
    }

    if (this.state.phase === 'interseason' && this.state.phaseTimer <= 0) {
      this.startPlaying();
      return;
    }

    if (this.state.phase !== 'playing') {
      this.emit(false);
      return;
    }

    this.seedGroupKnockoutIfReady();
    this.scheduleDueFixtures(now);
    this.emit(false);
  }

  private scheduleDueFixtures(now: number): void {
    for (const fixture of this.state.fixtures) {
      if (fixture.home.code === 'TBD' || fixture.away.code === 'TBD') continue;
      if (fixture.status === 'settled') continue;
      const matchState = this.state.matchStates[fixture.id];
      if (matchState?.status === 'finished') continue;
      if (this.scheduled.has(fixture.id)) continue;
      if (!isGroupStageFixture(fixture) && fixture.status !== 'open') continue;
      if (!isSeasonFixtureDue(this.state.fixtures, fixture, this.state.phaseEndsAt, this.state.matchStates, now)) continue;

      fixture.status = 'locked';
      fixture.simulatedKickoff = new Date(now).toISOString();
      this.scheduled.add(fixture.id);
      this.referee.syncFixtures([fixture]);
      this.simulator.schedule([fixture], now, 0);
      this.log('SYSTEM', 'info', `Server started ${fixture.home.code} vs ${fixture.away.code} (${this.labelForFixture(fixture)})`);
    }
  }

  private resumeStoredLiveMatches(): void {
    for (const fixture of this.state.fixtures) {
      const matchState = this.state.matchStates[fixture.id];
      if (!matchState || matchState.status === 'finished' || matchState.status === 'scheduled') continue;
      if (fixture.home.code === 'TBD' || fixture.away.code === 'TBD') continue;
      fixture.status = 'locked';
      this.scheduled.add(fixture.id);
      this.simulator.resume(fixture, matchState);
      this.log('SYSTEM', 'info', `Resumed live match ${fixture.home.code} vs ${fixture.away.code} at ${matchState.minute}'`);
    }
  }

  private handleMatchUpdate(fixtureId: string, matchState: MatchState): void {
    if (this.state.phase !== 'playing') return;
    this.state.matchStates[fixtureId] = matchState;
    const fixture = this.state.fixtures.find(f => f.id === fixtureId);
    if (fixture && matchState.status !== 'finished') {
      fixture.status = matchState.status === 'scheduled' ? 'open' : 'locked';
    }
    this.emit();
  }

  private async handleSettle(fixtureId: string, outcome: Outcome): Promise<void> {
    if (this.state.phase !== 'playing') return;
    const fixture = this.state.fixtures.find(f => f.id === fixtureId);
    if (!fixture || fixture.status === 'settled') return;
    fixture.status = 'settled';
    fixture.result = outcome;
    this.processFinishedFixture(fixtureId);
    this.emit();
    try {
      await this.referee.settleSyncedFixture(fixtureId, outcome);
    } catch (err) {
      this.log('SYSTEM', 'warn', `Settlement sync failed for ${fixtureId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.emit();
  }

  private seedGroupKnockoutIfReady(): void {
    if (!allGroupMatchesFinished(this.state.fixtures, this.state.matchStates)) return;
    if (this.state.fixtures.some(f => f.id === 'k32-1' && f.home.code !== 'TBD')) return;
    const qualified = new Set(qualifiedTeams(this.state.fixtures, this.state.matchStates).map(team => team.code));
    const allTeams = new Set(this.state.fixtures.filter(isGroupStageFixture).flatMap(f => [f.home.code, f.away.code]));
    this.state.eliminatedTeams = [...allTeams].filter(code => !qualified.has(code));
    this.state.fixtures = seedRoundOf32(this.state.fixtures, this.state.matchStates);
    this.referee.syncFixtures(this.state.fixtures);
    this.log('SYSTEM', 'success', 'Round of 32 bracket seeded from group tables');
  }

  private processFinishedFixture(fixtureId: string): void {
    if (this.processed.has(fixtureId)) return;
    this.processed.add(fixtureId);

    const matchState = this.state.matchStates[fixtureId];
    if (!matchState?.status || matchState.status !== 'finished') return;

    const result = advanceKnockout(this.state.fixtures, fixtureId, matchState);
    if (result.fixtures !== this.state.fixtures) {
      this.state.fixtures = result.fixtures;
      if (result.eliminated) this.addEliminated(result.eliminated);
      this.referee.syncFixtures(this.state.fixtures);
    }

    if (fixtureId === 'f-1' && !this.championTriggered) {
      this.championTriggered = true;
      const final = this.state.fixtures.find(f => f.id === 'f-1');
      if (final) {
        const winner = outcomeFromState(matchState) === 'away' ? final.away : final.home;
        if (winner.code === 'TBD' || winner.iso === 'tbd') {
          this.championTriggered = false;
          this.log('SYSTEM', 'warn', 'Final finished before qualifiers were resolved; champion phase skipped');
          return;
        }
        this.state.champion = winner;
        this.state.phase = 'champion';
        this.state.phaseEndsAt = Date.now() + 5_000;
        this.state.phaseTimer = 5;
        this.log('SYSTEM', 'success', `${this.state.champion.code} win Season ${this.state.seasonNumber}`);
      }
    }
  }

  private addEliminated(team: Team): void {
    if (team.code === 'TBD' || this.state.eliminatedTeams.includes(team.code)) return;
    this.state.eliminatedTeams = [...this.state.eliminatedTeams, team.code];
  }

  private labelForFixture(fixture: Fixture): string {
    if (isGroupStageFixture(fixture)) return `MD${currentGroupMatchday(this.state.fixtures, this.state.matchStates)}`;
    return fixture.round ?? 'Knockout';
  }

  private emit(save = true): void {
    this.state.updatedAt = Date.now();
    this.onUpdate?.(this.getState());
    if (!save) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      writeSeasonState('prod', this.getState()).catch(err => {
        this.log('SYSTEM', 'warn', `Season persistence failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, 400);
  }
}
