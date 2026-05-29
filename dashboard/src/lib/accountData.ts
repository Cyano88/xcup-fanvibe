const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';
const REFERRAL_KEY = 'fanvibe.referralSource';

export function getCapturedReferral(): string | null {
  try {
    const value = localStorage.getItem(REFERRAL_KEY);
    return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function captureReferralFromUrl(): string | null {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (!ref || !/^0x[0-9a-fA-F]{40}$/.test(ref)) return getCapturedReferral();
  try {
    localStorage.setItem(REFERRAL_KEY, ref);
  } catch {
    // Backend claim on sign-in is authoritative; local storage is capture-only.
  }
  return ref;
}

export async function fetchProfileName(address: string): Promise<string> {
  const res = await fetch(`${BACKEND_HTTP}/profiles/${address}`);
  if (!res.ok) return '';
  const data = await res.json() as { name?: string };
  return data.name?.trim() ?? '';
}

export async function saveProfileName(address: string, name: string): Promise<string> {
  const res = await fetch(`${BACKEND_HTTP}/profiles/${address}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Profile update failed');
  const data = await res.json() as { name?: string };
  return data.name?.trim() ?? '';
}

export async function claimReferral(referred: string, txHash?: `0x${string}`): Promise<void> {
  const referrer = getCapturedReferral();
  if (!referrer || referrer.toLowerCase() === referred.toLowerCase()) return;
  await fetch(`${BACKEND_HTTP}/referrals/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referrer, referred, txHash }),
  }).catch(() => {});
}
