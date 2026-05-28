import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets';
import './index.css';
import App from './App';
import { xLayerMainnet } from './lib/chain';

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

createRoot(document.getElementById('root')!).render(
  privyAppId ? (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ['email', 'wallet'],
        defaultChain: xLayerMainnet,
        supportedChains: [xLayerMainnet],
        appearance: {
          theme: 'dark',
          accentColor: '#2563eb',
          logo: 'https://fanvibe.xyz/assets/fanvibe-hero-logo.jpeg',
          landingHeader: 'FanVibe',
          loginMessage:
            'FanVibe staff will never ask for this code. Only enter it on fanvibe.xyz.',
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
          showWalletUIs: true,
        },
      }}
    >
      <SmartWalletsProvider>
        {app}
      </SmartWalletsProvider>
    </PrivyProvider>
  ) : app,
);
