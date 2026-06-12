# runbook.md: Ledgr Operations

Written for future-Brandon working with Claude Code on a Saturday when something's broken. Keep it current as the build proceeds: a runbook that lags reality is worse than none. Sections marked *(stub)* fill in once that piece exists.

---

## 0. The two rules that override everything
1. **No deploys Saturday night.** Sunday is sermon delivery. Don't touch production into the weekend.
2. **Sunday-proof.** If the app is down, the sermon still comes off the OneDrive export and the Pulpit Ready PDF. When debugging, never disable or weaken those paths to fix something else.

---

## 1. Environment variables
Every var, a one-line description, and where to get it. Mirrors `.env.example` in the repo; keep the two in sync. Never commit secrets. Locally these live in `.env.local` (gitignored); on Vercel they're set in Project → Settings → Environment Variables.

> **Windows gotcha:** never pipe a value into `vercel env add` from PowerShell (`"x" | vercel env add …`). PowerShell prepends an invisible UTF-8 BOM to the value, which ends up stored verbatim (this once turned the sign-in URL into `﻿/sign-in` and produced an infinite redirect loop in production). Set values in the dashboard or via the REST API (`POST /v10/projects/:id/env`) instead.

| Var | What | Source |
|---|---|---|
| `DATABASE_URL` | Neon **pooler** connection string, never direct (`src/db/index.ts` refuses a `*.neon.tech` host without `-pooler`) | Neon dashboard → Connect → Pooled connection |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (client-side; app falls back to unauthenticated shell if absent) | Clerk dashboard → API Keys |
| `CLERK_SECRET_KEY` | Clerk secret key (server-side) | Clerk dashboard → API Keys |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` (the in-app sign-in page; no sign-up page, sign-ups are restricted in Clerk) | fixed value |
| `R2_ACCOUNT_ID` | Cloudflare account id (Phase 1, attachments slice) | Cloudflare dashboard |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 S3-compatible credentials | Cloudflare → R2 → Manage API tokens |
| `R2_BUCKET` | R2 bucket name (`ledgr`) | Cloudflare → R2 |
| `R2_ENDPOINT` | R2 S3 endpoint URL | Cloudflare → R2 bucket settings |
| `R2_PUBLIC_BASE_URL` | public CDN base URL for attachments (custom domain or r2.dev) | Cloudflare → R2 bucket settings |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | Azure app registration, app-only client credentials (OneDrive export now; calendar + email-in join in Phase 2) | Azure portal → App registrations (setup: §1b) |
| `ONEDRIVE_EXPORT_UPN` | whose OneDrive receives the export tree (Brandon's email); the export job also resolves its `users` row by this email | fixed value |
| `ONEDRIVE_EXPORT_ROOT` | folder inside that OneDrive holding the export (default `Ledgr` → `/Ledgr/Export/…`) | fixed value, optional |
| `TODOIST_TOKEN` | Todoist API token (Phase 2) | Todoist settings → Integrations → Developer |
| `LEDGR_API_TOKENS` | Scoped machine tokens (MCP/cron/webhooks): comma-separated `name:scope1+scope2:sha256hex` entries, hashes only | `node scripts/make-token.mjs <name> <scopes>` (§3) |
| `CRON_SECRET` | Raw `cron`-scoped machine token; Vercel sends it as the Bearer token on scheduled cron requests (§2a) | same generator as `LEDGR_API_TOKENS`; production only |
| `DEBUG_MODE` | `"true"` surfaces verbose errors/timings (e.g. real DB error detail on `/health`); `"false"` in normal use | env flag |
| `LEDGR_TIMEZONE` | IANA timezone that defines "today" (Today view, day-scoped queries); defaults to `America/New_York` when unset. The server runs in UTC, never assume its clock | env flag |
| `NEXT_PUBLIC_APP_URL` | base URL of the deployed app (absolute links, share URLs, callbacks) | deployment |
| `DEV_USER_EMAIL` | dev-only auth stand-in (ADR-006): with Clerk keys **unset** and `NODE_ENV=development`, this email resolves as the signed-in user (local UI work without a Microsoft sign-in). Ignored in production builds; never set on Vercel | local only |

> **R2 provisioning (one-time, blocks live image paste):** Cloudflare dashboard → R2 → create bucket `ledgr` → Manage API tokens → create an Object Read & Write token scoped to the bucket → fill the five `R2_*` vars locally and on Vercel (REST API or dashboard, not piped CLI — see the BOM gotcha above) → enable public access for the bucket (or attach a custom domain) and set `R2_PUBLIC_BASE_URL` to it → paste an image into any item body and confirm it renders from that base URL.

> **R2 CORS (one-time, blocks browser uploads):** presigned uploads PUT straight from the browser to the bucket, and a fresh R2 bucket has **no CORS policy**, so the preflight gets 403 and every upload fails. The app's R2 token is object-scoped (deliberately) and cannot set bucket config, so apply it in the dashboard: Cloudflare → R2 → `ledgr` bucket → Settings → CORS policy → add:
>
> ```json
> [
>   {
>     "AllowedOrigins": ["https://ledgr-teal.vercel.app", "http://localhost:3000"],
>     "AllowedMethods": ["PUT"],
>     "AllowedHeaders": ["content-type"],
>     "MaxAgeSeconds": 3600
>   }
> ]
> ```
>
> Only PUT needs CORS; image GETs go through `R2_PUBLIC_BASE_URL` as plain `<img>` requests, which never preflight. `scripts/r2-cors.mjs` holds the same policy in code (`--show` to inspect, no flag to apply; needs an Admin-scoped token in `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` to write). Update the origins when the app domain or the R2 custom domain changes.

> **R2 follow-up (open):** the bucket currently serves through the `*.r2.dev` public development URL. Cloudflare rate-limits r2.dev and recommends it for testing only, so before attachments see real use, attach a custom domain (Cloudflare → R2 bucket → Settings → Custom Domains) and change `R2_PUBLIC_BASE_URL` locally and on Vercel. Nothing else changes going forward, but URLs for already-pasted images are stored in item bodies with the old base and would need a one-off rewrite, which is a reason to switch early.

> **PowerShell gotcha #2:** assigning `''` to an env var in PowerShell *deletes* it, so you cannot use PowerShell to run the app with "set-but-empty" Clerk keys (the dev stand-in's gate). Use Git Bash for that: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= DEV_USER_EMAIL=you@example.org npm run dev`.

---

## 1a. Schema migrations and seed
- **Change the schema** in `src/db/schema.ts`, then `npm run db:generate` (writes SQL to `drizzle/`; no DB needed). Review the generated SQL before applying.
- **Apply:** `npm run db:migrate` (reads `DATABASE_URL` from `.env` / `.env.local`; refuses a non-pooler Neon URL).
- **Seed:** `npm run db:seed` — idempotent (five system `types` rows + the single `users` row); safe to re-run any time.
- Migration files in `drizzle/` are committed history. Never edit an applied migration; generate a new one.

---

## 1b. Azure app registration for the OneDrive export (one-time, Brandon)
The export job (ADR-017) authenticates app-only (client credentials): no stored refresh token to expire, no MFA prompt in a cron. Until these steps are done, the nightly export returns a visible 503 ("export target not configured") and `/health` shows `lastExportAt: null`.

1. [Azure portal](https://portal.azure.com) → Microsoft Entra ID → App registrations → **New registration**. Name `ledgr-export`, single tenant, no redirect URI.
2. On the app's Overview, copy **Directory (tenant) ID** → `GRAPH_TENANT_ID` and **Application (client) ID** → `GRAPH_CLIENT_ID`.
3. Certificates & secrets → **New client secret** (24 months, the max). Copy the secret **Value** immediately (it never shows again) → `GRAPH_CLIENT_SECRET`. **Put the expiry date on the calendar** (rotation steps: §3).
4. API permissions → Add a permission → Microsoft Graph → **Application permissions** → `Files.ReadWrite.All` → Add. Then **Grant admin consent** (you're the tenant admin). This is tenant-wide file access, which is why the secret lives only in Vercel env and the app does nothing with Graph except the export writes.
5. Set the four vars (`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `ONEDRIVE_EXPORT_UPN=brandoncollins@edgewoodcommunity.org`) in Vercel production env (dashboard or REST API, not piped CLI — BOM gotcha above) and in `.env.local`, redeploy.
6. Verify: from a signed-in browser console run `fetch('/api/export', {method:'POST'}).then(r=>r.json())`, or trigger the cron manually (§2a). Expect `{exported: N, errors: 0, …}`, files under `/Ledgr/Export/` in OneDrive, and `/health` showing a fresh `lastExportAt`.

---

## 2. Health and monitoring
- **`/health`** checks: DB reachable (`database`), `lastExportAt` (last export run with zero item errors and nothing remaining), `lastExportRunAt` (last attempt of any outcome). Todoist API and Graph token checks join once those integrations exist.
- A stale `lastExportAt` while `lastExportRunAt` advances = runs are happening but failing partway; check `error_log` (source `export`).
- A **weekly scheduled Claude task** hits `/health` and emails Brandon on failure.
- The export-timestamp check is the canary for a **silently stalled sync** (see §6, GitHub Actions auto-disable).
- Debug mode (`DEBUG_MODE` env + per-session UI toggle) surfaces verbose errors, query timings, and calendar-matcher/sync decisions. Off in normal use.
- Failed crons/webhooks are captured (small `error_log` table or free Sentry tier) and surfaced through `/health` and the UI. No silent failures, ever.

---

## 2a. Scheduled jobs
| Job | Schedule | Endpoint | Auth |
|---|---|---|---|
| Trash purge (hard-deletes items in Trash > 30 days; child rows cascade) | daily 08:00 UTC (`vercel.json`) | `GET /api/machine/purge` | Vercel sends `Bearer $CRON_SECRET`; `CRON_SECRET` holds the raw `vercel-cron` token (`cron` scope) so platform crons use the ADR-004 machine-token scheme (ADR-005) |
| OneDrive export (incremental, ≤100 items/run; on-demand twin is `POST /api/export`, user-authed) | daily 06:30 UTC (`vercel.json`) | `GET /api/machine/export` | same `Bearer $CRON_SECRET` path |

- **Run manually:** `curl -H "Authorization: Bearer <cron token>" https://ledgr-teal.vercel.app/api/machine/purge` → `{"ok":true,"purged":N,"detached":M,...}`.
- **Failures** are written to `error_log` (source `purge`, with correlation id) and logged as structured JSON; check Vercel → Project → Logs, or query `error_log`.
- **Inspect/verify the schedule:** Vercel dashboard → Project → Settings → Cron Jobs (shows last run + status).
- Sub-daily jobs (Phase 2 syncs) will come from a GitHub Actions workflow hitting these same endpoints with its own token; same auth path.

---

## 3. Token and secret rotation
- **Azure app-only client secret** (`ledgr-export` registration, §1b) has an expiry — track it as a calendar reminder. Rotate: app registration → Certificates & secrets → new secret, update `GRAPH_CLIENT_SECRET` in Vercel and `.env.local`, redeploy, run an on-demand export (§1b step 6) and confirm `/health` `lastExportAt` advances, then delete the old secret.
- **Ledgr API tokens** (MCP/cron/webhooks) are scoped and revocable; only SHA-256 hashes are stored (in `LEDGR_API_TOKENS`), so a leaked env dump yields nothing usable. Rotate on any suspicion of leak.
  - **Issue:** `node scripts/make-token.mjs <name> <scope,scope,…>` prints the raw token (give to the caller, e.g. a GitHub Actions secret; it is never stored server-side) and the env entry. Append the entry, comma-separated, to `LEDGR_API_TOKENS` in Vercel (Project → Settings → Environment Variables), redeploy.
  - **Revoke:** delete that token's entry from `LEDGR_API_TOKENS`, redeploy. The token is dead the moment the new deployment serves.
  - **Verify either way:** `/api/machine/ping` with the token returns 200 + its name/scopes when live, 401 when revoked.
  - Current tokens: `claude-diag` (scope `diag`, only grants ping; raw value in `.env.claude-diag.local` locally, used by Claude Code to verify machine auth in production); `vercel-cron` (scope `cron`; raw value lives only in the production `CRON_SECRET` env var, added 2026-06-12). Rotating `vercel-cron` = issue a new token, replace both its `LEDGR_API_TOKENS` entry and `CRON_SECRET`, redeploy.
- **Clerk / R2 / Todoist keys:** rotate from each provider's dashboard, update Vercel env, redeploy, verify `/health`.
- **Clerk sign-up policy:** sign-ups are allowlist-restricted (only allowlisted emails can ever create an account). Managed in the Clerk dashboard under Configure → Restrictions, or via Backend API (`PATCH /v1/instance/restrictions`, `POST /v1/allowlist_identifiers`). Currently allowlisted: brandoncollins@edgewoodcommunity.org.
- After any rotation, confirm `/health` is fully green before walking away.

---

## 4. Backups and restore
- **Content:** nightly OneDrive markdown export (`/Ledgr/Export/{type}/{year}/{slug}-{id8}.md` + YAML frontmatter; trashed/archived items under `/Export/_archive/`, attachment copies under `/Export/_attachments/`) plus on-demand exports (`POST /api/export`, Pulpit Ready's hook).
- **Everything else:** weekly `pg_dump` of the full DB (relations, revisions, metadata) written to OneDrive via the export job. This is the real restore path (free-tier Postgres PITR is thin).
- **Attachments:** R2 is durable on its own; OneDrive export holds a second copy.
- **Restore procedure** *(stub, must be tested once before Phase 2):*
  1. Provision a fresh Neon DB.
  2. `pg_restore` from the latest weekly dump in OneDrive.
  3. Point `DATABASE_URL` (pooler) at it, redeploy.
  4. Verify `/health`, spot-check recent items, confirm export resumes.
- **An untested backup is a hope, not a backup.** Run the restore once for real before relying on it.

---

## 5. Performance rules (mirror of PRD §6.5: honor these when writing any query)
Front-end (perceived speed):
- Optimistic updates on edits, check-offs, captures.
- Stale-while-revalidate: render from cache, then refetch.
- Lazy-load / code-split the BlockNote editor.
- Virtualize long lists; paginate.
- Batch a screen's data into one request (e.g. Today), not a query per widget.

Back-end (cheap compute/storage/traffic):
- **Pooled DB connections are mandatory.** Never a direct connection from serverless functions.
- **List queries never select `body`.**
- Index plan per `schema.md`; both `relations` columns indexed separately; GIN on `properties`; FTS as a maintained generated column.
- Incremental everything: delta/changed-since syncs, export writes only changed items, weekly `pg_dump` is the one full snapshot.
- Right-sized crons (calendar 6h, not 30 min).
- Cache-friendly file serving: R2 CDN, long cache headers, pre-sized thumbnails; bytes never proxy through the app server.
- No N+1: fetch relations and embedded-view rows in bulk per page.
- Bounded growth: cap revision snapshots with a prune step.
- Cold starts (Vercel + Neon scale-to-zero) are an accepted ~1s lag; the health ping can double as keep-warm if needed.

---

## 6. Known failure modes
- **GitHub Actions auto-disabled after 60 days of repo inactivity** → sub-daily calendar/email sync silently stops. Caught by the `/health` export-timestamp check. Fix: re-enable the workflow; consider a trivial scheduled commit to keep the repo active.
- **Free-tier ceilings** (Neon rows+compute, Clerk MAU, Vercel Hobby, GitHub Actions minutes, R2 10GB). Fine at one user; a multi-user expansion crosses several at once (a real cost cliff, not a slope).
- **Two-device concurrent edits** → optimistic UI + last-write-wins on `body` can clobber one side. Safety net is revision restore (not merge). Accepted for single user.
- **Todoist content edits are lossy by rule** (Ledgr is canonical for content). Don't rewrite task *content* in Todoist; date/completion changes sync back fine.
- **Offline note capture has no path** (only offline *task* capture via Todoist's queue). Accepted gap.
- **HTML email converts imperfectly** to markdown on email-in. Accepted.

---

## 7. Common fixes *(stub: append real incidents and resolutions as they happen)*
Format each entry: symptom → cause → fix → prevention. Building this log over time is what keeps maintenance incidents under an hour.

- _(none yet)_
