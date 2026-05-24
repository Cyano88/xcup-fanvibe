import { encodeAbiParameters, toHex } from 'viem';
import type { Outcome } from '../types';

const OUTCOME_INDEX: Record<Outcome, number> = { home: 0, draw: 1, away: 2 };

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
  const diff = new Date(kickoff).getTime() - Date.now();
  if (diff <= 0) return 'LIVE';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
