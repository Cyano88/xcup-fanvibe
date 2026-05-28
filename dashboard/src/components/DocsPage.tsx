import { ArrowLeft, ExternalLink } from 'lucide-react';

const explorerTx = (tx: string) => `https://www.okx.com/web3/explorer/xlayer/tx/${tx}`;
const explorerAddr = (addr: string) => `https://www.okx.com/web3/explorer/xlayer/address/${addr}`;

const hookAddress = '0x4B6612ca209f07db44f8A651E4217A75106C4080';
const proofRouter = '0x1e950c0b870b974dF997D61C3dF0A6701C489720';
const poolId = '0x04a73ca9283b864136f6e14dc41de8dd1defad19b353242a9fc100d4b46fa15b';
const swapProofTx = '0xe38fd0daf3e879270ecff754f5cbf4668715825b0ed11926f873cacd50ad9c3c';
const liquidityTx = '0x25a163de30aa698bc15bf6760bfc654f81b75dc8c604d2b8e3e7f8d586f24063';
const phaseResetTx = '0xa997a130a0f1c5366b5fa26727aff891f767a5d5a24269f778ea642a994d9494';

const features = [
  ['Wallet or email sign-in', 'Users can connect a normal wallet or sign in with email through Privy smart wallets. Both paths resolve to one FanVibe account.'],
  ['OKB prediction markets', 'Fans stake OKB on match outcomes and champion markets on X Layer Mainnet.'],
  ['Live season simulation', 'World Cup seasons run continuously with group stages, knockouts, champions, and settlement history.'],
  ['Portfolio ledger', 'Positions, active stakes, payouts, refunds, wallet balance, and account value stay tied to the connected account.'],
  ['Explorer-linked settlement', 'Stake, payout, refund, and proof transactions are linked to public X Layer records.'],
  ['Uniswap v4 hook proof', 'An isolated WOKB/USDT v4 hook changes LP fees by FanVibe match phase, connecting the consumer app to DeFi liquidity.'],
];

const steps = [
  ['1', 'Sign in', 'Connect a wallet or use email sign-in. FanVibe creates one account identity for portfolio tracking.'],
  ['2', 'Pick a market', 'Choose a live fixture, upcoming fixture, or champion market.'],
  ['3', 'Stake OKB', 'Confirm the transaction from the connected wallet. The platform indexes the transaction and links it to your account.'],
  ['4', 'Track settlement', 'Open Portfolio to review active positions, settled outcomes, payouts, refunds, and explorer links.'],
];

const proofLinks = [
  ['Hook', hookAddress, explorerAddr(hookAddress)],
  ['Proof router', proofRouter, explorerAddr(proofRouter)],
  ['Liquidity proof', liquidityTx, explorerTx(liquidityTx)],
  ['Swap proof', swapProofTx, explorerTx(swapProofTx)],
  ['Post-demo reset', phaseResetTx, explorerTx(phaseResetTx)],
];

function short(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function DocsPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-900 dark:bg-black/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700 transition-colors hover:text-blue-600 dark:text-zinc-300 dark:hover:text-blue-300">
            <ArrowLeft size={16} />
            FanVibe
          </a>
          <a href="https://github.com/Cyano88/xcup-fanvibe" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-500 transition-colors hover:text-zinc-950 dark:text-zinc-500 dark:hover:text-zinc-100">
            GitHub
            <ExternalLink size={13} />
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <section className="border-b border-zinc-200 pb-10 dark:border-zinc-900">
          <div className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-400">X Layer consumer app plus v4 hook proof</div>
          <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-zinc-950 dark:text-white sm:text-6xl">
            FanVibe turns live football prediction markets into auditable X Layer activity.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            FanVibe is a consumer prediction market where fans sign in, stake OKB, follow simulated World Cup seasons, and review every position from one portfolio. The repo also includes an isolated Uniswap v4 hook module that connects match phase data to WOKB/USDT liquidity behavior.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="/" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500">Open app</a>
            <a href={explorerTx(swapProofTx)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-blue-500 dark:hover:text-blue-300">
              View v4 proof
              <ExternalLink size={14} />
            </a>
          </div>
        </section>

        <section className="grid gap-3 py-10 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(([title, body]) => (
            <div key={title} className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-900 dark:bg-zinc-950">
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{body}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-8 border-t border-zinc-200 py-10 dark:border-zinc-900 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">How to use FanVibe</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">One account, every position.</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              The product is designed for public testing: sign in, stake, watch, and verify. All high-value actions create X Layer records.
            </p>
          </div>
          <div className="space-y-3">
            {steps.map(([number, title, body]) => (
              <div key={number} className="grid grid-cols-[40px_1fr] gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-900 dark:bg-zinc-950">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-sm font-bold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{number}</div>
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-8 border-t border-zinc-200 py-10 dark:border-zinc-900 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Uniswap v4 hook</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">A monorepo DeFi module for match-aware liquidity.</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              The v4 hook is separate from staking and payouts. It proves FanVibe match phases can influence a real WOKB/USDT dynamic-fee pool on X Layer.
            </p>
            <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-900 dark:bg-zinc-950">
              <div className="font-semibold">Fee behavior</div>
              <div className="mt-2 grid gap-2 text-zinc-600 dark:text-zinc-400">
                <div>Open markets: 0.05%</div>
                <div>Live match phase: 0.30%</div>
                <div>Settled phase: 0.10%</div>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-900 dark:bg-zinc-950">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Verified X Layer records</div>
            <div className="space-y-2">
              {proofLinks.map(([label, value, href]) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-4 rounded-md border border-zinc-100 px-3 py-2 text-sm transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-zinc-900 dark:hover:border-blue-500 dark:hover:text-blue-300">
                  <span className="font-semibold">{label}</span>
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-zinc-500">
                    <span className="truncate font-mono text-xs">{short(value)}</span>
                    <ExternalLink size={13} />
                  </span>
                </a>
              ))}
            </div>
            <div className="mt-4 truncate rounded-md bg-zinc-50 px-3 py-2 font-mono text-[11px] text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-500">
              Pool {poolId}
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-200 py-10 dark:border-zinc-900">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">For users</div>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">Use the app with a small amount of OKB, review wallet prompts, and verify transactions from Portfolio.</p>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">For judges</div>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">Open Portfolio, expand Why X Layer, and follow the stake, payout, and v4 hook proof links.</p>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">For builders</div>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">The repo is a monorepo: backend, dashboard, contracts, scripts, deployment artifacts, and public docs live together.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
