const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const REPORT_DELAYS_MS = [0, 2_000, 6_000, 12_000, 24_000];

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export async function reportStakeTx(txHash: `0x${string}`): Promise<void> {
  let lastError: unknown;

  for (const delayMs of REPORT_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs);
    try {
      const response = await fetch(`${BACKEND_HTTP}/stake/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      });
      if (response.ok) return;
      lastError = new Error(`Stake report failed with status ${response.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    throw new Error('Stake was sent, but indexing is delayed.');
  }
}
