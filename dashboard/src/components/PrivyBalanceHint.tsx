import { useEffect, useMemo, useState } from 'react';
import { formatEther, parseEther } from 'viem';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { xLayerPublicClient } from '../lib/publicClient';
import { formatOkbUsdFromWei, useOkbUsdPrice } from '../lib/useOkbUsdPrice';

function isEmbeddedWallet(walletClientType: string) {
  return walletClientType === 'privy' || walletClientType === 'privy-v2';
}

function formatOKB(value: bigint): string {
  const n = Number(formatEther(value));
  return n >= 1 ? n.toFixed(3) : n.toFixed(4);
}

export function PrivyBalanceHint({ amountOKB }: { amountOKB: string }) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [checkedAddress, setCheckedAddress] = useState<string | null>(null);
  const okbUsd = useOkbUsdPrice();

  const wallet = useMemo(
    () => wallets.find(candidate => !isEmbeddedWallet(candidate.walletClientType))
      ?? wallets.find(candidate => isEmbeddedWallet(candidate.walletClientType))
      ?? null,
    [wallets],
  );

  const required = useMemo(() => {
    try {
      return parseEther(amountOKB || '0');
    } catch {
      return 0n;
    }
  }, [amountOKB]);

  useEffect(() => {
    let cancelled = false;
    if (!authenticated || !wallet?.address) {
      setBalance(null);
      setCheckedAddress(null);
      return;
    }

    xLayerPublicClient.getBalance({ address: wallet.address as `0x${string}` })
      .then(nextBalance => {
        if (cancelled) return;
        setBalance(nextBalance);
        setCheckedAddress(wallet.address);
      })
      .catch(() => {
        if (cancelled) return;
        setBalance(null);
        setCheckedAddress(wallet.address);
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated, wallet]);

  if (!authenticated || !checkedAddress || balance === null || required <= 0n || balance >= required) return null;
  const balanceUsd = formatOkbUsdFromWei(balance, okbUsd);

  return (
    <div className="w-full text-[11px] font-semibold text-red-400">
      Low OKB balance: {formatOKB(balance)} OKB{balanceUsd ? ` (${balanceUsd})` : ''} available.
    </div>
  );
}
