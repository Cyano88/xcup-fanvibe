import type { Fixture } from '../types.js';

// The production season schedule is generated from the current 48-team World
// Cup group data in the dashboard and synced into the referee. Keeping no
// backend fallback here prevents stale Round-of-32/demo fixtures from creating
// phantom markets or showing non-qualified teams.
export const FIXTURES: Fixture[] = [];
