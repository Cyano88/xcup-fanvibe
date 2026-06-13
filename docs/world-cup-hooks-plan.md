# FanVibe World Cup x Hooks Plan

## Goal

Launch a World Cup-themed FanVibe token natively on X Layer, graduate it to Uniswap v4 liquidity, and drive qualifying OKX Wallet front-end trading volume before the July 12, 2026 23:59 UTC submission deadline.

## Recommended Route

Use the Hooks Launchpad route first.

Reason: the hackathon allows launch through a Hooks Launchpad on X Layer, and eulr is already live on X Layer with permissionless token issuance, a v4 hook-backed bonding curve, and a graduation path to Uniswap v4 liquidity.

Fallback: use the Uniswap official hook allowlist route only if launchpad migration or submission eligibility becomes unclear.

## Token

Working identity:

- Name: FanVibe World Cup
- Ticker: FVB
- Logo asset: `dashboard/public/assets/fanvibe-world-token-logo.png`
- Launchpad image: `dashboard/public/assets/fanvibe-world-token-logo-launchpad.jpg`
- Chain: X Layer Mainnet
- Token address: `0x35a676ca9347499f97819813a38ed14e6a7c5e3f`
- Token page: `https://www.eulr.fun/token/0x35a676Ca9347499f97819813a38ED14e6a7C5e3F?fresh=1`
- Launch EOA: `0x71f3...1b2a`
- Launch status: live on eulr
- Initial creator purchase: `0.3000 OKB` gross / `0.2991 OKB` net for about `249.74K FVB`
- Initial block: `62489676`
- Current phase: eulr launch curve. Launch-curve trades help graduation but do not count as final OKX Wallet Uniswap v4 leaderboard volume.
- Theme: every trade backs a nation, and live match phases change FanVibe's on-chain liquidity story.
- Description: World Cup fan token for FanVibe. Trades become on-chain fan signals, countries compete on a live support board, and matchday phases feed a Uniswap v4 hook on X Layer.

## Launch Requirements

- Use exactly one clean EOA for the participating token.
- Do not deploy multiple candidate tokens from related wallets.
- Launch token on X Layer.
- Keep contract, pool, hook, token, migration, and submission txs recorded.
- Create and actively use a dedicated X account.
- Tag `@XLayerOfficial` at submission.
- Submit the Google Form before July 12, 2026 23:59 UTC.

## Volume Requirements

Only post-graduation OKX Wallet front-end trades on Uniswap v4 count.

Implications:

- Bonding curve launchpad trades are useful for distribution, but they do not count toward ranking volume.
- Current campaign objective is graduation first, then OKX Wallet Uniswap v4 volume after migration.
- The main campaign must start after graduation/migration.
- Every app CTA and X post should send users to the OKX Wallet Uniswap v4 trading path.
- Avoid sybil/self-volume behavior. Top projects are anti-sybil reviewed.

## Hook Strategy

Current repo hook:

- `contracts/src/FanVibeMatchdayHook.sol`
- WOKB/USDT only
- owner-approved pool IDs only
- `beforeSwap` dynamic fee override
- phases: preseason/open `0.05%`, live `0.30%`, settled `0.10%`

Current FVB launch status:

- FVB is attached to eulr's launchpad v4 hook/curve mechanics, not the existing `FanVibeMatchdayHook`.
- This still satisfies the launchpad route requirement if the hackathon accepts eulr as the Hooks Launchpad path.
- The existing FanVibe WOKB/USDT hook remains a proof module and credibility artifact, but it is not the live FVB launch hook.
- Live match activity currently does not automatically create qualifying FVB volume. It can drive attention, app CTA clicks, and future hook proof events.

Upgrade path:

1. Keep the deployed WOKB/USDT proof as credibility.
2. Add a new FanVibe token hook module only if the selected launch route allows custom hooks.
3. If using eulr's standard launchpad hook, treat that as the required launch hook and build FanVibe's custom hook as the app proof layer.
4. Add automatic backend phase updates so FanVibe match state controls hook phase without manual scripts.
5. Add event-rich World Cup proof:
   - `MatchPhaseUpdated`
   - `MatchdayFeeApplied`
   - optional `TeamSupportRecorded`
   - optional `FanStreakRecorded`

## App Upgrades

Add a World Cup x Hooks dashboard section:

- Token address
- Hook address
- Pool address or pool id
- Migration/graduation status
- Current FanVibe phase
- Current hook fee
- OKX Wallet trade CTA
- Country support leaderboard
- Latest hook events
- Latest qualifying swap links

Do not hide the existing prediction-market app. The strongest story is that FanVibe already has a real consumer surface, and the token/hook turns that attention into on-chain liquidity behavior.

## Public Campaign Flow

User-facing copy must avoid hackathon-volume mechanics. The public story is:

- Stake OKB on real World Cup matches.
- Hold `$FVB` to enter the `$200 FVB Matchday Cup`.
- Push `$FVB` toward Uniswap v4 graduation.

Prize split:

- 1st: `$100`
- 2nd: `$60`
- 3rd: `$30`
- Wildcard/social pick: `$10`

Implementation phases:

1. Public campaign panel. Status: complete in `dashboard/src/App.tsx`.
2. Separate Matchday Cup leaderboard for real World Cup fixtures only. Status: complete in backend route `/matchday-cup/leaderboard` and dashboard component `MatchdayCupLeaderboard`.
3. `$FVB` holder eligibility check. Status: complete in `MatchdayCupLeaderboard` via X Layer `balanceOf`.
4. Country support layer. Status: complete in backend route `/matchday-cup/country-support`, derived from real World Cup home/away OKB stakes.
5. Post-graduation CTA switch from eulr to OKX Wallet / Uniswap v4 route.

## Backend Upgrades

Add a hook phase sync service:

- Preseason/open fixture window calls `setMatchPhase(open, fixtureId)`.
- Live match start calls `setMatchPhase(live, fixtureId)`.
- Match settlement calls `setMatchPhase(settled, fixtureId)`.
- Debounce writes so repeated UI ticks do not spam transactions.
- Persist latest phase tx hash for the proof panel.

## Real Match Data

Production World Cup mode must use Sportmonks-backed data, not local fixture files or curated demo schedules.

Recommended provider:

- Sportmonks Football API 3.0
- World Cup league ID: `732`
- Live endpoint: `/v3/football/livescores/inplay`
- Include data: `scores;participants;events;state;venue`

Required backend env:

- `WC2026_API_PROVIDER=sportmonks`
- `SPORTMONKS_API_KEY=...`
- `SPORTMONKS_API_URL=https://api.sportmonks.com/v3/football`
- `SPORTMONKS_WORLD_CUP_LEAGUE_ID=732`
- `LIVE_SPORTS_REQUIRED=1` for production

Behavior:

- If Sportmonks is configured and available, FanVibe displays provider-backed fixtures and match states.
- If Sportmonks is missing or unavailable in production, FanVibe must show no fixture markets rather than serving curated or stale data.
- `LIVE_SPORTS_REQUIRED=1` should remain enabled in production so `/worldcup/feed` returns `503` instead of silently serving fallback data.

Current integration status:

- Sportmonks is the active source of truth for fixture IDs, teams, kickoff times, states, scores, and provider events.
- Local World Cup fixture arrays are empty by design and kept only as type-safe legacy exports.
- Knockout placeholder brackets are display-only until qualified teams are known from provider/settlement state.
- Stale `wc-*` local fixtures must not appear in production feeds.

## Campaign Cadence

Daily:

- Post current country leaderboard.
- Post current phase and hook fee.
- Post one explorer proof.
- Post one OKX Wallet trade CTA.
- Reply to X Layer / OKX / World Cup-related conversations where relevant.

Match windows:

- Pre-match: "Back your nation before kickoff."
- Live: "Live phase active, fan volume is moving."
- Post-match: "Settled phase, leaderboard updated."

Milestones:

- Token launched
- Graduation progress
- Graduated to Uniswap v4
- First qualifying OKX Wallet trade
- First 10/50/100 holders
- Daily volume records
- Top country changes

## Submission Package

Prepare before final submission:

- Project name
- Token address
- Hook address
- Pool address / pool id
- Launchpad page or allowlist PR
- FanVibe app URL
- Docs URL
- GitHub URL
- X account URL
- X post tagging `@XLayerOfficial`
- Deployment txs
- Graduation/migration txs
- Proof swap txs
- Short demo video or screenshots

## Immediate Next Steps

1. Confirm eulr mainnet create flow with the launch EOA. Status: launched.
2. Reserve/create the dedicated X account.
3. Finalize name/ticker/image.
4. Launch on eulr with a curve parameter that can realistically graduate.
5. Update FanVibe app with the token/hook campaign panel.
6. Add backend phase sync for the existing hook or new hook.
7. Begin daily campaign posts immediately after launch.
