import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { ThemeSwitcher } from './ThemeSwitcher';

const explorerTx = (tx: string) => `https://www.okx.com/web3/explorer/xlayer/tx/${tx}`;
const explorerAddr = (addr: string) => `https://www.okx.com/web3/explorer/xlayer/address/${addr}`;

const hookAddress = '0x4B6612ca209f07db44f8A651E4217A75106C4080';
const proofRouter = '0x1e950c0b870b974dF997D61C3dF0A6701C489720';
const poolId = '0x04a73ca9283b864136f6e14dc41de8dd1defad19b353242a9fc100d4b46fa15b';
const deployTx = '0xeff4a1213e9324508461375f49889aa1e3c49dd25c9cdfd2040cae18771080c8';
const initTx = '0x1ad16c9894db8ad8b1a1e29c9f7425170dc20188f81eb20b0ad77f32f4d95306';
const approveTx = '0xf0b842fa937598ff7b8babd6585a6946020339e6ef3a2119e32f273928d58237';
const liquidityTx = '0x25a163de30aa698bc15bf6760bfc654f81b75dc8c604d2b8e3e7f8d586f24063';
const swapProofTx = '0xe38fd0daf3e879270ecff754f5cbf4668715825b0ed11926f873cacd50ad9c3c';
const phaseResetTx = '0xa997a130a0f1c5366b5fa26727aff891f767a5d5a24269f778ea642a994d9494';

const navItems = [
  ['Overview', '#overview'],
  ['Product Flow', '#flow'],
  ['Account', '#account'],
  ['Markets', '#markets'],
  ['Portfolio', '#portfolio'],
  ['X Layer Proof', '#x-layer'],
  ['v4 Hook', '#v4-hook'],
  ['Safety', '#safety'],
];

const featureRows = [
  ['Sign in', 'Wallet connect or email smart-wallet sign-in through Privy.'],
  ['Stake', 'OKB-denominated fixture and champion markets on X Layer Mainnet.'],
  ['Watch', 'Continuous FanVibe seasons with live match state, comments, and market movement.'],
  ['Settle', 'Payouts, refunds, lost positions, and active markets remain tied to the account.'],
  ['Verify', 'Stake, payout, refund, and hook proof records link to X Layer explorers.'],
];

const proofRows = [
  ['Hook', hookAddress, explorerAddr(hookAddress)],
  ['Proof router', proofRouter, explorerAddr(proofRouter)],
  ['Deploy tx', deployTx, explorerTx(deployTx)],
  ['Pool init tx', initTx, explorerTx(initTx)],
  ['Pool approval tx', approveTx, explorerTx(approveTx)],
  ['Liquidity tx', liquidityTx, explorerTx(liquidityTx)],
  ['Swap proof tx', swapProofTx, explorerTx(swapProofTx)],
  ['Phase reset tx', phaseResetTx, explorerTx(phaseResetTx)],
];

function short(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function DetailLink({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="grid grid-cols-[112px_1fr_18px] items-center gap-3 border-b border-zinc-200 py-3 text-sm transition-colors last:border-b-0 hover:text-blue-600 dark:border-zinc-900 dark:hover:text-blue-300"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="min-w-0 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">{short(value)}</span>
      <ExternalLink size={14} className="text-zinc-400" />
    </a>
  );
}

export function DocsPage() {
  const [dark, setDark] = useState(() => {
    const saved = window.localStorage.getItem('fanvibe-theme');
    if (saved === 'light') return false;
    if (saved === 'dark') return true;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    window.localStorage.setItem('fanvibe-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className="min-h-screen bg-white text-zinc-950 dark:bg-black dark:text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur-xl dark:border-zinc-900 dark:bg-black/90">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-800 transition-colors hover:text-blue-600 dark:text-zinc-200 dark:hover:text-blue-300">
            <ArrowLeft size={16} />
            FanVibe
          </a>
          <div className="flex items-center gap-3">
            <a href="https://github.com/Cyano88/xcup-fanvibe" target="_blank" rel="noopener noreferrer" className="hidden text-sm font-semibold text-zinc-500 transition-colors hover:text-zinc-950 dark:text-zinc-500 dark:hover:text-zinc-100 sm:inline-flex">
              GitHub
            </a>
            <ThemeSwitcher dark={dark} onToggle={() => setDark(value => !value)} />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[220px_1fr] lg:px-8 lg:py-12">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1 text-sm">
            {navItems.map(([label, href]) => (
              <a key={href} href={href} className="block rounded-md px-3 py-2 font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-zinc-950 dark:hover:text-zinc-100">
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
          <section id="overview" className="border-b border-zinc-200 pb-10 dark:border-zinc-900">
            <div className="mb-5 inline-flex rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              X Layer prediction markets
            </div>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-zinc-950 dark:text-white sm:text-6xl">
              A live football market with transparent settlement.
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
              FanVibe lets users sign in, stake OKB on simulated football markets, follow live match state, and review every position from one portfolio. The platform keeps account activity visible, compact, and verifiable on X Layer.
            </p>
            <div className="mt-8 grid gap-3 border-y border-zinc-200 py-4 dark:border-zinc-900 sm:grid-cols-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Network</div>
                <div className="mt-1 text-sm font-semibold">X Layer Mainnet</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Market asset</div>
                <div className="mt-1 text-sm font-semibold">OKB</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">DeFi module</div>
                <div className="mt-1 text-sm font-semibold">WOKB/USDT v4 hook</div>
              </div>
            </div>
          </section>

          <section id="flow" className="grid gap-8 border-b border-zinc-200 py-10 dark:border-zinc-900 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Product flow</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                The app is designed around one account and one portfolio. Users do not need to understand backend indexing to follow their stake lifecycle.
              </p>
            </div>
            <div className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-900 dark:border-zinc-900">
              {featureRows.map(([title, body]) => (
                <div key={title} className="grid gap-2 py-4 sm:grid-cols-[120px_1fr]">
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{body}</div>
                </div>
              ))}
            </div>
          </section>

          <section id="account" className="grid gap-8 border-b border-zinc-200 py-10 dark:border-zinc-900 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Account and sign-in</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Wallet connect and email smart-wallet sign-in both resolve into the same FanVibe account experience.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="border border-zinc-200 p-5 dark:border-zinc-900">
                <div className="text-sm font-semibold">Wallet users</div>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">Connect an EVM wallet on X Layer, approve stakes, and track records from the connected address.</p>
              </div>
              <div className="border border-zinc-200 p-5 dark:border-zinc-900">
                <div className="text-sm font-semibold">Email users</div>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">Sign in by email through Privy smart wallets and use the same portfolio flow without a browser wallet dependency.</p>
              </div>
            </div>
          </section>

          <section id="markets" className="grid gap-8 border-b border-zinc-200 py-10 dark:border-zinc-900 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Markets</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                FanVibe supports fixture markets and champion markets. USD value is shown alongside OKB where it helps users understand stake size and account value.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="border border-zinc-200 p-5 dark:border-zinc-900">
                <div className="text-sm font-semibold">Fixture markets</div>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">Home, draw, and away outcomes for live or upcoming simulated fixtures.</p>
              </div>
              <div className="border border-zinc-200 p-5 dark:border-zinc-900">
                <div className="text-sm font-semibold">Champion markets</div>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">Outright season picks that remain visible through resolution in the account portfolio.</p>
              </div>
            </div>
          </section>

          <section id="portfolio" className="grid gap-8 border-b border-zinc-200 py-10 dark:border-zinc-900 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Portfolio ledger</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Portfolio is the permanent account view for active stakes, settled positions, refunds, payouts, wallet balance, and profile identity.
              </p>
            </div>
            <div className="border-y border-zinc-200 py-4 text-sm dark:border-zinc-900">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>Active and settled positions</div>
                <div className="text-zinc-500">Season tags and market status stay visible.</div>
                <div>Payout and refund records</div>
                <div className="text-zinc-500">Explorer links are shown when transaction records exist.</div>
                <div>Total account value</div>
                <div className="text-zinc-500">Wallet balance and unresolved market value are surfaced together.</div>
              </div>
            </div>
          </section>

          <section id="x-layer" className="grid gap-8 border-b border-zinc-200 py-10 dark:border-zinc-900 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">X Layer proof layer</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                FanVibe uses X Layer for low-friction account activity, OKB payments, and public settlement records.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="border border-zinc-200 p-4 dark:border-zinc-900">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Stakes</div>
                <div className="mt-2 text-sm font-semibold">Indexed from X Layer transactions</div>
              </div>
              <div className="border border-zinc-200 p-4 dark:border-zinc-900">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Settlement</div>
                <div className="mt-2 text-sm font-semibold">Payouts and refunds link to explorer records</div>
              </div>
              <div className="border border-zinc-200 p-4 dark:border-zinc-900">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Liquidity</div>
                <div className="mt-2 text-sm font-semibold">Match phase data powers a v4 fee proof</div>
              </div>
            </div>
          </section>

          <section id="v4-hook" className="grid gap-8 border-b border-zinc-200 py-10 dark:border-zinc-900 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Uniswap v4 hook module</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                The v4 module is isolated from user staking. It connects FanVibe match phases to a WOKB/USDT dynamic-fee pool, showing how consumer activity can become a DeFi signal.
              </p>
              <div className="mt-5 grid gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <div>Open markets: 0.05%</div>
                <div>Live match phase: 0.30%</div>
                <div>Settled phase: 0.10%</div>
              </div>
            </div>
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Verified records</div>
              <div className="border-y border-zinc-200 dark:border-zinc-900">
                {proofRows.map(([label, value, href]) => (
                  <DetailLink key={label} label={label} value={value} href={href} />
                ))}
              </div>
              <div className="mt-4 truncate border border-zinc-200 px-3 py-2 font-mono text-[11px] text-zinc-500 dark:border-zinc-900">
                Pool {poolId}
              </div>
            </div>
          </section>

          <section id="safety" className="grid gap-8 py-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Safety model</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                FanVibe keeps wallet prompts explicit and uses public records for verification. The v4 hook is a separate liquidity module and does not custody prediction-market stakes.
              </p>
            </div>
            <div className="divide-y divide-zinc-200 border-y border-zinc-200 text-sm dark:divide-zinc-900 dark:border-zinc-900">
              <div className="grid gap-2 py-4 sm:grid-cols-[160px_1fr]">
                <div className="font-semibold">User funds</div>
                <div className="text-zinc-600 dark:text-zinc-400">Users confirm transactions from their own connected wallet or smart wallet.</div>
              </div>
              <div className="grid gap-2 py-4 sm:grid-cols-[160px_1fr]">
                <div className="font-semibold">Private keys</div>
                <div className="text-zinc-600 dark:text-zinc-400">Deployment and service keys are environment-only and are not committed to the repository.</div>
              </div>
              <div className="grid gap-2 py-4 sm:grid-cols-[160px_1fr]">
                <div className="font-semibold">Verification</div>
                <div className="text-zinc-600 dark:text-zinc-400">The README, GitHub docs, app proof panel, and this page expose the same public addresses and proof transactions.</div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
