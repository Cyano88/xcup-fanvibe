const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const REPORT_DELAYS_MS = [0, 2_000, 6_000, 12_000, 24_000];
const REFERRAL_KEY = 'fanvibe.referralSource';

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

function referralPayload(referred?: string | null) {
  const referrer = localStorage.getItem(REFERRAL_KEY);
  if (!referrer || !referred || referrer.toLowerCase() === referred.toLowerCase()) return {};
  if (!/^0x[0-9a-fA-F]{40}$/.test(referrer) || !/^0x[0-9a-fA-F]{40}$/.test(referred)) return {};
  return { referrer, referred };
}

export async function reportStakeTx(txHash: `0x${string}`, referred?: string | null): Promise<void> {
  let lastError: unknown;

  for (const delayMs of REPORT_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs);
    try {
      const response = await fetch(`${BACKEND_HTTP}/stake/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash, ...referralPayload(referred) }),
      });
      if (response.ok) {
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
  // Pending stake retries are owned by the backend. Kept as a no-op for older callers.
}
