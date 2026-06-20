# FanVibe Session Handoff

Project: `C:\Users\USER\xcup-fanvibe`

Current direction:
- Focus FanVibe entirely on real World Cup matches.
- Simulated season flow is retired for now.
- Frontend is deployed on Vercel, not Railway.
- Backend/API is on Railway.
- Live site: `https://www.fanvibe.xyz`
- Railway API: `https://xcup-fanvibe-production.up.railway.app`

Latest pushed commits:
- `101b200` Retire simulated season runtime
- `46ee1e4` Compact referee market persistence
- `e349d67` Focus UI on live World Cup matches

Important fixes:
- Backend simulation disabled unless `ENABLE_SIMULATION=true`.
- `SeasonController` no longer starts by default.
- Referee engine no longer schedules simulated fixtures by default.
- Frontend simulation UI disabled.
- Referee market persistence compacted to avoid Upstash 413.
- `/health` exposes storage driver and season info.

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
