# FanVibe

FanVibe is a consumer prediction market on OKX X Layer. Fans sign in with a wallet or email smart wallet, stake OKB on simulated football markets, follow upcoming and live World Cup match coverage, read football and OKX/X Layer news, and review every position, payout, refund, and proof link from one account.

This repository is a monorepo. It contains the production app, backend referee service, dashboard, public documentation, and an experimental Uniswap v4 hook module that connects FanVibe consumer activity on X Layer to DeFi liquidity behavior.

## Monorepo Map

| Area | Path | Purpose |
| --- | --- | --- |
| Backend service | `src/` | X Layer indexing, stake reports, settlement, season state, comments, news, and API routes |
| Dashboard | `dashboard/` | React/Vite consumer app at `fanvibe.xyz` |
| Uniswap v4 hook | `contracts/` | Experimental WOKB/USDT dynamic-fee hook and deployment artifacts |
| Proof scripts | `scripts/` | Hook deployment, pool initialization, liquidity proof, swap proof, and phase updates |
| Public docs | `docs/` | Platform documentation, audit notes, and integration references |

## What FanVibe Does

- Wallet and email sign-in through Privy smart wallets.
- OKB staking on match markets and champion markets.
- Live simulated football seasons with group play, knockouts, and champions.
- Upcoming and live World Cup match coverage alongside FanVibe markets.
- World Cup news and OKX/X Layer news in the News tab.
- Portfolio tracking for active positions, settled results, payouts, refunds, wallet balance, and total account value.
- Autonomous settlement for completed fixture and champion markets.
- O2-style gas insurance for the referee wallet, with reserve rebalancing when gas capacity drops below threshold.
- Explorer-linked stake, payout, refund, and proof transactions.
- A public `Why X Layer` proof panel inside the app.
- A dedicated `/docs` page for users, builders, and reviewers.
- An experimental Uniswap v4 hook that connects FanVibe match phases to WOKB/USDT liquidity fees.

## Live Links

- App: https://fanvibe.xyz
- Docs: https://fanvibe.xyz/docs
- GitHub docs: [`docs/platform.md`](docs/platform.md)
- Hook docs: [`contracts/README.md`](contracts/README.md)
- Audit notes: [`docs/audit.md`](docs/audit.md)

## X Layer App Flow

1. A user signs in with wallet or email.
2. The user picks a fixture or champion market.
3. The user stakes OKB from the connected account.
4. The backend indexes the transaction and ties it to the account.
5. Completed markets are processed by the autonomous referee service.
6. The portfolio keeps a permanent account-level history with explorer links.
7. The News tab keeps users current with World Cup, OKX, and X Layer updates.

## Autonomous Settlement And Gas Insurance

FanVibe uses a backend referee service to keep settlement independent of the user session. When a fixture or champion market resolves, the referee records the outcome, creates a persisted payout or refund job, sends OKB from the referee wallet, stores the transaction record, and resumes incomplete jobs after a restart.

The referee also runs an O2-style metabolism loop as fallback gas insurance. Every 60 seconds it checks the referee wallet's OKB gas position. If the balance falls below the configured threshold, the service checks USDT reserve value and attempts to rebalance toward gas capacity. The route tries OKX DEX Aggregator first and keeps a PancakeSwap V3 WOKB reserve route as fallback. A profitability guard blocks uneconomic refuels, and the loop stays separate from user stake accounting.

## Public Use Guide

1. Open `https://fanvibe.xyz`.
2. Connect a wallet or sign in with email.
3. Pick a fixture market or champion market.
4. Enter a small OKB amount while testing.
5. Confirm the wallet prompt.
6. Open Portfolio to track active positions, settlement status, payouts, refunds, and explorer links.
7. Open News to follow World Cup coverage and OKX/X Layer updates.

## Uniswap v4 Hook Proof

FanVibe includes an experimental DeFi module that is deliberately separate from staking and payouts. It shows how a consumer app on X Layer can plug into DeFi: FanVibe match phases become transparent inputs for a Uniswap v4 dynamic-fee hook, and that hook applies phase-aware fees to a WOKB/USDT pool.

Benefits:

- Consumer activity becomes a DeFi signal without changing the user-facing staking flow.
- X Layer gets both retail app activity and liquidity-pool proof activity from the same product.
- WOKB/USDT liquidity can respond to market phases: open, live, and settled.
- Prediction-market funds remain separate from the experimental liquidity module.
- Autonomous settlement and O2-style gas insurance keep the consumer app operational while the v4 hook shows how app state can become DeFi infrastructure.

| Item | Value |
| --- | --- |
| Hook | `0x4B6612ca209f07db44f8A651E4217A75106C4080` |
| Proof router | `0x1e950c0b870b974dF997D61C3dF0A6701C489720` |
| Pool | WOKB/USDT dynamic-fee v4 pool |
| Pool id | `0x04a73ca9283b864136f6e14dc41de8dd1defad19b353242a9fc100d4b46fa15b` |
| Liquidity proof tx | `0x25a163de30aa698bc15bf6760bfc654f81b75dc8c604d2b8e3e7f8d586f24063` |
| Swap proof tx | `0xe38fd0daf3e879270ecff754f5cbf4668715825b0ed11926f873cacd50ad9c3c` |
| Phase reset tx | `0xa997a130a0f1c5366b5fa26727aff891f767a5d5a24269f778ea642a994d9494` |

The swap proof emitted `MatchdayFeeApplied` with the FanVibe pool id, `Live` phase, and `3000` fee. After the proof, the hook was reset to `MatchOpen` with `500` fee.

## Run Locally

Install backend dependencies:

```bash
npm install
```

Run the backend:

```bash
npm run dev
```

Install and run the dashboard:

```bash
cd dashboard
npm install
npm run dev
```

Open `http://localhost:5173`.

## Environment

Backend:

| Variable | Purpose |
| --- | --- |
| `X_LAYER_MAINNET_RPC` | X Layer RPC URL |
| `REFEREE_PRIVATE_KEY` | Referee wallet signer for payouts and refunds |
| `ADMIN_ADDRESS` | Settlement signer address |
| `ADMIN_TEST_SECRET` | Admin-only season reset secret |
| `NEWS_API_KEY` | Optional news feed key |
| `PORT` | Backend port, defaults to `3001` |

Dashboard:

| Variable | Purpose |
| --- | --- |
| `VITE_BACKEND_HTTP` | Backend HTTP endpoint |
| `VITE_BACKEND_WS` | Backend WebSocket endpoint |
| `VITE_REFEREE_ADDRESS` | Public payout/referee account |
| `VITE_PRIVY_APP_ID` | Privy app id |

Hook scripts:

| Variable | Purpose |
| --- | --- |
| `HOOK_DEPLOYER_PRIVATE_KEY` | Dedicated hook/proof signer |
| `HOOK_PHASE` | `preseason`, `open`, `live`, or `settled` |
| `HOOK_PROOF_MODE` | `liquidity` or `swap` |

## Verification

```bash
npm run build
cd dashboard
npm run build
```

Recent audit status is tracked in [`docs/audit.md`](docs/audit.md). Backend audit is clean. Dashboard has moderate transitive wallet-stack advisories where the available npm fix is a breaking forced dependency change; this is documented and intentionally not applied without a full wallet regression pass.

## Safety Notes

- Do not commit `.env`, `.env.local`, private keys, or wallet secrets.
- Use small OKB amounts while testing.
- The Uniswap v4 hook is experimental and isolated from user staking and settlement.
- Public proof records are available from the app’s `Why X Layer` panel and the docs page.
