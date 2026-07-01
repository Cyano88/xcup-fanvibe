# FanVibe Platform Documentation

FanVibe is a public-facing prediction market and X Layer proof app. It combines a consumer sports experience, World Cup coverage, verifiable on-chain activity, and an experimental Uniswap v4 hook module that connects app activity to DeFi liquidity behavior.

## Product Overview

FanVibe lets users:

- Sign in with a wallet or email smart wallet.
- Stake OKB on match outcomes.
- Stake OKB on champion markets.
- Follow Sportmonks-backed World Cup fixtures across live, upcoming, and finished states.
- Enter the Distribution Cup by trading FVB through OKX Wallet, connecting X, and keeping FanVibe match activity on the same wallet.
- Track every position in one portfolio.
- Review payouts, refunds, wallet balance, and total account value.
- Invite users through account-based referral links with backend-qualified rewards.
- Rely on autonomous settlement for completed fixture and champion markets.
- Use an O2-style gas insurance loop that helps keep the referee wallet payout-ready.
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
3. Choose a real World Cup fixture market.
4. Enter an OKB amount.
5. Confirm the wallet transaction.
6. Watch the match progress through the live center.
7. Open Portfolio to review position status, account value, payouts, refunds, and proof links.
8. Open News to follow World Cup, OKX, and X Layer updates.

## Account And Wallets

FanVibe treats wallet sign-in and email smart-wallet sign-in as one account path. Users can connect with:

- A normal EVM wallet.
- Privy email sign-in with an embedded smart wallet.

The app keeps account identity simple: if a profile name is set, it is used in the match chat; otherwise the short wallet address is used.

## Prediction Markets

FanVibe supports two market types:

- Fixture markets: home, draw, away.
- Distribution Cup leaderboard: rank through verified FVB trading volume, X activity, referrals, real World Cup stakes, and wins.

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
- Invite rewards and reward payout proofs.

History remains tied to the connected account and is designed to stay visible rather than disappearing after settlement.

## Invite Rewards

FanVibe referrals are designed for real usage, not click farming. A connected user can copy an invite link from Portfolio. When a new wallet opens that link and later connects, the backend locks the first valid referrer for that wallet.

Rewards qualify only after the referred wallet places a valid stake of at least `0.001 OKB`.

| Rule | Value |
| --- | --- |
| Referrer reward | `0.0005 OKB` |
| Referred user bonus | `0.0002 OKB` |
| Qualification minimum | `0.001 OKB` first valid stake |
| Daily cap | 10 paid referrals per referrer |
| Reward-wallet cap | Configurable total OKB payout cap per UTC day |
| Repeat reward | Once per referred wallet |

Rewards mature in the next reward cycle, then become claimable in Portfolio. Payouts are sent from a separate reward wallet so referral growth payouts cannot interfere with market settlement, refunds, or referee gas operations. Paid rewards expose explorer links when payout transactions exist.

## Settlement

Completed markets resolve to:

- Payout sent.
- Refund sent.
- Lost.
- Active, if the market is still unresolved.

Settlements are linked to X Layer records when a payout or refund transaction exists.

FanVibe settlement is autonomous at the service level. The backend referee records completed fixture outcomes, creates persisted payout or refund jobs, signs OKB transfers from the referee wallet, stores transaction records, and resumes pending settlement jobs after restart. Champion markets are settled after the final and remain part of the same portfolio history.

## O2 Gas Insurance

FanVibe includes an O2-style metabolism loop inside the referee service. This is used as fallback gas insurance for payout and refund operations.

Verified behavior:

- The referee checks its OKB gas position every 60 seconds.
- If gas health drops below the configured threshold, the service checks USDT reserve value.
- The refuel path tries OKX DEX Aggregator first.
- A PancakeSwap V3 WOKB reserve route is available as fallback.
- A profitability guard prevents uneconomic refuels.
- The gas insurance loop is separate from user stake accounting and does not change portfolio balances.

This gives FanVibe an operational layer for gas rebalancing: user stakes remain visible as positions, while the payout account has a monitored fallback path for maintaining gas capacity.

## Live World Cup Coverage

FanVibe uses Sportmonks as the production source of truth for World Cup fixtures. Users can follow the football calendar, live scores, finished results, and match events while using FanVibe markets.

This gives the product three connected layers:

- Prediction markets: OKB stakes on real World Cup outcomes and account settlement.
- Distribution Cup: verified FVB trading, connected X activity, country support, and campaign leaderboards.
- World Cup coverage: provider-backed match context plus news that keeps users engaged between market actions.

## News

The News tab mixes World Cup news, football updates, and OKX/X Layer updates. It gives users a reason to keep checking the app even when they are not actively staking.

## Why X Layer

FanVibe uses X Layer because it needs:

- Fast account activity.
- Low-cost OKB staking.
- Explorer-linked settlement.
- Public proof for user trust.
- A path from consumer activity into DeFi liquidity signals.
- Automated payout operations with a gas-insurance loop.

## Implementation Coverage

| Area | FanVibe implementation |
| --- | --- |
| World Cup consumer surface | Sportmonks-backed live, upcoming, and finished World Cup fixtures plus football news |
| Prediction markets | OKB fixture markets, Distribution Cup leaderboard, portfolio history, wallet and email smart-wallet sign-in |
| X Layer proof | Stake indexing, payout/refund records, explorer links, public proof panel |
| Autonomous operations | Referee settlement jobs, restart recovery, champion settlement, refund queue |
| Gas resilience | O2-style metabolism loop, threshold monitoring, reserve rebalancing, OKX route plus fallback route |
| DeFi bridge | Experimental Uniswap v4 WOKB/USDT dynamic-fee hook driven by FanVibe match phases |

## Uniswap v4 Hook Module

The hook module is an experimental monorepo feature for WOKB/USDT liquidity on X Layer. It is not required for staking and does not custody user stakes.

The hook connects FanVibe match phases to a WOKB/USDT dynamic-fee v4 pool. This is the bridge from consumer app to DeFi: FanVibe creates consumer activity around football markets, X Layer records that activity, and the v4 hook converts match-state changes into fee behavior for liquidity.

| Phase | Fee |
| --- | --- |
| Preseason / open | `0.05%` |
| Live | `0.30%` |
| Settled | `0.10%` |

Benefits:

- Consumer activity becomes an on-chain DeFi signal.
- X Layer receives both prediction-market transactions and liquidity-pool proof activity.
- Liquidity fees can respond to match phases without touching user prediction stakes.
- The experimental module stays isolated from settlement and payouts.

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
- Open the Distribution Cup leaderboard and verify FVB trading, X connection status, and country backing.
- Open Portfolio and verify the position appears.
- Open News and review World Cup plus OKX/X Layer updates.
- Expand `Why X Layer` and open the v4 hook proof links.
- Open `https://fanvibe.xyz/docs`.

## Public Use Guide

1. Open `https://fanvibe.xyz`.
2. Connect a wallet or sign in with email.
3. Choose a real World Cup fixture market.
4. Enter a small OKB amount while testing.
5. Confirm the wallet prompt.
6. Use Portfolio to track positions, wallet balance, total account value, settlement status, and explorer links.
7. Use News to follow World Cup coverage and OKX/X Layer updates.

## Safety

- Use small amounts while testing.
- Do not share private keys or environment files.
- The v4 hook is experimental and isolated from consumer funds.
- The app exposes verifiable X Layer activity, account history, portfolio state, and hook proof records for public review.
