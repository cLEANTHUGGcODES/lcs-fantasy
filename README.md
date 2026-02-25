# INSIGHT LoL Fantasy

INSIGHT LoL Fantasy is a Next.js 16 + Supabase app for running an LCS fantasy league with:

- league standings and weekly head-to-head views
- live multiplayer draft room (3RR + timeout autopick)
- authenticated global chat with image upload and reactions
- Leaguepedia snapshot sync + stale-data auto-refresh
- observability for draft/chat latency and reconnect health

## Architecture

High-level flow:

1. Leaguepedia parser fetches and normalizes scoreboard data.
2. Snapshot sync writes full payloads into Supabase (`fantasy_match_snapshots`).
3. App/API reads snapshots from Supabase only.
4. Scoring settings (admin-managed) are applied at read time.
5. Draft + chat run live over Supabase DB, RPCs, RLS, Storage, and Realtime.

Core stack:

- `next@16.1.6` + React 19 App Router
- `@heroui/react@2.8.8` + Tailwind CSS v4
- Supabase Auth + Postgres + Realtime + Storage
- TypeScript + ESLint

## Repo Layout

```text
src/app/                   Pages + API routes
src/components/            UI (dashboard, draft room, chat, auth widgets)
src/lib/                   Domain logic (draft engine, sync, Supabase access, scoring)
src/data/friends-league.json
supabase/schema.sql        Canonical DB schema (tables, RPCs, RLS, storage policies)
supabase/migrations/       Incremental SQL changes
scripts/                   Tooling (launcher, load test, scoring optimizer, font checks)
tests/                     Manual draft-room audit checklist
```

## Prerequisites

- Node.js 20+ (Node 20 LTS recommended)
- npm 10+
- Supabase project with:
  - project URL
  - publishable key (or anon key)
  - service role key

## Quick Start

1. Install dependencies.

```bash
npm install
```

2. Create local env file.

```bash
cp .env.example .env.local
```

3. Configure required environment variables (see table below).
4. Apply database schema in Supabase SQL editor using `supabase/schema.sql`.
5. In Supabase Dashboard, enable `Authentication -> Providers -> Email`.
6. Start dev server.

```bash
npm run dev
```

7. Open `http://localhost:3000`.

Windows note: if you switch shells (PowerShell <-> WSL), rerun `npm install` in that shell so local binaries are correct.

## Environment Variables

### Required

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public Supabase URL used by browser/server auth clients. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes* | Preferred public key. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes* | Fallback if publishable key is not set. |
| `SUPABASE_URL` | Yes | Server-side Supabase URL for service-role client. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Required by server APIs/RPCs/storage/admin actions. |

\* Set at least one of `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### App/Data Controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `LEAGUEPEDIA_PAGE` | `src/data/friends-league.json` value | Source page override for sync/snapshot reads. |
| `SUPABASE_MATCH_SNAPSHOTS_TABLE` | `fantasy_match_snapshots` | Snapshot table override. |
| `SUPABASE_SCORING_SETTINGS_TABLE` | `fantasy_scoring_settings` | Scoring settings table override. |
| `SNAPSHOT_STALE_MINUTES` | `30` | Stale threshold used by `/api/snapshot-status`. |
| `AUTO_SYNC_ON_READ` | `true` | Enables stale snapshot auto-sync during reads. |
| `AUTO_SYNC_STALE_MINUTES` | `10` | Auto-sync stale threshold. |
| `AUTO_SYNC_MIN_ATTEMPT_SECONDS` | `45` | Throttle between auto-sync attempts. |
| `NEXT_PUBLIC_CHAT_VIRTUALIZATION` | `0` | Enables chat message-list virtualization when set to `1` (default off for stability). |
| `NEXT_PUBLIC_CHAT_PROFILE` | `0` | Enables client-side chat profiler logs (`window.__chatProfileSnapshot()`). |

### Protected Endpoint Tokens

| Variable | Used By |
| --- | --- |
| `SYNC_API_TOKEN` | `POST /api/admin/sync-leaguepedia` via `x-sync-token` |
| `DRAFT_AUTOMATION_TOKEN` | `GET/POST /api/cron/drafts` via bearer or `x-cron-token` |
| `CRON_SECRET` | Fallback token for `/api/cron/drafts` if `DRAFT_AUTOMATION_TOKEN` is unset |

### Advanced Local Launcher Flags

Used by `scripts/run-next-with-css-wasm.mjs`:

- `NEXT_DEV_BUNDLER=turbopack` to force Turbopack in dev
- `NEXT_LAUNCHER_DEBUG=1` for launcher diagnostics
- Windows-only recovery flags:
  - `NEXT_FORCE_WINDOWS_NO_ADDONS=1`
  - `NEXT_FORCE_WINDOWS_SWC_WASM=1`
  - `NEXT_FORCE_WINDOWS_CSS_WASM=1`

## League Configuration

Default league config lives in `src/data/friends-league.json`:

- `leagueName`: display name shown in the app
- `sourcePage`: Leaguepedia page title (example: `LCS/2026_Season/Lock-In`)
- `scoring`: fallback scoring values
- `rosters`: friend/team fantasy rosters

Notes:

- `LEAGUEPEDIA_PAGE` env var overrides `sourcePage` at runtime.
- Admin scoring updates are saved in Supabase and override JSON fallback scoring.

## Supabase Setup

### Canonical Setup (recommended)

Run `supabase/schema.sql` against your Supabase project. The file is idempotent and includes:

- core tables for snapshots, drafts, chat, scoring, observability
- RPCs:
  - `fantasy_process_due_drafts`
  - `fantasy_submit_draft_pick`
  - `fantasy_chat_post_message`
  - `fantasy_chat_observability_summary`
  - `fantasy_draft_observability_summary`
  - `fantasy_cleanup_chat_data`
- grants and RLS policies
- Realtime publication setup for draft/chat tables
- storage bucket policies for:
  - `profile-images`
  - `chat-images`

### Existing Databases

If your database predates recent features, also apply SQL files in `supabase/migrations/` (in order). Current migrations include:

- pick timer constraints
- role uniqueness/max-5 draft enforcement
- draft observability + perf indexes
- player portrait + autopick projection support
- chat hardening + image support + reactions
- draft timeout event tracking

## Authentication and Roles

- Dashboard and draft pages require auth (unauthenticated users redirect to `/auth`).
- Auth uses Supabase email/password with profile metadata:
  - `first_name`, `last_name`, `team_name`, `display_name`
  - optional `avatar_path`, `avatar_border_color`
- Global admin identity is stored in `fantasy_app_admin` (`id = 1`).
- On `/`, admin can auto-seed if missing (`seedIfUnset: true`), then:
  - admin can manage scoring settings and draft management
  - non-admin users can join drafts where they are participants

## Draft System

Key behavior:

- 3RR order:
  - round 1: `1 -> N`
  - rounds 2-3: `N -> 1`
  - round 4+: alternates
- max roster size is 5 (one per role: TOP/JNG/MID/ADC/SUP)
- draft status lifecycle: `scheduled -> live -> paused -> completed`
- timeout automation + autopick runs via RPC and cron/api processing
- server endpoints emit `Server-Timing` headers for draft latency

Data model:

- `fantasy_drafts`
- `fantasy_draft_participants`
- `fantasy_draft_team_pool`
- `fantasy_draft_picks`
- `fantasy_draft_presence`
- `fantasy_draft_timeout_events`
- `fantasy_draft_observability_events`

## Global Chat

Features:

- authenticated global room
- text + image messages (JPG/PNG/WEBP, up to 3MB)
- idempotent sends (`x-idempotency-key`)
- emoji reactions
- realtime updates with fallback sync
- client/server observability metrics
- client list virtualization with kill-switch (`NEXT_PUBLIC_CHAT_VIRTUALIZATION=0`)
- optional in-browser render profiler (`NEXT_PUBLIC_CHAT_PROFILE=1`)

Data model:

- `fantasy_global_chat_messages`
- `fantasy_global_chat_reactions`
- `fantasy_chat_observability_events`

## API Reference

### Snapshot + Sync

| Route | Methods | Auth | Notes |
| --- | --- | --- | --- |
| `/api/snapshot` | `GET` | none | Returns latest computed fantasy snapshot from Supabase. |
| `/api/snapshot-status` | `GET` | none | Returns freshness metadata (`storedAt`, `sourceRevisionId`, staleness). |
| `/api/admin/sync-leaguepedia` | `POST` | token (optional) | Manual sync; checks Leaguepedia revision and skips unchanged snapshots. |

### Scoring

| Route | Methods | Auth | Notes |
| --- | --- | --- | --- |
| `/api/scoring-settings` | `GET`, `POST` | auth + admin | Read/update league scoring weights. |

### Drafts

| Route | Methods | Auth | Notes |
| --- | --- | --- | --- |
| `/api/drafts` | `GET` | auth | Lists drafts (also processes due drafts). |
| `/api/drafts` | `POST` | auth + admin | Creates draft + participants + player pool from synced source page. |
| `/api/drafts/users` | `GET` | auth + admin | Lists registered users for participant selection. |
| `/api/drafts/validate-source` | `POST` | auth + admin | Validates source page snapshot and player pool coverage. |
| `/api/drafts/metrics` | `POST` | auth | Client draft observability batch ingest. |
| `/api/drafts/metrics` | `GET` | auth + admin | Draft observability summary (`windowMinutes` query). |
| `/api/drafts/[draftId]` | `GET` | auth | Draft detail payload for authenticated users. |
| `/api/drafts/[draftId]` | `DELETE` | commissioner/admin | Deletes a draft. |
| `/api/drafts/[draftId]/pick` | `POST` | on-clock participant | Atomic manual pick submission. |
| `/api/drafts/[draftId]/presence` | `POST` | participant | Presence heartbeat/ready toggle. |
| `/api/drafts/[draftId]/status` | `POST` | commissioner | Transition status (supports force-start). |

### Chat

| Route | Methods | Auth | Notes |
| --- | --- | --- | --- |
| `/api/chat` | `GET` | auth | Paginated message fetch (`limit`, `afterId`, `beforeId`). |
| `/api/chat` | `POST` | auth | Send message/image message with optional idempotency key. |
| `/api/chat/upload` | `POST` | auth | Upload chat image to `chat-images` bucket. |
| `/api/chat/reactions` | `GET`, `POST` | auth | Read/toggle reactions per message. |
| `/api/chat/metrics` | `POST` | auth | Client chat observability events. |

### Automation + Account

| Route | Methods | Auth | Notes |
| --- | --- | --- | --- |
| `/api/cron/drafts` | `GET`, `POST` | cron token/header | Processes due drafts, chat cleanup, observability summaries, snapshot sync. |
| `/api/account` | `DELETE` | auth | Account deletion; request body must include `{ "confirmation": "DELETE" }`. |

## Operational Tasks

### Manually Trigger Snapshot Sync

```bash
curl -X POST "http://localhost:3000/api/admin/sync-leaguepedia" \
  -H "x-sync-token: YOUR_SYNC_API_TOKEN"
```

Optional query parameter:

- `?page=LCS/2026_Season/Lock-In`

### Manually Trigger Draft/Cron Processing

```bash
curl -X POST "http://localhost:3000/api/cron/drafts" \
  -H "Authorization: Bearer YOUR_DRAFT_AUTOMATION_TOKEN"
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs Next dev via Windows-safe launcher. |
| `npm run build` | Production build via launcher. |
| `npm run start` | Starts production server via launcher. |
| `npm run lint` | Runs ESLint. |
| `npm run optimize:scoring` | Searches for improved scoring settings and can apply results. |
| `npm run loadtest:draftroom -- --draft-id ... --users-file ...` | Synthetic multi-user draft room load test. |
| `npm run check:fonts` | Enforces League Spartan-only font usage in `src/`. |

## Deployment

Standard Next.js flow:

```bash
npm run build
npm run start
```

`vercel.json` currently schedules:

- `/api/cron/drafts` at `0 12 * * *`

For active live drafts, a tighter cadence (for example every minute) is typically better.

## Troubleshooting

### `No snapshot found in Supabase`

- Run `POST /api/admin/sync-leaguepedia` first.
- Verify `LEAGUEPEDIA_PAGE` and source page in draft creation match synced data.

### Auth setup error on `/auth`

- Ensure `NEXT_PUBLIC_SUPABASE_URL` and public key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) are set.

### Missing draft/chat columns or RPC errors

- Apply latest `supabase/schema.sql`.
- If using incremental upgrades, apply all files in `supabase/migrations/`.

### Windows `lightningcss` native binding errors

- Run:

```bash
node .\\scripts\\ensure-lightningcss-win.mjs
```

- Then retry `npm run dev`.

## Notes for Contributors

- Keep `README.md` and `supabase/schema.sql` in sync when behavior changes.
- Prefer adding migration files for production upgrades and then reflecting final state in `schema.sql`.
- If you add/modify API routes, update the API reference table above in the same PR.
