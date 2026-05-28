# FanVibe Integration Proof

FanVibe is a consumer prediction market built on OKX X Layer. Fans sign in with wallet or email smart wallet, stake OKB on simulated football outcomes, and review every position, payout, refund, and transaction from one portfolio.

## X Layer Consumer App

- Users stake OKB on match and champion markets.
- Portfolio history stays tied to the connected account.
- Payouts and refunds are explorer-linked for public review.
- The referee wallet handles completed-market payouts and refunds.

## Uniswap v4 Hook Proof

FanVibe also includes an isolated Uniswap v4 module for WOKB/USDT liquidity on X Layer. It does not custody prediction stakes and does not affect consumer payouts.

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
