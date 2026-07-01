# FanVibe Integration Proof

FanVibe is a consumer prediction market built on OKX X Layer. Fans sign in with wallet or email smart wallet, stake OKB on real World Cup outcomes, trade FVB through OKX Wallet, connect X for Distribution Cup scoring, follow live World Cup coverage and news, and review every position, payout, refund, and transaction from one portfolio.

## X Layer Consumer App

- Users stake OKB on match and champion markets.
- Distribution Cup scores qualified wallets through verified FVB trading volume, connected X activity, referrals, FanVibe stakes, and wins.
- Portfolio history stays tied to the connected account.
- Completed fixture and champion markets are processed by the autonomous referee service.
- Payouts and refunds are explorer-linked for public review.
- The referee wallet handles completed-market payouts and refunds through persisted settlement jobs.

## Autonomous Settlement And O2 Gas Insurance

FanVibe's referee service keeps market settlement independent of the browser session. When a market resolves, the service records the outcome, builds a payout or refund job, sends OKB from the referee wallet, stores the transaction hash, and resumes incomplete jobs after backend restart.

The same service includes an O2-style metabolism loop for gas insurance. It checks the referee wallet's OKB gas position every 60 seconds. If gas capacity falls below threshold, it checks USDT reserve value and attempts to rebalance reserves toward gas capacity, using OKX DEX Aggregator first and a PancakeSwap V3 WOKB reserve route as fallback. A cost guard prevents uneconomic refuels, and this loop remains separate from user stake accounting.

## Uniswap v4 Hook Proof

FanVibe also includes an experimental Uniswap v4 module for WOKB/USDT liquidity on X Layer. It does not custody prediction stakes and does not affect consumer payouts.

The module plugs the consumer app into DeFi by turning FanVibe match phases into liquidity-fee signals:

- Open markets: `0.05%`
- Live match phase: `0.30%`
- Settled phase: `0.10%`

This creates a clear consumer-to-DeFi path: football users create market activity, X Layer records that activity, and the v4 hook proves that app state can influence liquidity behavior in a WOKB/USDT pool.

The result is one X Layer product with two connected layers: a consumer prediction market with autonomous settlement, and an experimental DeFi module where match phase state becomes swap-time fee behavior.

- Hook: `0x4B6612ca209f07db44f8A651E4217A75106C4080`
- Proof router: `0x1e950c0b870b974dF997D61C3dF0A6701C489720`
- Pool: WOKB/USDT dynamic-fee v4 pool
- Pool id: `0x04a73ca9283b864136f6e14dc41de8dd1defad19b353242a9fc100d4b46fa15b`
- Hook deploy tx: `0xeff4a1213e9324508461375f49889aa1e3c49dd25c9cdfd2040cae18771080c8`
- Pool init tx: `0x1ad16c9894db8ad8b1a1e29c9f7425170dc20188f81eb20b0ad77f32f4d95306`
- Pool approval tx: `0xf0b842fa937598ff7b8babd6585a6946020339e6ef3a2119e32f273928d58237`
- Liquidity proof tx: `0x25a163de30aa698bc15bf6760bfc654f81b75dc8c604d2b8e3e7f8d586f24063`
- Swap proof tx: `0xe38fd0daf3e879270ecff754f5cbf4668715825b0ed11926f873cacd50ad9c3c`
- Phase reset tx: `0xa997a130a0f1c5366b5fa26727aff891f767a5d5a24269f778ea642a994d9494`

The swap proof emitted `MatchdayFeeApplied` on X Layer with:

- Pool id: `0x04a73ca9283b864136f6e14dc41de8dd1defad19b353242a9fc100d4b46fa15b`
- Phase: `Live`
- Fee: `3000` / `0.30%`

After the proof swap, the hook was reset to `MatchOpen` with `currentFee` back to `500` / `0.05%`.

## Why It Matters

The consumer app demonstrates X Layer as a fast OKB staking and settlement rail. The v4 hook module demonstrates how FanVibe match state can also drive liquidity behavior in a real X Layer WOKB/USDT pool.
