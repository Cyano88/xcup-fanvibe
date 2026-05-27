import { useState } from 'react';
import type { ReactNode } from 'react';
import { Mail } from 'lucide-react';
import {
  getEmbeddedConnectedWallet,
  useCreateWallet,
  usePrivy,
  useSendTransaction,
  useWallets,
} from '@privy-io/react-auth';
import { parseEther } from 'viem';
import { xLayerMainnet } from '../lib/chain';
import { walletErrorMessage } from '../lib/walletErrors';

interface PrivyStakeButtonProps {
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

const PRIVY_ENABLED = Boolean(import.meta.env.VITE_PRIVY_APP_ID);

function isEmbeddedWallet(walletClientType: string) {
  return walletClientType === 'privy' || walletClientType === 'privy-v2';
}

export function PrivyStakeButton({
  amountOKB,
  calldata,
  refereeAddress,
  disabled,
  className,
  pendingLabel = 'Confirm email wallet...',
  children = 'Stake via Email Smart Wallet',
  onBeforeStake,
  onSuccess,
  onError,
}: PrivyStakeButtonProps) {
  if (!PRIVY_ENABLED) return null;

  const { ready, authenticated, login } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { sendTransaction } = useSendTransaction();
  const [pending, setPending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preparedWalletAddress, setPreparedWalletAddress] = useState<string | null>(null);
  const [preparedForNextTap, setPreparedForNextTap] = useState(false);

  const embeddedWallet = wallets.find(wallet => isEmbeddedWallet(wallet.walletClientType))
    ?? getEmbeddedConnectedWallet(wallets);
  const stakeWalletAddress = embeddedWallet?.address ?? preparedWalletAddress;

  const reportError = (message: string) => {
    onError?.(message);
  };

  const handleEmailStake = async () => {
    if (!ready) return;

    if (!authenticated) {
      setPreparedWalletAddress(null);
      setPreparedForNextTap(false);
      login({ loginMethods: ['email'] });
      return;
    }

    if (!stakeWalletAddress) {
      if (!walletsReady) return;
      setPreparing(true);
      setPreparedForNextTap(false);
      reportError('');
      try {
        const wallet = await createWallet();
        setPreparedWalletAddress(wallet.address);
        setPreparedForNextTap(true);
      } catch (err) {
        reportError(walletErrorMessage(err, 'Email wallet setup failed'));
      } finally {
        setPreparing(false);
      }
      return;
    }

    setPending(true);
    setPreparedForNextTap(false);
    reportError('');

    try {
      const canStake = await onBeforeStake?.();
      if (canStake === false) return;

      const amountWei = parseEther(amountOKB || '0');
      if (amountWei <= 0n) throw new Error('Invalid stake amount');

      const { hash } = await sendTransaction(
        {
          to: refereeAddress,
          value: amountWei,
          data: calldata,
          chainId: xLayerMainnet.id,
        },
        {
          address: stakeWalletAddress,
          uiOptions: {
            showWalletUIs: true,
            description: `Stake ${amountOKB} OKB on X Layer Mainnet.`,
            buttonText: 'Confirm stake',
            successHeader: 'Stake sent',
            successDescription: 'Your FanVibe stake is live on X Layer.',
          },
        },
      );

      onSuccess?.(hash, amountWei, stakeWalletAddress);
    } catch (err) {
      reportError(walletErrorMessage(err, 'Email wallet stake failed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleEmailStake}
      disabled={disabled || pending || preparing || !ready}
      className={className}
    >
      <Mail size={14} />
      {pending ? pendingLabel : preparing ? 'Preparing wallet...' : preparedForNextTap ? 'Tap again to stake' : children}
    </button>
  );
}
