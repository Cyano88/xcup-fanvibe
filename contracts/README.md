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

## Sources Checked

- Uniswap v4 deployment list: https://docs.uniswap.org/contracts/v4/deployments
- Uniswap v4 hooks guide: https://docs.uniswap.org/contracts/v4/guides/hooks/your-first-hook
- X Layer RPC on-chain verification for WOKB and USDT token metadata.
