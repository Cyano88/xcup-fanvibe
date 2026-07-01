# OKX World Cup x Hooks Progress

This note tracks FanVibe against the current World Cup x Hooks campaign plan based on the rules shared in the working session.

## Current Position

FanVibe now has a coherent campaign surface:

- FVB launched on X Layer through eulr.
- FVB graduated and migrated to Uniswap v4 liquidity on X Layer.
- FanVibe app is centered on real World Cup fixtures, not simulated seasons.
- Sportmonks is the production source of truth for fixture IDs, teams, kickoff times, live states, scores, and provider events.
- Local World Cup fixture arrays are empty by design so stale `wc-*` fixtures cannot become public markets.
- Portfolio supports OKB balance, FVB balance, total value, and an OKX Wallet-only FVB trading handoff.
- Distribution Cup leaderboard is separated from the general account view and uses verified FVB trading, connected X activity, referrals, real World Cup stakes, and wins.
- X OAuth scoring is wired through the backend so connected wallets can add relevant daily X activity to their Distribution Cup score.
- Country backing is derived from real World Cup home/away stakes.
- The existing FanVibe v4 hook proof module remains a technical credibility artifact.

## Top-Three Readiness

Current practical readiness: about 75-80% technical, 45-55% campaign/volume.

The product is much stronger than a simple token launch because it has a real consumer surface, live sports data, account history, staking, portfolio, news, and a hook proof story. The missing piece is no longer graduation; it is sustained qualifying post-graduation volume through the required OKX Wallet Uniswap v4 path.

| Area | Status | Score |
| --- | --- | --- |
| World Cup theme | Strong: real fixtures, Distribution Cup campaign, country backing | 8/10 |
| Product UX | Strong base, needs final mobile QA and match-card polish | 7/10 |
| Real data integrity | Strong after Sportmonks-only cleanup | 8/10 |
| Hook/code quality | Credible proof module plus eulr launchpad/migration route | 7/10 |
| On-chain interactions | Improving: needs more real stakes, holders, and OKX Wallet post-grad trades | 6/10 |
| Campaign distribution | Improving: X OAuth scoring is live, but still needs daily cadence and community loops | 4/10 |
| Submission readiness | Needs final tx list, X account package, and form submission | 5/10 |

## Remaining Critical Work

1. Drive qualifying OKX Wallet trading volume after migration.
2. Generate real user activity: FVB traders, connected X accounts, qualified referrals, OKB match stakes, country backing, and Distribution Cup leaderboard movement.
3. Keep every trade CTA pointed to OKX Wallet on X Layer, with users confirming the Uniswap v4 route.
4. Add hook phase sync or a clear proof flow that connects live match state to hook events.
5. Prepare the submission package: token, launchpad page, migration tx, hook proof, app URL, docs URL, GitHub URL, X account URL, and the X post tagging `@XLayerOfficial`.
6. Run daily public campaign posts until July 12, 2026, focused on match windows, country backing, leaderboard changes, and explorer proof.

## Public Campaign Rule

The app should sell the consumer story, not the hackathon mechanics:

- Stake OKB on real World Cup matches.
- Connect X with the same wallet.
- Win, stay active, refer qualified fans, and climb Distribution Cup.
- After graduation, trade FVB through the official OKX Wallet Uniswap v4 path.
