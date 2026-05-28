export const FAN_PROFILE_NAME_KEY = 'fanvibe.profileName';
export const FAN_PROFILE_EVENT = 'fanvibe-profile-updated';

function profileKey(address?: string | null): string {
  return address ? `${FAN_PROFILE_NAME_KEY}.${address.toLowerCase()}` : FAN_PROFILE_NAME_KEY;
}

export function shortWallet(address?: string | null): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getStoredProfileName(address?: string | null): string {
  const scoped = localStorage.getItem(profileKey(address))?.trim();
  if (scoped) return scoped;

  const legacy = localStorage.getItem(FAN_PROFILE_NAME_KEY)?.trim() ?? '';
  if (legacy && address) {
    localStorage.setItem(profileKey(address), legacy);
  }
  return legacy;
}

export function setStoredProfileName(name: string, address?: string | null): void {
  const value = name.trim().slice(0, 24);
  const key = profileKey(address);
  if (value) {
    localStorage.setItem(key, value);
    localStorage.setItem(FAN_PROFILE_NAME_KEY, value);
  } else {
    localStorage.removeItem(key);
    localStorage.removeItem(FAN_PROFILE_NAME_KEY);
  }
  window.dispatchEvent(new Event(FAN_PROFILE_EVENT));
}

export function fanDisplayName(address?: string | null, profileName = getStoredProfileName(address)): string {
  return profileName.trim() || shortWallet(address) || '';
}
