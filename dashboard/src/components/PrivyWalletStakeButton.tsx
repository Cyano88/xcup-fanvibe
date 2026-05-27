import { useState } from 'react';
import type { ReactNode } from 'react';
import { Wallet } from 'lucide-react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { parseEther } from 'viem';
import { xLayerMainnet } from '../lib/chain';

interface PrivyWalletStakeButtonProps {
  amountOKB: string;
  calldata: `0x${string}`;
  refereeAddress: string;
  disabled?: boolean;
  className?: string;
  pendingLabel?: string;
  children?: ReactNode;
  onBeforeStake?: () => Promise<boolean> | boolean;
  onSuccess?: (hash: `0x${string}`, amountWei: bigint, walletAddress: string) => void;
  onError?: (message: string) => void;
}

function isEmbeddedWallet(walletClientType: string) {
  return walletClientType === 'privy' || walletClientType === 'privy-v2';
}

function lowBalanceMessage(required: bigint, balance: bigint): string {
  return `Low OKB balance. You need at least ${(Number(required) / 1e18).toFixed(4)} OKB, but this wallet has ${(Number(balance) / 1e18).toFixed(4)} OKB.`;
}

export function PrivyWalletStakeButton({
  amountOKB,
  calldata,
  refereeAddress,
  disabled,
  className,
  pendingLabel = 'Confirm in wallet...',
  children = 'Stake via Wallet',
  onBeforeStake,
  onSuccess,
  onError,
}: PrivyWalletStakeButtonProps) {
  const { ready, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const [pending, setPending] = useState(false);

  const externalWallet = wallets.find(wallet => !isEmbeddedWallet(wallet.walletClientType));

  const handleStake = async () => {
    if (!ready) return;
    if (!externalWallet) {
      connectWallet();
      return;
    }

    setPending(true);
    onError?.('');

    try {
      const canStake = await onBeforeStake?.();
      if (canStake === false) return;

      await externalWallet.switchChain(xLayerMainnet.id);
      const amountWei = parseEther(amountOKB || '0');
      if (amountWei <= 0n) throw new Error('Invalid stake amount');

      const provider = await externalWallet.getEthereumProvider();
      const balanceHex = await provider.request({
        method: 'eth_getBalance',
        params: [externalWallet.address, 'latest'],
      }) as string;
      const balance = BigInt(balanceHex);
      if (balance < amountWei) throw new Error(lowBalanceMessage(amountWei, balance));

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: externalWallet.address,
          to: refereeAddress,
          value: `0x${amountWei.toString(16)}`,
          data: calldata,
          chainId: `0x${xLayerMainnet.id.toString(16)}`,
        }],
      }) as `0x${string}`;

      onSuccess?.(hash, amountWei, externalWallet.address);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Wallet stake failed';
      onError?.(message.includes('User rejected') ? 'Transaction rejected by wallet.' : message);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleStake}
      disabled={disabled || pending || !ready}
      className={className}
    >
      <Wallet size={14} />
      {pending ? pendingLabel : externalWallet ? children : 'Connect Wallet'}
    </button>
  );
}
