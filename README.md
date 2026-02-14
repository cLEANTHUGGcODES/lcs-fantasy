# INSIGHT LoL Fantasy

Lightweight Next.js app that pulls Leaguepedia scoreboard data and turns it into:

- Friend league standings (based on local rosters)
- Player fantasy leaderboard
- Best single-game performances
- JSON snapshot endpoint for integrations
- Supabase Auth (email/password register + login)
- Supabase-hosted profile images (Storage bucket)
- End-to-end reverse-snake player draft management

## UI Stack

- HeroUI `2.8.8` (`@heroui/react`)
- Framer Motion `12.x`
- Tailwind CSS v4 with HeroUI plugin via `hero.mjs`

## Supabase Data Flow

Runtime reads match data **only from Supabase**.

- App/API snapshot endpoint: reads latest row from `fantasy_match_snapshots`
- Sync endpoint: fetches from Leaguepedia and writes a new snapshot row to Supabase
- Each row stores full payload: matches (including blue/red team icon URLs from Fandom), scoring config, rosters, standings, player totals, top performances
- Sync stores Leaguepedia `revid` (`sourceRevisionId`) and skips insert when revision is unchanged

## Data Source

By default this app parses:

`https://lol.fandom.com/wiki/LCS/2026_Season/Lock-In`

It uses the MediaWiki `action=parse` API under the hood, discovers linked
`/Scoreboards/...` pages for the tournament, and extracts each `table.sb` game block.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

If you switch shells (for example WSL -> PowerShell), rerun `npm install` in that shell so local CLI binaries are created for that environment.

If you see a Windows `lightningcss.win32-x64-msvc.node` or `../pkg` error, run `node .\\scripts\\ensure-lightningcss-win.mjs` once in the project root and retry `npm run dev`.

## Supabase Setup

1. Create the table using `supabase/schema.sql` in your Supabase SQL editor.
   - If your database was initialized before February 14, 2026, also run
     `supabase/migrations/20260214_allow_pick_seconds_min_1.sql` to allow
     1-second pick timers.
   - Apply `supabase/migrations/20260214_enforce_unique_positions_max5.sql`
     to enforce draft roster rules (one position each, max 5 players).
2. Copy `.env.example` to `.env.local` and fill:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (preferred) or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_MATCH_SNAPSHOTS_TABLE` (default is `fantasy_match_snapshots`)
   - `SUPABASE_SCORING_SETTINGS_TABLE` (default is `fantasy_scoring_settings`)
   - `SYNC_API_TOKEN` (recommended)
   - `SNAPSHOT_STALE_MINUTES` (default `30`)
   - `DRAFT_AUTOMATION_TOKEN` (recommended for cron endpoint protection)
3. In Supabase Dashboard, enable Email provider in Auth:
   - `Authentication -> Providers -> Email`
4. Start the app.

## Authentication

- `GET /auth` provides register/login UI.
- Registration requires a display name and stores it in Supabase Auth user metadata (`display_name`).
- Signed-in users can upload/remove a profile image. Files are stored in Supabase Storage bucket `profile-images`, and the image path is stored in Auth user metadata (`avatar_path`).
- `/` requires an authenticated session and redirects unauthenticated users to `/auth`.
- Session refresh is handled by `middleware.ts` using Supabase SSR cookies.

## Draft Management

- `GET /drafts` provides commissioner tools to:
  - create a draft tied to a specific league + season (`LCS`, `2026`) and source page
  - choose draft time, rounds, and seconds-per-pick
  - select and order registered website users as participants
- Draft room at `GET /drafts/:draftId` includes:
  - commissioner controls (start, force start, pause, resume, complete)
  - reverse-snake on-clock logic (round 1 runs bottom-to-top, round 2 top-to-bottom)
  - participant presence + ready check
  - server-time-synced pick countdown
  - atomic live pick submission with turn/team/timer enforcement
  - automatic timeout picks and auto-complete via background processing
  - draft board and full pick log

The new draft tables are included in `supabase/schema.sql`:

- `fantasy_drafts`
- `fantasy_draft_participants`
- `fantasy_draft_team_pool` (stores player pool entries)
- `fantasy_draft_picks`
- `fantasy_draft_presence`

Also included in `supabase/schema.sql`:

- `fantasy_submit_draft_pick(...)` RPC for race-safe pick commits
- `fantasy_process_due_drafts(...)` RPC for auto-start + timeout handling
- Realtime publication setup for draft tables
- RLS policies for authenticated draft viewers

### Draft Automation Cron

Route:

- `GET|POST /api/cron/drafts`

Auth:

- `Authorization: Bearer <DRAFT_AUTOMATION_TOKEN>` or `x-cron-token: <DRAFT_AUTOMATION_TOKEN>`
- If `DRAFT_AUTOMATION_TOKEN` is not set, only requests with `x-vercel-cron` are accepted.

Suggested Vercel Cron cadence:

- every minute (`* * * * *`)

Example `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/drafts",
      "schedule": "* * * * *"
    }
  ]
}
```

## Sync Leaguepedia -> Supabase

The app includes a protected sync endpoint:

`POST /api/admin/sync-leaguepedia`

Optional query parameter:

- `page` (overrides source page for this sync call)

Headers:

- `x-sync-token: <SYNC_API_TOKEN>` (required if `SYNC_API_TOKEN` is set)

Example PowerShell:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/admin/sync-leaguepedia" `
  -Headers @{ "x-sync-token" = "YOUR_PRIVATE_SYNC_TOKEN" }
```

Sync response includes:

- `updated: true` when a new Leaguepedia revision was written
- `updated: false` when latest stored revision already matches

## Customize Your League

Edit `src/data/friends-league.json`:

- `leagueName`
- `sourcePage`
- `scoring` (default/fallback values; live overrides can be managed in the Settings -> Scoring Settings modal)
- `rosters` (friends + picked players)

Example player format:

```json
{
  "friend": "Alex",
  "players": ["Morgan", "Josedeodo", "Quid", "Yeon", "CoreJJ"]
}
```

## Optional Environment Override

Set `LEAGUEPEDIA_PAGE` to target a different source page without editing JSON:

```bash
LEAGUEPEDIA_PAGE="LCS/2026_Season/Lock-In"
```

## Mobile Smoke E2E (Playwright)

The repo includes mobile smoke specs and a CI workflow to enforce baseline responsiveness.

Scripts:

- `npm run test:e2e:mobile`
- `npm run test:e2e:mobile:headed`
- `npm run test:e2e:mobile:ui`
- `npm run test:e2e:mobile:install`

### Local Run (PowerShell)

1. Start app in one terminal:

```powershell
npm run dev
```

2. Run tests in another terminal:

```powershell
npm run test:e2e:mobile
```

### Local Run With Managed Web Server

If you want Playwright to start the app for you:

```powershell
$env:PLAYWRIGHT_WEB_SERVER_COMMAND="npm run start -- -p 3000"
$env:PLAYWRIGHT_BASE_URL="http://127.0.0.1:3000"
npm run build
npm run test:e2e:mobile
```

### Optional Authenticated Mobile Smoke

Anonymous smoke always runs. Authenticated smoke is enabled only when both are set:

- `E2E_USER_EMAIL`
- `E2E_USER_PASSWORD`

Without these env vars, auth-required specs are skipped automatically.

## API Endpoint

`GET /api/snapshot`

Returns the latest full fantasy snapshot from Supabase.

`GET /api/snapshot-status`

Returns freshness metadata:

- latest `storedAt`
- `sourceRevisionId` (Leaguepedia revision)
- age in minutes and `isStale` based on `SNAPSHOT_STALE_MINUTES`

## Deploy / Self-Host

Any standard Next.js host works:

1. `npm run build`
2. `npm run start`

Or deploy to platforms like Vercel, Netlify, Render, Railway, or your own VPS.
