import { FANVIBE_TOKEN_API_URL } from './fanvibeToken';

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const CACHE_KEY = 'fanvibe:fvb-market-price-okb-wei';
const CACHE_TS_KEY = 'fanvibe:fvb-market-price-okb-wei:ts';
const FALLBACK_PRICE_WEI = import.meta.env.VITE_FVB_MARKET_PRICE_OKB_WEI as string | undefined;

function parsePrice(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  try {
    const price = BigInt(value);
    return price > 0n ? price : null;
  } catch {
    return null;
  }
}

function readCachedPrice(): bigint | null {
  if (typeof window === 'undefined') return parsePrice(FALLBACK_PRICE_WEI);
  return parsePrice(window.localStorage.getItem(CACHE_KEY)) ?? parsePrice(FALLBACK_PRICE_WEI);
}

function writeCachedPrice(priceWei: bigint): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, priceWei.toString());
    window.localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
  } catch {
    // localStorage can be blocked in private browsing; valuation should still degrade gracefully.
  }
}

export async function fetchFvbMarketPriceWei(): Promise<bigint | null> {
  try {
    const response = await fetch(`${BACKEND_HTTP}/fvb/price`, { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json() as { priceOkbWei?: string | null };
      const backendPrice = parsePrice(data.priceOkbWei);
      if (backendPrice) {
        writeCachedPrice(backendPrice);
        return backendPrice;
      }
    }
  } catch {
    // Fall through to direct provider fallback.
  }

  try {
    const response = await fetch(FANVIBE_TOKEN_API_URL, { cache: 'no-store' });
    if (!response.ok) return readCachedPrice();
    const data = await response.json() as {
      token?: { isGraduated?: boolean; isMigrated?: boolean };
      satoData?: { marketPriceOkb?: string };
    };
    if (!data.token?.isGraduated || !data.token?.isMigrated) return readCachedPrice();

    const livePrice = parsePrice(data.satoData?.marketPriceOkb);
    if (!livePrice) return readCachedPrice();

    writeCachedPrice(livePrice);
    return livePrice;
  } catch {
    return readCachedPrice();
  }
}
