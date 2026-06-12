# runbook.md: Ledgr Operations

Written for future-Brandon working with Claude Code on a Saturday when something's broken. Keep it current as the build proceeds: a runbook that lags reality is worse than none. Sections marked *(stub)* fill in once that piece exists.

---

## 0. The two rules that override everything
1. **No deploys Saturday night.** Sunday is sermon delivery. Don't touch production into the weekend.
2. **Sunday-proof.** If the app is down, the sermon still comes off the OneDrive export and the Pulpit Ready PDF. When debugging, never disable or weaken those paths to fix something else.

---

## 1. Environment variables *(stub, fill during repo scaffold)*
Document every var here with a one-line description and where to get it. Never commit secrets.

| Var | What | Source |
|---|---|---|
| `DATABASE_URL` | Neon **pooler** connection string (not direct) | Neon dashboard → Connection pooling |
| `CLERK_*` | Clerk publishable + secret keys | Clerk dashboard |
| `R2_*` | Cloudflare R2 access key, secret, bucket, endpoint | Cloudflare R2 |
| `GRAPH_*` | Azure app registration: client id, tenant id, client secret | Azure portal → App registrations |
| `TODOIST_TOKEN` | Todoist API token | Todoist settings → Integrations |
| `LEDGR_API_TOKENS` | Scoped machine tokens (MCP/cron/webhooks) | generated, stored hashed |
| `DEBUG_MODE` | toggles verbose errors/timings | env flag |

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
- **Ledgr API tokens** (MCP/cron/webhooks) are scoped and revocable. Rotate on any suspicion of leak. *(stub: document the issue/revoke flow when built.)*
- **Clerk / R2 / Todoist keys:** rotate from each provider's dashboard, update Vercel env, redeploy, verify `/health`.
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
