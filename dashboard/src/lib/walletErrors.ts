export function lowBalanceMessage(required: bigint, balance: bigint): string {
  return `Low OKB balance. You need at least ${(Number(required) / 1e18).toFixed(4)} OKB, but this wallet has ${(Number(balance) / 1e18).toFixed(4)} OKB.`;
}

export function walletErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || fallback);
  const lower = message.toLowerCase();

  if (lower.includes('user rejected') || lower.includes('user denied')) {
    return 'Transaction rejected by wallet.';
  }

  if (
    lower.includes('failed to fetch')
    || lower.includes('http request failed')
    || lower.includes('eth_getbalance')
    || lower.includes('rpc.xlayer.tech')
  ) {
    return 'Could not read this wallet balance on X Layer. If this wallet has no OKB, fund it first, then try again.';
  }

  return message;
}
