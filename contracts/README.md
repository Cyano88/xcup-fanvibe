# FanVibe Matchday Liquidity Hook

Highly experimental Uniswap v4 module for the OKX X Layer Uniswap track.

FanVibe's core app remains the OKB prediction market. This contract is an isolated proof module that demonstrates match-aware liquidity behavior on X Layer through a Uniswap v4 hook.

## Verified X Layer Mainnet Constants

- Chain ID: `196`
- PoolManager: `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32`
- CREATE2 deployer: `0x4e59b44847b379578588920cA78FbF26c0B4956C`
- WOKB: `0xe538905cf8410324E03A5A23C1c177a474D59b2b`
- USDT: `0x1E4a5963AbFd975d8c9021ce480b42188849D41d`

WOKB and USDT were verified against X Layer RPC by reading `name`, `symbol`, and `decimals`.

## Hook Behavior

`FanVibeMatchdayHook` is intended for a dynamic-fee WOKB/USDT v4 pool.

- `Preseason` / `MatchOpen`: 0.05% LP fee
- `Live`: 0.30% LP fee
- `Settled`: 0.10% LP fee

Every swap through an approved pool emits `MatchdayFeeApplied`, which gives the demo an explorer-visible proof that FanVibe match state can affect pool behavior.

## Safety Boundary

This hook does not custody prediction stakes, does not settle markets, and is not required for payouts or refunds.

It is experimental liquidity infrastructure for judging/demo purposes only.

## Deployment Flow

Compile:

```bash
npm run hook:compile
```

Deploy the hook contract with a dedicated funded deployer:

```bash
HOOK_DEPLOYER_PRIVATE_KEY=0x... npm run hook:deploy
```

The deploy script mines a CREATE2 salt so the deployed hook address has the required Uniswap v4 permission bits for `beforeSwap` only: `0x0080`.

After deployment, initialize a dynamic-fee v4 WOKB/USDT pool using:

- `currency0` / `currency1`: WOKB and USDT sorted by address
- `fee`: `0x800000` (`LPFeeLibrary.DYNAMIC_FEE_FLAG`)
- `tickSpacing`: `10`
- `hooks`: deployed `FanVibeMatchdayHook`

Then call `approvePool(poolKey, true)` on the hook before routing swaps through the pool.

This repo includes a helper that initializes the deployed hook pool and approves it:

```bash
HOOK_DEPLOYER_PRIVATE_KEY=0x... npm run hook:init-pool
```

By default it initializes WOKB/USDT at `88` USDT per WOKB. Override this only if you want a different demo start price:

```bash
HOOK_INITIAL_OKB_USDT_PRICE=88 HOOK_DEPLOYER_PRIVATE_KEY=0x... npm run hook:init-pool
```

The script writes `poolId`, pool currencies, initialization tx, and approval tx back into `contracts/deployments/xlayer.json`.

## Current X Layer Deployment

- Hook tx: `0xeff4a1213e9324508461375f49889aa1e3c49dd25c9cdfd2040cae18771080c8`
- Hook address: `0x4B6612ca209f07db44f8A651E4217A75106C4080`
- Deployer / owner: `0x3183d8AE90a802F6D0EB7Ec8a4801b68eddcc26d`
- Permission bits: `beforeSwap`
- Target pool: WOKB/USDT dynamic fee, tick spacing `10`
- Pool id: `0x04a73ca9283b864136f6e14dc41de8dd1defad19b353242a9fc100d4b46fa15b`
- Pool init tx: `0x1ad16c9894db8ad8b1a1e29c9f7425170dc20188f81eb20b0ad77f32f4d95306`
- Hook pool approval tx: `0xf0b842fa937598ff7b8babd6585a6946020339e6ef3a2119e32f273928d58237`
- Proof router: `0x1e950c0b870b974dF997D61C3dF0A6701C489720`
- Proof router deploy tx: `0x6bac174d5fc62d04024235afe6dcbf34ec4146d29c033ebae1008e33d24cc213`
- Liquidity proof tx: `0x25a163de30aa698bc15bf6760bfc654f81b75dc8c604d2b8e3e7f8d586f24063`
- Live phase tx: `0xcc493f2eff233e26f338913e0a2b306cf93eb0769c8f040598d15aaa5301cf0f`
- Swap proof tx: `0xe38fd0daf3e879270ecff754f5cbf4668715825b0ed11926f873cacd50ad9c3c`
- Post-demo open phase tx: `0xa997a130a0f1c5366b5fa26727aff891f767a5d5a24269f778ea642a994d9494`
- Verified hook state after swap proof: `approvedPool(poolId) == true`, `phase == Live`, `currentFee == 3000`
- Current hook state after post-demo reset: `phase == MatchOpen`, `currentFee == 500`
- Verified event: `MatchdayFeeApplied(poolId, 0x1e950c0b870b974dF997D61C3dF0A6701C489720, Live, 3000)`

## Judge Demo Proof

The Uniswap v4 track proof is intentionally minimal:

- FanVibe deployed a real v4 hook on X Layer mainnet.
- A real dynamic-fee WOKB/USDT pool was initialized through the canonical X Layer PoolManager.
- The hook approves only that pool and returns a fee override from `beforeSwap`.
- A proof router added liquidity and executed a real swap through the approved pool.
- The swap emitted `MatchdayFeeApplied` on-chain with the live-match fee.
- Match phases map to fee behavior: preseason/open `0.05%`, live `0.30%`, settled `0.10%`.
- The hook is separate from the consumer prediction market, so staking and payouts remain unaffected by this experimental liquidity module.

## Liquidity And Swap Proof

The pool is initialized and approved, but a visible swap-time proof requires two more mainnet actions:

1. Add a small amount of WOKB/USDT liquidity.
2. Run one tiny swap through the approved v4 pool so `MatchdayFeeApplied` is emitted by the hook.

This repo includes an isolated proof router for those actions. It is not used by the FanVibe consumer staking flow.

Deploy the proof router:

```bash
npm run hook:compile
HOOK_DEPLOYER_PRIVATE_KEY=0x... npm run hook:deploy-router
```

Add liquidity after the proof wallet holds both WOKB and USDT:

```bash
HOOK_DEPLOYER_PRIVATE_KEY=0x... HOOK_PROOF_MODE=liquidity HOOK_LIQUIDITY_DELTA=1000000 npm run hook:proof
```

Run the swap proof:

```bash
HOOK_DEPLOYER_PRIVATE_KEY=0x... HOOK_PROOF_MODE=swap HOOK_SWAP_TOKEN=wokb HOOK_SWAP_AMOUNT=0.000001 npm run hook:proof
```

The swap script first sets the hook phase to `Live`, then swaps through the pool. The target proof is:

- `MatchPhaseUpdated(... Live, "fanvibe-v4-proof")`
- `MatchdayFeeApplied(poolId, sender, Live, 3000)`

The deployment artifact records the liquidity tx, swap tx, phase tx, and decoded `MatchdayFeeApplied` event after successful execution.

## Match Phase Updates

The hook owner can update the current phase without touching staking or settlement:

```bash
HOOK_DEPLOYER_PRIVATE_KEY=0x... HOOK_PHASE=live HOOK_FIXTURE_ID=s01-md1-demo npm run hook:set-phase
```

Supported phases:

- `preseason`: `0.05%`
- `open`: `0.05%`
- `live`: `0.30%`
- `settled`: `0.10%`

## Sources Checked

- Uniswap v4 deployment list: https://docs.uniswap.org/contracts/v4/deployments
- Uniswap v4 hooks guide: https://docs.uniswap.org/contracts/v4/guides/hooks/your-first-hook
- X Layer RPC on-chain verification for WOKB and USDT token metadata.
