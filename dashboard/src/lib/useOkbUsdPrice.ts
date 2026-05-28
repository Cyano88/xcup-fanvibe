import { useEffect, useState } from 'react';

const OKB_PRICE_CACHE_KEY = 'fanvibe.okbUsdPrice';
const OKB_PRICE_CACHE_TTL_MS = 30 * 60 * 1000;
const FALLBACK_OKB_USD = Number(import.meta.env.VITE_OKB_USD_PRICE ?? '88');

function validPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function readCachedPrice(): number | null {
  try {
    const raw = localStorage.getItem(OKB_PRICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { price?: unknown; ts?: unknown };
    if (!validPrice(parsed.price) || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > OKB_PRICE_CACHE_TTL_MS) return null;
    return parsed.price;
  } catch {
    return null;
  }
}

function writeCachedPrice(price: number): void {
  try {
    localStorage.setItem(OKB_PRICE_CACHE_KEY, JSON.stringify({ price, ts: Date.now() }));
  } catch {
    // Price cache is only a display fallback.
  }
}

function fallbackPrice(): number {
  return validPrice(FALLBACK_OKB_USD) ? FALLBACK_OKB_USD : 88;
}

export function useOkbUsdPrice() {
  const [price, setPrice] = useState<number>(() => readCachedPrice() ?? fallbackPrice());

  useEffect(() => {
    let cancelled = false;
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=okb&vs_currencies=usd')
      .then(res => res.ok ? res.json() : null)
      .then((data: { okb?: { usd?: number } } | null) => {
        const usd = data?.okb?.usd;
        if (!cancelled && validPrice(usd)) {
          setPrice(usd);
          writeCachedPrice(usd);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return price;
}

export function formatStakeUsd(amountOKB: string, okbUsd: number | null) {
  const amount = Number(amountOKB);
  if (!okbUsd || !Number.isFinite(amount) || amount <= 0) return null;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount * okbUsd >= 1 ? 2 : 4,
  }).format(amount * okbUsd);
}

export function formatOkbUsd(amountOKB: number | string | null | undefined, okbUsd: number | null) {
  const amount = Number(amountOKB);
  if (!okbUsd || !Number.isFinite(amount) || amount <= 0) return null;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount * okbUsd >= 1 ? 2 : 4,
  }).format(amount * okbUsd);
}

export function formatOkbUsdFromWei(wei: bigint | string | number | null | undefined, okbUsd: number | null) {
  if (wei === null || wei === undefined) return null;
  try {
    const value = typeof wei === 'bigint' ? wei : BigInt(wei);
    return formatOkbUsd(Number(value) / 1e18, okbUsd);
  } catch {
    return null;
  }
}
