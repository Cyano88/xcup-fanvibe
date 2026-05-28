const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const REPORT_DELAYS_MS = [0, 2_000, 6_000, 12_000, 24_000];
const PENDING_STAKE_REPORTS_KEY = 'fanvibe.pendingStakeReports';

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

function readPendingStakeReports(): `0x${string}`[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_STAKE_REPORTS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is `0x${string}` => /^0x[0-9a-fA-F]{64}$/.test(String(item)));
  } catch {
    return [];
  }
}

function writePendingStakeReports(txHashes: `0x${string}`[]) {
  try {
    localStorage.setItem(PENDING_STAKE_REPORTS_KEY, JSON.stringify([...new Set(txHashes)].slice(-25)));
  } catch {
    // Best-effort durability only.
  }
}

function queueStakeReport(txHash: `0x${string}`) {
  writePendingStakeReports([...readPendingStakeReports(), txHash]);
}

function removePendingStakeReport(txHash: `0x${string}`) {
  writePendingStakeReports(readPendingStakeReports().filter(item => item.toLowerCase() !== txHash.toLowerCase()));
}

export async function reportStakeTx(txHash: `0x${string}`): Promise<void> {
  queueStakeReport(txHash);
  let lastError: unknown;

  for (const delayMs of REPORT_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs);
    try {
      const response = await fetch(`${BACKEND_HTTP}/stake/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      });
      if (response.ok) {
        removePendingStakeReport(txHash);
        return;
      }
      lastError = new Error(`Stake report failed with status ${response.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    throw new Error('Stake was sent, but indexing is delayed.');
  }
}

export async function flushPendingStakeReports(): Promise<void> {
  const pending = readPendingStakeReports();
  for (const txHash of pending) {
    try {
      await reportStakeTx(txHash);
    } catch {
      // Keep it queued for the next app session or retry interval.
    }
  }
}
