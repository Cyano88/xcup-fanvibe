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
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { parseEther } from 'viem';
import { xLayerMainnet } from '../lib/chain';
import { lowBalanceMessage, walletErrorMessage } from '../lib/walletErrors';

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
  const { client: smartWalletClient, getClientForChain } = useSmartWallets();
  const [pending, setPending] = useState(false);

  const embeddedWallet = wallets.find(wallet => isEmbeddedWallet(wallet.walletClientType))
    ?? getEmbeddedConnectedWallet(wallets);

  const reportError = (message: string) => {
    onError?.(message);
  };

  const handleEmailStake = async () => {
    if (!ready) return;

    if (!authenticated) {
      login({ loginMethods: ['email'] });
      return;
    }

    setPending(true);
    reportError('');

    try {
      const canStake = await onBeforeStake?.();
      if (canStake === false) return;

      let wallet = embeddedWallet;
      if (!wallet && walletsReady) {
        await createWallet();
        wallet = wallets.find(candidate => isEmbeddedWallet(candidate.walletClientType))
          ?? getEmbeddedConnectedWallet(wallets);
      }

      if (!wallet) {
        throw new Error('Email wallet is being created. Try again after login completes.');
      }

      await wallet.switchChain(xLayerMainnet.id);

      const amountWei = parseEther(amountOKB || '0');
      if (amountWei <= 0n) throw new Error('Invalid stake amount');

      const provider = await wallet.getEthereumProvider();
      const balanceHex = await provider.request({
        method: 'eth_getBalance',
        params: [wallet.address, 'latest'],
      }) as string;
      const balance = BigInt(balanceHex);
      if (balance < amountWei) throw new Error(lowBalanceMessage(amountWei, balance));

      try {
        const smartClient = await getClientForChain({ id: xLayerMainnet.id }) ?? smartWalletClient;
        if (smartClient) {
          const hash = await smartClient.sendTransaction(
            {
              to: refereeAddress as `0x${string}`,
              value: amountWei,
              data: calldata,
            },
            {
              uiOptions: {
                description: `Stake ${amountOKB} OKB from your FanVibe smart wallet.`,
                buttonText: 'Confirm stake',
                successHeader: 'Stake sent',
                successDescription: 'Your FanVibe smart-wallet stake is live on X Layer.',
              },
            },
          );

          onSuccess?.(hash, amountWei, smartClient.account.address);
          return;
        }
      } catch {
        // Fall through to the embedded signer path if smart wallets are not configured for X Layer yet.
      }

      const { hash } = await sendTransaction(
        {
          to: refereeAddress,
          value: amountWei,
          data: calldata,
          chainId: xLayerMainnet.id,
        },
        {
          address: wallet.address,
          uiOptions: {
            description: `Stake ${amountOKB} OKB on X Layer Mainnet.`,
            buttonText: 'Confirm stake',
            successHeader: 'Stake sent',
            successDescription: 'Your FanVibe stake is live on X Layer.',
          },
        },
      );

      onSuccess?.(hash, amountWei, wallet.address);
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
      disabled={disabled || pending || !ready}
      className={className}
    >
      <Mail size={14} />
      {pending ? pendingLabel : children}
    </button>
  );
}
