# FanVibe

FanVibe is a consumer prediction market on OKX X Layer. Fans sign in with a wallet or email smart wallet, stake OKB on simulated World Cup markets, follow live match play, and review every position, payout, refund, and proof link from one account.

This repository is a monorepo. It contains the production app, backend referee service, dashboard, public documentation, and an isolated Uniswap v4 hook module for the X Layer Uniswap track.

## Monorepo Map

| Area | Path | Purpose |
| --- | --- | --- |
| Backend service | `src/` | X Layer indexing, stake reports, settlement, season state, comments, news, and API routes |
| Dashboard | `dashboard/` | React/Vite consumer app at `fanvibe.xyz` |
| Uniswap v4 hook | `contracts/` | Experimental WOKB/USDT dynamic-fee hook and deployment artifacts |
| Proof scripts | `scripts/` | Hook deployment, pool initialization, liquidity proof, swap proof, and phase updates |
| Public docs | `docs/` | Submission notes, audit notes, and platform documentation |

## What FanVibe Does

- Wallet and email sign-in through Privy smart wallets.
- OKB staking on match markets and champion markets.
- Live simulated World Cup seasons with group play, knockouts, and champions.
- Portfolio tracking for active positions, settled results, payouts, refunds, wallet balance, and total account value.
- Explorer-linked stake, payout, refund, and proof transactions.
- A public `Why X Layer` proof panel inside the app.
- A dedicated `/docs` page for users, judges, and builders.
- An isolated Uniswap v4 hook that connects FanVibe match phases to WOKB/USDT liquidity fees.

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
5. Completed markets settle to payouts or refunds.
6. The portfolio keeps a permanent account-level history with explorer links.

## Uniswap v4 Hook Proof

FanVibe includes an experimental DeFi module that is deliberately separate from staking and payouts. It proves that a consumer app state can affect liquidity behavior on X Layer.

| Item | Value |
| --- | --- |
| Hook | `0x4B6612ca209f07db44f8A651E4217A75106C4080` |
| Proof router | `0x1e950c0b870b974dF997D61C3dF0A6701C489720` |
| Pool | WOKB/USDT dynamic-fee v4 pool |
| Pool id | `0x04a73ca9283b864136f6e14dc41de8dd1defad19b353242a9fc100d4b46fa15b` |
| Liquidity proof tx | `0x25a163de30aa698bc15bf6760bfc654f81b75dc8c604d2b8e3e7f8d586f24063` |
| Swap proof tx | `0xe38fd0daf3e879270ecff754f5cbf4668715825b0ed11926f873cacd50ad9c3c` |
| Post-demo reset tx | `0xa997a130a0f1c5366b5fa26727aff891f767a5d5a24269f778ea642a994d9494` |

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

Recent audit status is tracked in [`docs/audit.md`](docs/audit.md). Backend audit is clean. Dashboard has moderate transitive wallet-stack advisories where the available npm fix is a breaking forced downgrade; this is documented and intentionally not applied before demo day.

## Safety Notes

- Do not commit `.env`, `.env.local`, private keys, or wallet secrets.
- Use small OKB amounts for public testing.
- The Uniswap v4 hook is experimental and isolated from user staking and settlement.
- Judges can verify the hook proof from the app’s `Why X Layer` panel or the docs page.
