// Platform-wide stake floor: $1 worth of OKB.
// The OKB amount is derived dynamically from live OKB/USD price.
// Fallback assumes OKB ~ $67 when price hasn't loaded yet (~ $1 / 0.015 OKB).

export const STAKE_MIN_USD = 1;
export const STAKE_MIN_OKB_FALLBACK = 0.015;

export function getMinStakeOkb(okbUsd: number | null): number {
  if (!okbUsd || okbUsd <= 0) return STAKE_MIN_OKB_FALLBACK;
  return Math.max(STAKE_MIN_USD / okbUsd, 0.001);
}

export function getMinStakeOkbLabel(okbUsd: number | null): string {
  return getMinStakeOkb(okbUsd).toFixed(4);
}

export function minStakeMessage(okbUsd: number | null): string {
  return `Minimum stake is $${STAKE_MIN_USD} (${getMinStakeOkbLabel(okbUsd)} OKB).`;
}

export function cleanStakeAmountInput(value: string, minStakeOkb: number, minStakeOkbLabel: string): string | null {
  const normalized = value.replace(',', '.');
  if (normalized === '') return '';
  if (!/^\d*(?:\.\d*)?$/.test(normalized)) return null;
  const numericValue = Number(normalized);
  if (Number.isFinite(numericValue) && numericValue > 0 && numericValue < minStakeOkb) return minStakeOkbLabel;
  const [whole = '', decimals = ''] = normalized.split('.');
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '') || (whole.startsWith('0') ? '0' : whole);
  return decimals !== undefined && normalized.includes('.')
    ? `${trimmedWhole}.${decimals.slice(0, 4)}`
    : trimmedWhole;
}

export function normalizedStakeAmount(value: string, minStakeOkb: number, minStakeOkbLabel: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return amount < minStakeOkb ? minStakeOkbLabel : amount.toFixed(4).replace(/\.?0+$/, '');
}

export function cleanStakeUsdInput(value: string): string | null {
  const normalized = value.replace(',', '.');
  if (normalized === '') return '';
  if (!/^\d*(?:\.\d*)?$/.test(normalized)) return null;
  const [whole = '', decimals = ''] = normalized.split('.');
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '') || (whole.startsWith('0') ? '0' : whole);
  return decimals !== undefined && normalized.includes('.')
    ? `${trimmedWhole}.${decimals.slice(0, 2)}`
    : trimmedWhole;
}

export function normalizedStakeUsd(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return Math.max(amount, STAKE_MIN_USD).toFixed(2).replace(/\.00$/, '');
}

export function usdToOkbAmount(valueUsd: string, okbUsd: number | null): string {
  const usd = Number(valueUsd);
  if (!okbUsd || okbUsd <= 0 || !Number.isFinite(usd) || usd <= 0) return '';
  return (usd / okbUsd).toFixed(8).replace(/\.?0+$/, '');
}
