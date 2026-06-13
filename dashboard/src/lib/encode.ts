import { encodeAbiParameters, toHex } from 'viem';
import type { Outcome } from '../types';

const OUTCOME_INDEX: Record<Outcome, number> = { home: 0, draw: 1, away: 2 };

// Champion prediction market — must match backend CHAMP_TEAMS order exactly
export const CHAMP_FIXTURE_ID = 'champion-2026';
export const CHAMP_TEAMS = [
  'CAN','MEX','USA','AUS','IRQ','IRN','JPN','JOR',
  'KOR','QAT','KSA','UZB','ALG','CPV','COD','CIV',
  'EGY','GHA','MAR','SEN','RSA','TUN','CUW','HAI',
  'PAN','ARG','BRA','COL','ECU','PAR','URU','NZL',
  'AUT','BEL','BIH','CRO','CZE','ENG','FRA','GER',
  'NED','NOR','POR','SCO','ESP','SWE','SUI','TUR',
] as const;

export const CHAMP_TEAM_INDEX: Record<string, number> =
  Object.fromEntries(CHAMP_TEAMS.map((t, i) => [t, i]));

export function encodeChampionStake(teamCode: string): `0x${string}` {
  const idx = CHAMP_TEAM_INDEX[teamCode];
  if (idx === undefined) throw new Error(`Unknown champion team: ${teamCode}`);
  return encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint8' }],
    [toHex(CHAMP_FIXTURE_ID, { size: 32 }), idx],
  );
}

export function encodeStakeCalldata(fixtureId: string, outcome: Outcome): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint8' }],
    [toHex(fixtureId, { size: 32 }), OUTCOME_INDEX[outcome]],
  );
}

export function formatOKB(wei: string, decimals = 4): string {
  if (!wei || wei === '0') return '0.0000';
  const val = Number(BigInt(wei)) / 1e18;
  return val.toFixed(decimals);
}

export function formatPool(pool: { home: string; draw: string; away: string }): {
  homeOKB: string;
  drawOKB: string;
  awayOKB: string;
  totalOKB: string;
  homeShare: number;
  drawShare: number;
  awayShare: number;
} {
  const h = Number(BigInt(pool.home)) / 1e18;
  const d = Number(BigInt(pool.draw)) / 1e18;
  const a = Number(BigInt(pool.away)) / 1e18;
  const total = h + d + a;

  return {
    homeOKB:   h.toFixed(4),
    drawOKB:   d.toFixed(4),
    awayOKB:   a.toFixed(4),
    totalOKB:  total.toFixed(4),
    homeShare: total > 0 ? (h / total) * 100 : 33.3,
    drawShare: total > 0 ? (d / total) * 100 : 33.3,
    awayShare: total > 0 ? (a / total) * 100 : 33.3,
  };
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function countdown(kickoff: string): string {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(kickoff)
    ? `${kickoff.replace(' ', 'T')}Z`
    : kickoff;
  const diff = Date.parse(normalized) - Date.now();
  if (diff <= 0) return 'Awaiting feed';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
