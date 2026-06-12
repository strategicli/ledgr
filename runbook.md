# runbook.md: Ledgr Operations

Written for future-Brandon working with Claude Code on a Saturday when something's broken. Keep it current as the build proceeds: a runbook that lags reality is worse than none. Sections marked *(stub)* fill in once that piece exists.

---

## 0. The two rules that override everything
1. **No deploys Saturday night.** Sunday is sermon delivery. Don't touch production into the weekend.
2. **Sunday-proof.** If the app is down, the sermon still comes off the OneDrive export and the Pulpit Ready PDF. When debugging, never disable or weaken those paths to fix something else.

---

## 1. Environment variables
Every var, a one-line description, and where to get it. Mirrors `.env.example` in the repo; keep the two in sync. Never commit secrets. Locally these live in `.env.local` (gitignored); on Vercel they're set in Project → Settings → Environment Variables.

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
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | Azure app registration (Phase 2: calendar, email-in, OneDrive export) | Azure portal → App registrations |
| `TODOIST_TOKEN` | Todoist API token (Phase 2) | Todoist settings → Integrations → Developer |
| `LEDGR_API_TOKENS` | Scoped machine tokens (MCP/cron/webhooks): comma-separated `name:scope1+scope2:sha256hex` entries, hashes only | `node scripts/make-token.mjs <name> <scopes>` (§3) |
| `DEBUG_MODE` | `"true"` surfaces verbose errors/timings (e.g. real DB error detail on `/health`); `"false"` in normal use | env flag |
| `NEXT_PUBLIC_APP_URL` | base URL of the deployed app (absolute links, share URLs, callbacks) | deployment |

---

## 1a. Schema migrations and seed
- **Change the schema** in `src/db/schema.ts`, then `npm run db:generate` (writes SQL to `drizzle/`; no DB needed). Review the generated SQL before applying.
- **Apply:** `npm run db:migrate` (reads `DATABASE_URL` from `.env` / `.env.local`; refuses a non-pooler Neon URL).
- **Seed:** `npm run db:seed` — idempotent (five system `types` rows + the single `users` row); safe to re-run any time.
- Migration files in `drizzle/` are committed history. Never edit an applied migration; generate a new one.

---

## 2. Health and monitoring
- **`/health`** checks: DB reachable, last successful export timestamp, and (once they exist) Todoist API, Graph token validity.
- A **weekly scheduled Claude task** hits `/health` and emails Brandon on failure.
- The export-timestamp check is the canary for a **silently stalled sync** (see §6, GitHub Actions auto-disable).
- Debug mode (`DEBUG_MODE` env + per-session UI toggle) surfaces verbose errors, query timings, and calendar-matcher/sync decisions. Off in normal use.
- Failed crons/webhooks are captured (small `error_log` table or free Sentry tier) and surfaced through `/health` and the UI. No silent failures, ever.

---

## 3. Token and secret rotation
- **Azure app-only client secret** has an expiry. Track it as a recurring calendar reminder. Rotation steps *(stub, fill when Graph auth is built)*: generate new secret in the app registration, update `GRAPH_CLIENT_SECRET` in Vercel, redeploy, verify `/health` Graph check is green, delete old secret.
- **Ledgr API tokens** (MCP/cron/webhooks) are scoped and revocable; only SHA-256 hashes are stored (in `LEDGR_API_TOKENS`), so a leaked env dump yields nothing usable. Rotate on any suspicion of leak.
  - **Issue:** `node scripts/make-token.mjs <name> <scope,scope,…>` prints the raw token (give to the caller, e.g. a GitHub Actions secret; it is never stored server-side) and the env entry. Append the entry, comma-separated, to `LEDGR_API_TOKENS` in Vercel (Project → Settings → Environment Variables), redeploy.
  - **Revoke:** delete that token's entry from `LEDGR_API_TOKENS`, redeploy. The token is dead the moment the new deployment serves.
  - **Verify either way:** `/api/machine/ping` with the token returns 200 + its name/scopes when live, 401 when revoked.
  - Current tokens: `claude-diag` (scope `diag`, only grants ping; raw value in `.env.claude-diag.local` locally, used by Claude Code to verify machine auth in production).
- **Clerk / R2 / Todoist keys:** rotate from each provider's dashboard, update Vercel env, redeploy, verify `/health`.
- **Clerk sign-up policy:** sign-ups are allowlist-restricted (only allowlisted emails can ever create an account). Managed in the Clerk dashboard under Configure → Restrictions, or via Backend API (`PATCH /v1/instance/restrictions`, `POST /v1/allowlist_identifiers`). Currently allowlisted: brandoncollins@edgewoodcommunity.org.
- After any rotation, confirm `/health` is fully green before walking away.

---

## 4. Backups and restore
- **Content:** nightly OneDrive markdown export (`/Export/{type}/{year}/{slug}.md` + YAML frontmatter) plus on-demand Pulpit Ready exports.
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
