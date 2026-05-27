export const FAN_PROFILE_NAME_KEY = 'fanvibe.profileName';
export const FAN_PROFILE_EVENT = 'fanvibe-profile-updated';

export function shortWallet(address?: string | null): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getStoredProfileName(): string {
  return localStorage.getItem(FAN_PROFILE_NAME_KEY)?.trim() ?? '';
}

export function setStoredProfileName(name: string): void {
  const value = name.trim().slice(0, 24);
  if (value) {
    localStorage.setItem(FAN_PROFILE_NAME_KEY, value);
  } else {
    localStorage.removeItem(FAN_PROFILE_NAME_KEY);
  }
  window.dispatchEvent(new Event(FAN_PROFILE_EVENT));
}

export function fanDisplayName(address?: string | null, profileName = getStoredProfileName()): string {
  return profileName.trim() || shortWallet(address) || '';
}
