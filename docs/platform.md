# FanVibe Platform Documentation

FanVibe is a public-facing prediction market and X Layer proof app. It combines a consumer sports experience with verifiable on-chain activity and an isolated Uniswap v4 hook module.

## Product Overview

FanVibe lets users:

- Sign in with a wallet or email smart wallet.
- Stake OKB on match outcomes.
- Stake OKB on champion markets.
- Watch simulated football seasons progress through group stages and knockouts.
- Track every position in one portfolio.
- Review payouts, refunds, wallet balance, and total account value.
- Follow explorer links for stake, payout, refund, and proof transactions.
- Read World Cup and OKX/X Layer news from the News tab.
- Use the public `/docs` page for product and proof documentation.

## Monorepo Structure

| Path | Description |
| --- | --- |
| `src/` | Backend API, WebSocket service, indexing, season controller, settlement, news, comments |
| `dashboard/` | React/Vite app deployed to Vercel |
| `contracts/` | FanVibe Uniswap v4 hook, proof router, deployment artifacts |
| `scripts/` | Hook deployment, pool initialization, liquidity proof, swap proof, phase update scripts |
| `docs/` | Public documentation, audit notes, and integration references |

## User Flow

1. Open `fanvibe.xyz`.
2. Sign in with a wallet or email.
3. Choose a fixture market or champion market.
4. Enter an OKB amount.
5. Confirm the wallet transaction.
6. Watch the match or season progress.
7. Open Portfolio to review position status, account value, payouts, refunds, and proof links.

## Account And Wallets

FanVibe treats wallet sign-in and email smart-wallet sign-in as one account path. Users can connect with:

- A normal EVM wallet.
- Privy email sign-in with an embedded smart wallet.

The app keeps account identity simple: if a profile name is set, it is used in the match chat; otherwise the short wallet address is used.

## Prediction Markets

FanVibe supports two market types:

- Fixture markets: home, draw, away.
- Champion markets: pick a team to win the season.

Markets are denominated in OKB. USD value is shown where OKB balances or stake values appear so users can quickly understand position size.

## Portfolio

The Portfolio tab is the account ledger. It shows:

- Wallet balance.
- Total account value.
- Active positions.
- Settled positions.
- Refunds.
- Payouts.
- Season identifiers.
- Explorer links.
- Profile name controls.

History remains tied to the connected account and is designed to stay visible rather than disappearing after settlement.

## Settlement

Completed markets resolve to:

- Payout sent.
- Refund sent.
- Lost.
- Active, if the market is still unresolved.

Settlements are linked to X Layer records when a payout or refund transaction exists.

## Live Simulation

FanVibe seasons include:

- Group stages.
- Knockout qualification.
- Round of 32, Round of 16, quarter-finals, semi-finals, third-place playoff, and final.
- Live match viewer.
- Match comments.
- Goal and event animations.

The simulation is consumer-facing; it is separate from real FIFA results and is labeled as FanVibe season play inside the product.

## News

The News tab mixes football news with OKX/X Layer updates. OKX and X Layer news are included to show the ecosystem context without making the product feel like a pure crypto feed.

## Why X Layer

FanVibe uses X Layer because it needs:

- Fast account activity.
- Low-cost OKB staking.
- Explorer-linked settlement.
- Public proof for user trust.
- A path from consumer activity into DeFi liquidity signals.

## Uniswap v4 Hook Module

The hook module is an isolated monorepo feature for WOKB/USDT liquidity on X Layer. It is not required for staking and does not custody user stakes.

The hook connects FanVibe match phases to a WOKB/USDT dynamic-fee v4 pool:

| Phase | Fee |
| --- | --- |
| Preseason / open | `0.05%` |
| Live | `0.30%` |
| Settled | `0.10%` |

Verified records:

| Item | Value |
| --- | --- |
| Hook | `0x4B6612ca209f07db44f8A651E4217A75106C4080` |
| Proof router | `0x1e950c0b870b974dF997D61C3dF0A6701C489720` |
| Pool id | `0x04a73ca9283b864136f6e14dc41de8dd1defad19b353242a9fc100d4b46fa15b` |
| Liquidity proof tx | `0x25a163de30aa698bc15bf6760bfc654f81b75dc8c604d2b8e3e7f8d586f24063` |
| Swap proof tx | `0xe38fd0daf3e879270ecff754f5cbf4668715825b0ed11926f873cacd50ad9c3c` |
| Phase reset tx | `0xa997a130a0f1c5366b5fa26727aff891f767a5d5a24269f778ea642a994d9494` |

The swap proof emitted `MatchdayFeeApplied` on X Layer with the FanVibe pool id, `Live` phase, and `3000` fee. The hook was then reset to `MatchOpen` with `500` fee.

## Running The App

Backend:

```bash
npm install
npm run dev
```

Dashboard:

```bash
cd dashboard
npm install
npm run dev
```

Build checks:

```bash
npm run build
cd dashboard
npm run build
```

## Public Verification Checklist

- Open `https://fanvibe.xyz`.
- Sign in by wallet or email.
- Stake a small OKB amount on a fixture.
- Stake a small OKB amount on a champion market.
- Open Portfolio and verify the position appears.
- Expand `Why X Layer` and open the v4 hook proof links.
- Open `https://fanvibe.xyz/docs`.

## Safety

- Use small amounts while testing.
- Do not share private keys or environment files.
- The v4 hook is experimental and isolated from consumer funds.
- The app exposes verifiable X Layer activity, account history, portfolio state, and hook proof records for public review.
