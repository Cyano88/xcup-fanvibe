# FanVibe Session Handoff

Project: `C:\Users\USER\xcup-fanvibe`

Current direction:
- Focus FanVibe entirely on real World Cup matches.
- Simulated season flow is retired for now.
- Distribution Cup is the active campaign board: verified FVB trading, connected X activity, referrals, FanVibe stakes, and wins drive score.
- FVB is graduated/migrated; trade CTAs should point users to OKX Wallet / OKX DEX on X Layer.
- Frontend is deployed on Vercel, not Railway.
- Backend/API is on Railway.
- Live site: `https://www.fanvibe.xyz`
- Railway API: `https://xcup-fanvibe-production.up.railway.app`

Latest pushed commits:
- `14e70e6` Add X OAuth scoring integration
- `4004492` Rework leaderboard for Distribution Cup
- `4dda551` Handle additional Sportmonks match states
- `74b80f4` Make Upstash fallback non-fatal
- `82c117c` Move durable state to Postgres
- `101b200` Retire simulated season runtime
- `46ee1e4` Compact referee market persistence
- `e349d67` Focus UI on live World Cup matches

Important fixes:
- Backend simulation disabled unless `ENABLE_SIMULATION=true`.
- `SeasonController` no longer starts by default.
- Referee engine no longer schedules simulated fixtures by default.
- Frontend simulation UI disabled.
- Referee market persistence compacted to avoid Upstash 413.
- Durable state uses Postgres when `DATABASE_URL` is set, with Upstash/file fallback.
- `/health` exposes storage driver and season info.
- Distribution Cup scoring requires connected X plus `$250+` verified FVB volume for prize-board ranking.
- X OAuth tokens are encrypted with `X_TOKEN_ENCRYPTION_KEY`; do not deploy X scoring without it.

Vercel:
- Frontend project is `dashboard`.
- Deploy from `C:\Users\USER\xcup-fanvibe\dashboard`.
- Command: `npx vercel --prod --yes`
- Latest deployed alias: `https://www.fanvibe.xyz`
- Latest bundle checked: `/assets/index-BCXwkl89.js`

Railway:
- Backend deploys from repo root.
- Watch logs for:
  - `Simulation retired - simulated fixture scheduler disabled`
  - `Simulation retired - season controller disabled`
  - no `Upstash 413`
- `/health` should show `storage.driver: "upstash"`.

Current concern:
- If Season 83 still appears, it is stale browser cache or wrong frontend deployment.
- Hard refresh/private window first.

Resume prompt:
`Read docs/session-handoff.md and continue.`
