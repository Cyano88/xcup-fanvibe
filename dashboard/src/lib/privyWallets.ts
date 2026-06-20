export interface FanVibeWalletLike {
  address: string;
  walletClientType?: string | null;
}

export function isEmbeddedPrivyWallet(walletClientType?: string | null): boolean {
  return walletClientType === 'privy' || walletClientType === 'privy-v2';
}

export function preferredFanVibeWallet<T extends FanVibeWalletLike>(wallets: T[]): T | undefined {
  return wallets.find(wallet => isEmbeddedPrivyWallet(wallet.walletClientType)) ?? wallets[0];
}
