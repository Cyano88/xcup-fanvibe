import { useEffect, useState } from 'react';

const FALLBACK_OKB_USD = Number(import.meta.env.VITE_OKB_USD_PRICE ?? '0');

export function useOkbUsdPrice() {
  const [price, setPrice] = useState(Number.isFinite(FALLBACK_OKB_USD) && FALLBACK_OKB_USD > 0 ? FALLBACK_OKB_USD : null);

  useEffect(() => {
    let cancelled = false;
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=okb&vs_currencies=usd')
      .then(res => res.ok ? res.json() : null)
      .then((data: { okb?: { usd?: number } } | null) => {
        const usd = data?.okb?.usd;
        if (!cancelled && typeof usd === 'number' && Number.isFinite(usd) && usd > 0) setPrice(usd);
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
