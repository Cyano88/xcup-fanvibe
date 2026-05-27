import { useEffect, useRef, useState } from 'react';
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
  const [walletSyncing, setWalletSyncing] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const embeddedWallet = wallets.find(wallet => isEmbeddedWallet(wallet.walletClientType))
    ?? getEmbeddedConnectedWallet(wallets);
  const stakeWalletAddress = embeddedWallet?.address ?? null;

  useEffect(() => () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
  }, []);

  useEffect(() => {
    if (!embeddedWallet?.address) return;
    setWalletSyncing(false);
  }, [embeddedWallet?.address]);

  const reportError = (message: string) => {
    onError?.(message);
  };

  const handleEmailStake = async () => {
    if (!ready) return;

    if (!authenticated) {
      setWalletSyncing(false);
      login({ loginMethods: ['email'] });
      return;
    }

    if (!stakeWalletAddress) {
      if (!walletsReady) return;
      setPreparing(true);
      reportError('');
      try {
        await createWallet();
        setWalletSyncing(true);
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => {
          setWalletSyncing(false);
        }, 1500);
      } catch (err) {
        const message = walletErrorMessage(err, 'Email wallet setup failed');
        const lower = message.toLowerCase();
        if (lower.includes('unable to set up account') || lower.includes('already')) {
          setWalletSyncing(true);
          reportError('');
        } else {
          reportError(message);
        }
      } finally {
        setPreparing(false);
      }
      return;
    }

    setPending(true);
    setWalletSyncing(false);
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
      disabled={disabled || pending || preparing || walletSyncing || !ready}
      className={className}
    >
      <Mail size={14} />
      {pending ? pendingLabel : preparing ? 'Preparing wallet...' : walletSyncing ? 'Wallet syncing...' : children}
    </button>
  );
}
