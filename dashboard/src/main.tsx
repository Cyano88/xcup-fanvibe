import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets';
import './index.css';
import App from './App';
import { DocsPage } from './components/DocsPage';
import { RewardsClaim } from './components/RewardsClaim';
import { AdminRewards } from './components/AdminRewards';
import { xLayerMainnet } from './lib/chain';

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
const pathname = window.location.pathname.replace(/\/+$/, '') || '/';

function selectPage(): ReactNode {
  if (pathname === '/docs') return <DocsPage />;
  if (pathname === '/claim') return <RewardsClaim />;
  if (pathname === '/admin') return <AdminRewards />;
  return <App />;
}

const page = <StrictMode>{selectPage()}</StrictMode>;

const wrapped = privyAppId && pathname !== '/docs'
  ? (
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
      <SmartWalletsProvider>{page}</SmartWalletsProvider>
    </PrivyProvider>
  )
  : page;

createRoot(document.getElementById('root')!).render(wrapped);
