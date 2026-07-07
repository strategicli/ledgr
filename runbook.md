# runbook.md: Ledgr Operations

Written for future-Brandon working with Claude Code on a Saturday when something's broken. Keep it current as the build proceeds: a runbook that lags reality is worse than none. Sections marked *(stub)* fill in once that piece exists.

> **Status: v1.0 PRODUCTION since 2026-06-26 (ADR-115).** Ledgr holds real data and is in daily use. The two rules below are in force, and operational caution (real migrations, backups, restore drills) is now live, not theoretical.

---

## 0. The two rules that override everything
1. **Be deliberate with production (ADR-119).** Ledgr is in daily use, so prefer additive, reversible changes and lean on the safety net (soft-delete + revisions + the weekly backup + git revert); don't ship large, risky changes carelessly. There is no fixed weekend/Saturday no-deploy window: Brandon preaches only a few times a year, so use judgment on the rare sermon-sensitive weekend rather than a blanket calendar ban.
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
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | Azure app registration, app-only client credentials. One registration carries every app-only permission: `Files.ReadWrite.All` (export, §1b) plus `Calendars.Read` and later `Mail.Read` for Phase 2 (§1c). All Graph callers share one token via `src/lib/graph/client.ts` | Azure portal → App registrations (setup: §1b, §1c) |
| `ONEDRIVE_EXPORT_UPN` | whose OneDrive receives the export tree (Brandon's email); the export job also resolves its `users` row by this email | fixed value |
| `ONEDRIVE_EXPORT_ROOT` | folder inside that OneDrive holding the export (default `Ledgr` → `/Ledgr/Export/…`) | fixed value, optional |
| `GRAPH_MAILBOX_UPN` | mailbox whose calendar/mail the app-only jobs read (Phase 2). Optional: defaults to `ONEDRIVE_EXPORT_UPN` since it's the same person; set only if they ever diverge | fixed value, optional |
| `LEDGR_MCP_OWNER_UPN` | whose `users` row the MCP server (§1f) acts for. Optional: defaults to `ONEDRIVE_EXPORT_UPN` / `GRAPH_MAILBOX_UPN` (same person); set only if the MCP identity ever diverges | fixed value, optional |
| `TODOIST_TOKEN` | Todoist API token (Phase 2) | Todoist settings → Integrations → Developer |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push (Phase 2, slice 30) VAPID keypair; without them `/api/push` reports unconfigured and the notify crons 503. The public key is also the browser's `applicationServerKey` | `node scripts/make-vapid-keys.mjs` (§1e) |
| `VAPID_SUBJECT` | Push contact (RFC 8292 `sub`): `mailto:` or https URL | fixed value, optional (defaults to a localhost mailto) |
| `LEDGR_API_TOKENS` | Scoped machine tokens (MCP/cron/webhooks): comma-separated `name:scope1+scope2:sha256hex` entries, hashes only | `node scripts/make-token.mjs <name> <scopes>` (§3) |
| `LEDGR_OAUTH_SECRET` | HMAC signing secret for the MCP OAuth shim (ADR-117): enables connecting the MCP from claude.ai web + the Claude mobile apps as a custom connector. Without it those clients can't connect (the discovery routes 404) and the MCP 401 stays header-less; the manual-token clients (Claude Code/Desktop) are unaffected either way. Rotating it is the OAuth revocation kill switch (§3a) | any high-entropy string, e.g. `openssl rand -hex 32` (§1f) |
| `CRON_SECRET` | Raw `cron`-scoped machine token; Vercel sends it as the Bearer token on scheduled cron requests (§2a) | same generator as `LEDGR_API_TOKENS`; production only |
| `GITHUB_TOKEN` | PAT for the Changelog (reads commit history) + shared collab notes (commits a repo file). Without it the Changelog page shows "not connected". `repo` scope, or fine-grained Contents read+write | GitHub → Developer settings → PATs (§1g) |
| `GITHUB_REPO` / `GITHUB_BRANCH` | `owner/repo` (default `strategicli/ledgr`) and the commit-history branch (default `main`) | fixed value, optional |
| `GITHUB_NOTES_BRANCH` / `GITHUB_NOTES_PATH` | branch + path for the shared notes file. Branch defaults to `GITHUB_BRANCH`; set to e.g. `collab-notes` (auto-created) so a note Save doesn't trigger a rebuild. Path defaults to `COLLAB_NOTES.md` | fixed value, optional |
| `ASSEMBLYAI_API_KEY` | Enables audio→transcription on meetings (meeting recording v1b, ADR-088/089). Without it, transcripts are paste-only and the audio-upload control is hidden; `/health` `checks.transcription` is `none`. With it set, `none`→`assemblyai` and audio upload appears (§1i) | AssemblyAI dashboard, optional |
| `TRANSCRIPTION_ADAPTER` | Selects the transcription adapter (default `assemblyai`); set to `none` to disable even with a key | fixed value, optional |
| `DEBUG_MODE` | `"true"` surfaces verbose errors/timings (e.g. real DB error detail on `/health`); `"false"` in normal use | env flag |
| `LEDGR_TIMEZONE` | **Fallback** IANA timezone. The owner's zone is now a per-user setting (User Settings → Timezone; `users.settings.timezone`), resolved by `getAppTimezone()`. This env var is only the fallback before an owner is known or when none is chosen; defaults to `America/New_York`. The server runs in UTC, never assume its clock | env flag |
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
- **After every `git pull`, run `npm run db:migrate`.** Migrations are committed but each builder's database applies them separately. A pull that brings new `drizzle/*.sql` files leaves your DB a table behind until you apply them, and the missing-table error only shows when you hit the page that queries it (see §7, the `templates` incident).

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

## 1c. Azure calendar + email-in access (one-time, Brandon — Phase 2)
> **✅ Completed 2026-06-19.** `Calendars.Read` + `Mail.ReadWrite` granted and admin-consented, the Application Access Policy restricts the app to Brandon's mailbox, and the `Ledgr Import` folder exists. Verified live: the `verify-graph-auth.mts` Calendars.Read probe is clean, and `/health` shows clean `lastCalendarSyncAt` + `lastEmailImportAt`. Steps below are kept as the how-to / for re-setup.

The calendar poll and email-in are unattended jobs, so they authenticate **app-only** on the same `ledgr-export` registration (ADR-022): no stored refresh token to expire, no MFA prompt in a cron. App-only Exchange permissions are tenant-wide by default, so they **must** be restricted to Brandon's mailbox by an Application Access Policy — that's the security boundary, and it's mandatory, not optional. (The export's `Files.ReadWrite.All` stays tenant-wide because Application Access Policies are Exchange-only; that's already accepted in §1b.)

Until this is done, `/health` `checks.graph` reports `{configured:true, ok:true}` (the token grant works from §1b), but any calendar/mail call returns **403** and the calendar sync logs a visible "permission/access-policy missing" error rather than stalling silently.

1. **Add the permissions.** Azure portal → the `ledgr-export` registration → API permissions → Add a permission → Microsoft Graph → **Application permissions** → add `Calendars.Read` **and `Mail.ReadWrite`** (email-in needs read to import + write to mark-read and move to the Imported subfolder). → **Grant admin consent** (you're the tenant admin).
2. **Create a scope group.** In Exchange Online (or Microsoft 365 admin), make a mail-enabled security group whose only member is Brandon:
   ```powershell
   # Exchange Online PowerShell (Connect-ExchangeOnline first)
   New-DistributionGroup -Name "Ledgr Mailbox Scope" -Type Security `
     -Members brandoncollins@edgewoodcommunity.org `
     -PrimarySmtpAddress ledgr-mailbox-scope@edgewoodcommunity.org
   ```
3. **Restrict the app to that group.** Use the **Application (client) ID** from §1b:
   ```powershell
   New-ApplicationAccessPolicy -AppId <GRAPH_CLIENT_ID> `
     -PolicyScopeGroupId ledgr-mailbox-scope@edgewoodcommunity.org `
     -AccessRight RestrictAccess `
     -Description "Restrict Ledgr to Brandon's mailbox only"
   ```
4. **Confirm the boundary both ways** (policies can take ~30 min to apply):
   ```powershell
   Test-ApplicationAccessPolicy -Identity brandoncollins@edgewoodcommunity.org -AppId <GRAPH_CLIENT_ID>   # AccessCheckResult: Granted
   Test-ApplicationAccessPolicy -Identity someone-else@edgewoodcommunity.org   -AppId <GRAPH_CLIENT_ID>   # AccessCheckResult: Denied
   ```
5. (Optional) Set `GRAPH_MAILBOX_UPN` if the calendar mailbox ever differs from `ONEDRIVE_EXPORT_UPN`; otherwise leave it unset (defaults to the export UPN).
6. **Email-in folder (slice 26):** in Outlook, create a top-level mail folder named exactly **`Ledgr Import`** (Outlook rules can auto-file mail into it by sender/subject/category). The app creates the `Imported` subfolder itself on first run, and moves imported messages there (marked read) so nothing double-imports.
7. **Verify:** `scripts/verify-graph-auth.mts` probes `Calendars.Read` and reports whether it works yet; once the policy applies, the probe stops returning 403. Calendar end-to-end: "sync now" (§2a). Email end-to-end: drop a message into `Ledgr Import`, run `POST /api/email/import` (or wait for the 30-min poll) — it should become an Inbox note (or a task if the subject starts `task:`).

---

## 1d. Todoist setup (OPTIONAL adapter — Phase 2; superseded as default by native tasks, ADR-073/081)
> **Tasks are native by default (ADR-073/081).** Ledgr owns tasks end to end — recurrence (ADR-076), scheduling/reschedule (ADR-077), the Top-3 focus layer (ADR-078), reminders via the published ICS feed (ADR-079, §1h), and offline capture (ADR-080). The **`tasks` provider seam** (`src/lib/tasks/provider.ts`) reports the active adapter at `/health` `checks.tasksAdapter`. **Brandon's instance runs `native`** (the default — `TASKS_ADAPTER` unset), so the Todoist sync endpoints/crons **no-op cleanly** (`{ok:true, skipped:true, adapter:"native"}`, 200) and nothing below needs setting up. **Todoist stays an optional adapter** for an instance that wants it (Tyler's): set **`TASKS_ADAPTER=todoist`** *and* `TODOIST_TOKEN`, then follow the steps below. The Todoist code is unchanged — this is a config flip, not a rewrite (Phase-4 packageable).

Todoist sync (ADR-026) pushes dated tasks out and syncs completions + date changes back; the webhook is the real-time path and a 3h GitHub Actions poll is the backstop. With the native adapter (the default) the cron returns `skipped: true` and `/health` `lastTodoistSyncAt` stays null — both expected, not an error.

1. **API token:** Todoist → Settings → Integrations → Developer → copy the API token → set `TODOIST_TOKEN` in Vercel and `.env.local`.
2. **Webhook (real-time completions/edits):** create a Todoist app at the [App Management console](https://developer.todoist.com/appconsole.html). Copy the app's **client secret** → `TODOIST_CLIENT_SECRET` (used to verify the webhook HMAC). Configure the webhook callback URL to `https://ledgr-teal.vercel.app/api/todoist/webhook` and subscribe to `item:completed`, `item:updated`, `item:added`. (The route verifies the `X-Todoist-Hmac-SHA256` signature itself; it's the one Clerk-public Todoist route.)
3. **Owner (optional):** `TODOIST_OWNER_UPN` only if the Todoist account's email differs from `ONEDRIVE_EXPORT_UPN`; otherwise leave unset.
4. **Cron token:** the 3h poll (`.github/workflows/todoist-sync.yml`) uses the same `LEDGR_CRON_TOKEN` repo secret as calendar-sync (Brandon-step 8 / §3).
5. **Verify:** create a Ledgr task with a due date → "sync now" (`POST /api/todoist/sync` from a signed-in console) → it appears in Todoist with a link back. Complete it in Todoist → next sync (or the webhook) marks it done in Ledgr. A task created in the Todoist inbox imports into Ledgr's Inbox on sync.

---

## 1e. Web Push notifications setup (one-time, Brandon — Phase 2)
> **✅ Completed 2026-06-20.** VAPID keys set in Vercel; the Home "Enable notifications" toggle is live (push configured).

Push notifications (ADR-034) send the morning agenda summary and meeting-prep-ready notices. The protocol is hand-rolled over `node:crypto` (no `web-push` dependency); all it needs is a VAPID keypair. Until the keys are set, `/api/push` reports `{configured:false}` (the Today toggle stays hidden) and the notify crons return a 503 (reported, not red-spamming).

1. **Generate the keypair:** `node scripts/make-vapid-keys.mjs` → prints `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. The keypair is permanent (rotating it invalidates every existing subscription — they'd re-subscribe), so generate once and keep it.
2. **Set the env vars** in Vercel production (dashboard or REST API, not piped CLI — BOM gotcha §1) and in `.env.local`, redeploy.
3. **Cron tokens:** the morning-agenda cron runs on Vercel (`vercel.json`, daily 11:00 UTC) and rides the existing `CRON_SECRET`. The hourly meeting-prep cron runs on GitHub Actions (`.github/workflows/notify-prep.yml`) and uses the same `LEDGR_CRON_TOKEN` repo secret as calendar/email sync (§2a). No new token needed.
4. **Subscribe + verify:** open Today on the installed PWA (push needs the production-registered service worker — it won't work in `next dev`), click **Enable notifications**, accept the browser prompt. Confirm a row lands (`select count(*) from push_subscriptions;`) and `/health` shows `lastAgendaNotifyAt`/`lastPrepNotifyAt` once the crons run. Force a send now: `curl -H "Authorization: Bearer <cron token>" https://ledgr-teal.vercel.app/api/machine/notify-agenda` → a notification should arrive (the day-guard means it sends once/day; clear `notify:agenda` in `job_state` to re-test). Task *reminders* stay Todoist's job by design (PRD §4.5).

---

## 1f. Claude MCP server setup (one-time, Brandon — Phase 3)
> **✅ Completed 2026-06-20.** `mcp`-scoped token in `LEDGR_API_TOKENS`; `/health` `checks.mcp` green; `list_types` verified live.
> **Update (ADR-117):** the consumer "Add custom connector" dialog is OAuth-only (no custom-header field), so a static-token MCP can't be added there directly. Ledgr now runs an in-app OAuth shim, so **claude.ai web + the Claude mobile apps connect natively over OAuth** — set `LEDGR_OAUTH_SECRET` (step 3a) and add the endpoint URL as a custom connector, no token needed. The old `mcp-remote` Desktop workaround still works but is no longer necessary. Claude Code uses the manual-header path (step 3b).

The MCP server (ADR-047) makes Claude a first-class client: from Claude desktop/web/mobile you can search, read, create, and update your Ledgr items over a personal API token (PRD §5.5) — "what's open with Roger," "file this as a task due Friday," "prep tomorrow's 1:1." It's an **in-app** endpoint at `POST /api/mcp` (Streamable HTTP — no separate server to host or keep warm), gated by a scoped machine token, never Clerk. Until a token exists the endpoint 401s every call; `/health` `checks.mcp.configured` is the canary.

1. **Issue a token:** `node scripts/make-token.mjs claude-mcp mcp` prints the raw token (`lgr_…`, shown once — keep it for the client) and the `LEDGR_API_TOKENS` entry. Append the entry, comma-separated, to `LEDGR_API_TOKENS` in Vercel (and `.env.local`), redeploy. The token's scope is `mcp`; it grants only the MCP endpoint, nothing else.
2. **Owner:** the server resolves your `users` row from `LEDGR_MCP_OWNER_UPN`, falling back to `ONEDRIVE_EXPORT_UPN` (the same person), so if the export is set up (§1b) there's nothing to do here. Set `LEDGR_MCP_OWNER_UPN` only if the MCP identity ever differs from the export mailbox.
3a. **Enable the OAuth shim (for phone / claude.ai — ADR-117):** set `LEDGR_OAUTH_SECRET` to a high-entropy string (`openssl rand -hex 32`) in Vercel (and `.env.local`), redeploy. Then in Claude → Settings → Connectors → Add custom connector, paste just the endpoint URL `https://ledgr-teal.vercel.app/api/mcp` (no token field): Claude discovers the OAuth flow, you approve with a Microsoft sign-in (only the owner can — the authorize step is Clerk-gated), and the connector is then available on web, desktop, and mobile (connectors are account-level). Verify discovery is live with `curl https://ledgr-teal.vercel.app/.well-known/oauth-protected-resource` (200 JSON when configured, 404 when not).
3b. **Connect a manual-token client (Claude Code / Desktop):** `claude mcp add --transport http ledgr https://ledgr-teal.vercel.app/api/mcp --header "Authorization: Bearer <raw token>"`, or a remote MCP server entry with the same URL + header. The server is stateless and request/response only (no SSE stream), which every Streamable-HTTP client supports. This path uses the `mcp`-scoped token from step 1, independent of the OAuth shim.
4. **Verify:** `/health` `checks.mcp` should read `{configured:true, hasToken:true, ownerResolves:true}`. From the client, ask Claude to "list my Ledgr types" (`list_types`) or "what tasks are open" (`list_items`). The six tools: `search_items`, `list_items`, `get_item`, `create_item`, `update_item`, `list_types`.
5. **Revoke:** delete the `claude-mcp` entry from `LEDGR_API_TOKENS`, redeploy (same flow as any machine token, §3). Rotate on any suspicion of leak — a token is the only credential on this endpoint.

## 1g. Changelog + shared collab notes (one-time, per builder — ADR-053)
> **✅ Completed 2026-06-20.** Fine-grained `GITHUB_TOKEN` (Contents R/W on `strategicli/ledgr`) set in Vercel; `/health` `checks.github` is `{ok:true}`.

The Changelog page (in the kebab "More" menu) reads the repo's commit history live, and a shared notes scratchpad beside it reads and commits a notes file in the repo. Git is the shared medium across the two separate deploys, so both builders see each other's pushes and notes. Until a token is set the page shows a "not connected" note; `/health` `checks.github` is the canary.

1. **Issue a token:** GitHub → Settings → Developer settings → Personal access tokens. A classic token with `repo` scope, or a fine-grained token scoped to `strategicli/ledgr` with **Contents: Read and write** (read powers the changelog, write powers the notes commits).
2. **Set env:** `GITHUB_TOKEN` in Vercel (and `.env.local`). `GITHUB_REPO` defaults to `strategicli/ledgr` and `GITHUB_BRANCH` to `main`; set them only if yours differ. Redeploy.
3. **Avoid rebuild churn (optional):** every notes Save commits the notes file, and a commit to the deploy branch triggers a Vercel build. To keep note edits from redeploying, set `GITHUB_NOTES_BRANCH="collab-notes"` (auto-created from `GITHUB_BRANCH` on first write, not deployed). Default leaves notes on the deploy branch.
4. **Verify:** `/health` `checks.github` reads `{configured:true, ok:true, repo:"…"}`. Open the Changelog from the kebab — recent commits list with file/line counts; the notes panel loads, Save commits, Clear empties.
5. **Rotate/revoke:** delete or regenerate the PAT on GitHub and update `GITHUB_TOKEN`, redeploy (§3).

---

## 1i. Meeting transcription setup (one-time, OPTIONAL — meeting recording v1b, ADR-088/089)
Pasting a transcript onto a meeting needs no setup (v1a). To also **upload audio and have Ledgr transcribe it** (v1b), set a transcription adapter:

1. **Get a key:** AssemblyAI dashboard → API key. Set `ASSEMBLYAI_API_KEY` (Vercel env + `.env.local`). `/health` `checks.transcription` flips `none`→`assemblyai`, and the meeting's Transcript panel shows **↑ Upload audio to transcribe**.
2. **How it flows:** upload audio → it lands in R2 (presigned, same as image paste; 2GB AV cap) → a `transcript` child is created and the audio URL is submitted to AssemblyAI → the panel polls `/api/transcription/[id]/status` live while you're on the page, and `.github/workflows/transcription-poll.yml` (every 15 min, `LEDGR_CRON_TOKEN`) finishes any you navigated away from → the transcript body fills with diarized text and enters the **"Transcripts awaiting minutes"** view (then run the minutes automation, `docs/meeting-minutes-automation.md`).
3. **Retention:** once a transcript is produced, the audio is stamped `purge_after = now()+30d` and the daily purge (`/api/machine/purge`) reclaims the bytes — audio is transient, the transcript is what's kept. `DELETE /api/attachments/[id]` deletes audio now. **Compression is deferred** (AssemblyAI takes long files by URL; no ffmpeg on Vercel) — a knob behind the seam if storage ever bites.
4. **Disable:** unset `ASSEMBLYAI_API_KEY` (or set `TRANSCRIPTION_ADAPTER=none`). The upload control disappears, paste still works, the poll cron no-ops (`{skipped:true}`).

---

## 1h. Running Ledgr locally (the dev loop)
The whole app runs on your own machine — Next.js + the codebase on disk, the DB on Neon (or local Postgres) via `DATABASE_URL`. This is the everyday build loop (watch Claude's edits live without waiting on a Vercel deploy) and is also the seed of the "the app and the data are user-owned, this can't be taken" posture (`explorations/local-first-split.md`). Running locally just means you see changes before they ship (see §1j for how they ship).

1. **First time:** clone the repo, `npm install`, copy `.env.example` → `.env.local` and fill it (at minimum `DATABASE_URL`; `DEV_USER_EMAIL` lets you sign in without Microsoft/Clerk locally — §1, ADR-006). If your machine has no local login yet, the dev-auth stand-in creates one from `DEV_USER_EMAIL`.
2. **Run it:** `npm run dev` (default `http://localhost:3000`; if 3000 is taken by another app it serves on `3001`, etc.).
3. **After every `git pull`:** `npm run db:migrate` — migrations are committed but each machine applies them to its own DB separately (this is the §7 `templates`/`relation does not exist` failure mode; same discipline as §1a).
4. **Offline / mobile caching (design note, "Netflix model"):** the PWA's offline reach is meant to be **user-selectable per type** (pick which types are cached for offline — e.g. always cache sermons before Sunday), with desktop caching everything. This sharpens the Sunday-proof story (rule #2); it's a caching-strategy direction, not yet a built setting.
5. **Storage watch:** Markdown is tiny (thousands of notes ≈ ~1GB), so the only meaningful storage cost is **images** (presentation images ~2MB each, scanned PDFs) — keep those on R2/CDN, not inline, and watch the per-user quota.

---

## 1j. Deploying to production (the release flow)

**`main` is the shared integration line and deploys nobody — merging to `main` is safe.** Brandon and Tyler run separate single-tenant instances, so each has their **own Vercel production branch** (`prod-brandon` / `prod-tyler`), a pure pointer to `main` that is what Vercel actually deploys. A PR merged to `main` just lands code on the integration branch; there is no production build triggered and nothing to "verify READY" from the merge itself. (Never commit directly to a `prod-*` branch — it's a pointer, not a work branch.)

**Deploy with `npm run release:prod`** (`scripts/release-prod.mjs`), which does the whole thing in order and aborts before prod on any red gate:

1. **preflight** — clean working tree + `git fetch`.
2. **ff-merge** — fast-forward the deploy branch (`prod-brandon` by default; Tyler sets `RELEASE_TARGET_BRANCH=prod-tyler`) to `origin/main`.
3. **dev + gates** — migrate the **dev** Neon branch first (canary), then `lint`, `build`, and the core `verify-*` scripts against dev; **abort on the first failure** so a red gate can't reach prod.
4. **migrate prod** — `npm run db:migrate:prod` (prod creds come only from `.env.production.local`, gitignored — never `.env.local`).
5. **push** — push the deploy branch → Vercel builds and deploys.

Confirm the deploy reached `READY` via the Vercel MCP (`get_deployment` on the `prod-*` push, `target: production`; the build lags the push ~60–90s) or the public `/health` endpoint. Migrating dev-before-prod means every migration is exercised by the verifies before it touches production. Posture is **be deliberate with production** (§0, ADR-119): additive/reversible changes, lean on the safety net. A deploy-model ADR is still to be written.

---

## 2. Health and monitoring
- **`/health`** checks: DB reachable (`database`), `lastExportAt` (last export run with zero item errors and nothing remaining), `lastExportRunAt` (last attempt of any outcome), `graph` (app-only Graph token grant; see below), and `errors.last24h` (count of `error_log` rows captured in the last 24 hours; should be 0). The Todoist API check joins once that integration exists.
- **`checks.graph`** (slice 21, ADR-022) is the canary for every unattended Graph job (export, calendar, email-in): `{configured:false}` until the registration is set (§1b), `{configured:true, ok:true}` when an app-only token grant succeeds (proving the client secret is valid and unexpired), `{configured:true, ok:false, detail}` when it fails — the **secret-expiry / revoked-consent alarm**. It is a token grant only, not a resource call, so it stays green even before the calendar permission is granted (§1c); it never changes overall `/health` status (Graph down must not make the app look unhealthy — the DB is what "healthy" means).
- A stale `lastExportAt` while `lastExportRunAt` advances = runs are happening but failing partway; check `error_log` (source `export`).
- **`lastCalendarSyncAt` / `lastCalendarRunAt`** (slice 22) mirror the export pair for the 6h calendar poll: `lastCalendarSyncAt` is the last error-free run, `lastCalendarRunAt` the last attempt. Both null = the GitHub Actions poll never reaches the endpoint (missing `LEDGR_CRON_TOKEN`, §2a) or Calendars.Read isn't granted (§1c, the 403 path). A stale sync while runs advance = events failing partway (`error_log` source `calendar-sync`).
- **`lastTodoistSyncAt` / `lastTodoistRunAt`** (slice 25) are the same pair for Todoist. Both null = `TODOIST_TOKEN` unset (§1d) or the poll never reaches the endpoint. `error_log` sources `todoist-sync` / `todoist-sync-now` / `todoist-webhook`.
- **`lastEmailImportAt` / `lastEmailRunAt`** (slice 26) are the same pair for email-in. Both null = `Mail.ReadWrite` not granted / the `Ledgr Import` folder missing (§1c, the 403/404→503 path) or the poll never reaches the endpoint. `error_log` source `email-import`.
- **`lastAgendaNotifyAt` / `lastPrepNotifyAt`** (slice 30) are the last clean morning-agenda send and meeting-prep-ready run. Both null = VAPID keys unset (§1e, the 503 path) or the crons never reach the endpoint (agenda needs `CRON_SECRET`, prep needs `LEDGR_CRON_TOKEN`). `error_log` sources `notify-agenda` / `notify-prep`.
- **`checks.mcp`** (slice 36, ADR-047) is the MCP-server canary: `{configured:true, hasToken:true, ownerResolves:true}` once an `mcp`-scoped token exists and the owner UPN resolves to a `users` row (§1f). Both false until setup; like `checks.graph` it never changes overall `/health` status. `error_log` source `mcp`.
- **`checks.transcription`** (ADR-088) reports the active transcription adapter: `none` (paste-only, the default) or `assemblyai` (audio upload → auto-transcribe enabled, §1i). Informational, like `checks.tasksAdapter`; never changes overall status.
- **`checks.github`** (ADR-053) is the canary for the Changelog + collab notes: `{configured:false}` until `GITHUB_TOKEN` is set (§1g), `{configured:true, ok:true, repo}` when a repo read succeeds (token valid, repo reachable), `{configured:true, ok:false, detail}` when it fails (expired/revoked token or wrong repo). Like `checks.graph`/`checks.mcp` it never changes overall `/health` status.
- **`checks.healthCheck`** (slice 37, ADR-052) is the weekly self-monitor's record: `{lastRunAt, lastSuccessAt, lastAlertAt, alerts[]}`. `alerts` holds the most recent run's findings (empty when green); `lastSuccessAt` advances only on a clean run, `lastAlertAt` only when something needed attention. The weekly job (`/api/machine/health-check`, §2a) reads the same canaries above, decides what genuinely needs attention (DB down → critical; captured errors over the last 7 days; a Graph-secret-expiry; a *stalled* — not merely unconfigured — cron), and pushes Brandon **only on failure** (PRD §6.2; delivery is Web Push, the channel Ledgr already has — `email-out` isn't built). Findings are recorded to `job_state`, never `error_log`, so the "captured errors" rule can't feed back on itself. `error_log` source `health-check` is only the route's own unexpected faults.
- The export-timestamp check is the canary for a **silently stalled sync** (see §6, GitHub Actions auto-disable).
- **Structured logs (ADR-020):** every server-side event is one JSON line `{ts, level, source, correlationId, message, ...}` via `src/lib/log.ts`; read them in Vercel → Project → Logs. One correlation id covers one request/job run, and 500 responses echo it (`{"error":"internal error","correlationId":"…"}`), so a screenshot of a failure can be grepped straight to its lines and its `error_log` row.
- **Error capture:** `captureError(source, err)` logs *and* inserts into `error_log` (sources so far: `api`, `export`, `export-now`, `purge`). It never throws and survives DB-down (the console line still exists). Query: `select created_at, source, message, correlation_id from error_log order by created_at desc limit 20;`. `error_log` rows are kept indefinitely for now; prune by hand if it ever matters.
- **Debug mode** = `DEBUG_MODE=true` env (set in Vercel env or `.env.local`, redeploy/restart). On: `/health` includes the 5 most recent captured error messages (`errors.recent`) and DB-check failures show the real exception text. Off (default): counts only, generic messages. The per-session UI toggle joins when the Build surface lands.
- No silent failures, ever: anything that fails in a cron, webhook, or API route must end up in `error_log` and the logs, never swallowed.

---

## 2a. Scheduled jobs
| Job | Schedule | Endpoint | Auth |
|---|---|---|---|
| Trash purge (hard-deletes items in Trash > 30 days; child rows cascade) | daily 08:00 UTC (`vercel.json`) | `GET /api/machine/purge` | Vercel sends `Bearer $CRON_SECRET`; `CRON_SECRET` holds the raw `vercel-cron` token (`cron` scope) so platform crons use the ADR-004 machine-token scheme (ADR-005) |
| OneDrive export (incremental, ≤100 items/run; on-demand twin is `POST /api/export`, user-authed) | daily 06:30 UTC (`vercel.json`) | `GET /api/machine/export` | same `Bearer $CRON_SECRET` path |
| Calendar sync (poll next 14 days → meeting items; on-demand twin is `POST /api/calendar/sync`, user-authed) | every 6h (`.github/workflows/calendar-sync.yml`) | `GET /api/machine/calendar-sync` | GitHub Actions sends `Bearer ${{ secrets.LEDGR_CRON_TOKEN }}` (a `cron`-scope machine token, §3) |
| Todoist sync (polling backstop to the webhook; push dated tasks, pull completions/dates/inbox; twin is `POST /api/todoist/sync`) | every 3h (`.github/workflows/todoist-sync.yml`) | `GET /api/machine/todoist-sync` | same `Bearer $LEDGR_CRON_TOKEN` path. Real-time path is `POST /api/todoist/webhook` (HMAC-verified, no token) |
| Email-in (poll "Ledgr Import" folder via messages/delta → note/task items; twin is `POST /api/email/import`) | every 30 min (`.github/workflows/email-import.yml`) | `GET /api/machine/email-import` | same `Bearer $LEDGR_CRON_TOKEN` path |
| Morning agenda push (today's meeting/task count → Web Push; once/day, day-guarded) | daily 11:00 UTC (`vercel.json`) | `GET /api/machine/notify-agenda` | same `Bearer $CRON_SECRET` path |
| Meeting-prep-ready push (meetings due within 2h with a confirmed entity → Web Push, once per meeting) | hourly (`.github/workflows/notify-prep.yml`) | `GET /api/machine/notify-prep` | same `Bearer $LEDGR_CRON_TOKEN` path |
| Weekly health check (read the `/health` canaries, push Brandon on failure; ADR-052) | weekly Mon 13:00 UTC (`.github/workflows/health-check.yml`) | `GET /api/machine/health-check` | same `Bearer $LEDGR_CRON_TOKEN` path |

- **Run manually:** `curl -H "Authorization: Bearer <cron token>" https://ledgr-teal.vercel.app/api/machine/purge` → `{"ok":true,"purged":N,"detached":M,...}`. Calendar: `curl -H "Authorization: Bearer <cron token>" https://ledgr-teal.vercel.app/api/machine/calendar-sync` → `{"ok":true,"created":N,"updated":M,"canceled":K,...}`, or `gh workflow run calendar-sync`.
- **Failures** are written to `error_log` (sources `purge`, `export`, `calendar-sync`, with correlation id) and logged as structured JSON; check Vercel → Project → Logs, or query `error_log`. A calendar **403** before §1c is done is reported as a 503 and a warn log (not an `error_log` row), so it doesn't spam the table; `/health` `lastCalendarSyncAt` staying null is the canary.
- **Inspect/verify the schedule:** Vercel dashboard → Project → Settings → Cron Jobs (Vercel crons), and GitHub → Actions → calendar-sync / backup (Actions crons, last run + status).
- Vercel Hobby cron is daily-only, so the 6h calendar poll runs from GitHub Actions hitting the authenticated endpoint — the scheduler interface the PRD chose, swappable for a local cron in Phase 4. **Needs the `LEDGR_CRON_TOKEN` repo secret** (a `cron`-scope token; one cron token can also serve the backup's failure-report `LEDGR_ERROR_TOKEN`). Issue with `node scripts/make-token.mjs gh-actions cron`, append the entry to `LEDGR_API_TOKENS` in Vercel + redeploy, and set the raw value as the `LEDGR_CRON_TOKEN` GitHub repo secret.

---

## 3. Token and secret rotation
- **Azure app-only client secret** (`ledgr-export` registration, §1b/§1c) has an expiry — track it as a calendar reminder. One secret now serves export, calendar, and email-in, so its expiry stalls all three; `/health` `checks.graph` flips to `{ok:false}` when it lapses (the alarm). Rotate: app registration → Certificates & secrets → new secret, update `GRAPH_CLIENT_SECRET` in Vercel, `.env.local`, and the GitHub repo secret (the backup's OneDrive leg uses it too, §4), redeploy, run an on-demand export (§1b step 6) and confirm `/health` `lastExportAt` advances and `checks.graph` is `{ok:true}`, then delete the old secret.
- **Ledgr API tokens** (MCP/cron/webhooks) are scoped and revocable; only SHA-256 hashes are stored (in `LEDGR_API_TOKENS`), so a leaked env dump yields nothing usable. Rotate on any suspicion of leak.
  - **Issue:** `node scripts/make-token.mjs <name> <scope,scope,…>` prints the raw token (give to the caller, e.g. a GitHub Actions secret; it is never stored server-side) and the env entry. Append the entry, comma-separated, to `LEDGR_API_TOKENS` in Vercel (Project → Settings → Environment Variables), redeploy.
  - **Revoke:** delete that token's entry from `LEDGR_API_TOKENS`, redeploy. The token is dead the moment the new deployment serves.
  - **Verify either way:** `/api/machine/ping` with the token returns 200 + its name/scopes when live, 401 when revoked.
  - Current tokens: `claude-diag` (scope `diag`, only grants ping; raw value in `.env.claude-diag.local` locally, used by Claude Code to verify machine auth in production); `vercel-cron` (scope `cron`; raw value lives only in the production `CRON_SECRET` env var, added 2026-06-12). Rotating `vercel-cron` = issue a new token, replace both its `LEDGR_API_TOKENS` entry and `CRON_SECRET`, redeploy.
- **`LEDGR_OAUTH_SECRET`** (the MCP OAuth shim, ADR-117) signs every OAuth authorization code, access token, refresh token, and client_id — nothing is stored server-side, so the secret IS the credential. **Rotating it is the revocation kill switch:** set a new value in Vercel, redeploy, and every previously issued OAuth token dies at once (a connected phone/web just re-approves with a sign-in). Scope of the blast radius: it affects **only** the OAuth-connected Claude clients (claude.ai web + mobile). It does **not** touch the static `LEDGR_API_TOKENS` clients (Claude Code/Desktop, the HTTP API, the clipper, crons — those rotate via the entry above), and nothing about non-Ledgr connectors. There is no per-token revocation by design (single-user); rotate the secret to revoke. Verify with `curl https://ledgr-teal.vercel.app/.well-known/oauth-protected-resource` (200 when configured) and an unauthenticated `POST /api/mcp` (401 carrying a `WWW-Authenticate` header).
- **Clerk / R2 / Todoist keys:** rotate from each provider's dashboard, update Vercel env, redeploy, verify `/health`.
- **Clerk sign-up policy:** the allowlist identifier (`brandoncollins@edgewoodcommunity.org`, via `POST /v1/allowlist_identifiers`) has existed since early setup, but **allowlist enforcement itself was never on** — verified 2026-07-01 via `GET /v1/allowlist_identifiers` (one entry, correct) vs. `PATCH /v1/instance/restrictions {"allowlist":true}` (422: blocked because **sign-up mode was "waitlist,"** not "restricted" — Clerk won't enable the allowlist under waitlist mode). Net effect: new sign-ups weren't silently open (waitlist mode queues them, doesn't grant access — confirmed zero pending entries via `GET /v1/waitlist_entries`), but it also wasn't "only me." The instance secret key can read/write `/v1/instance/restrictions` and `/v1/allowlist_identifiers` directly (`curl -H "Authorization: Bearer $CLERK_SECRET_KEY"`), but **switching sign-up mode is not reachable that way** — the Clerk CLI's `config`/`apps`/`whoami` commands (which can) require `clerk auth login` (interactive) or a `CLERK_PLATFORM_API_KEY` (a separate platform-level key, not the per-instance secret), neither available headlessly. Fix is a one-time manual step: Clerk dashboard → Configure → Restrictions → set **Sign-up mode → Restricted** → Save; then re-run the `allowlist:true` PATCH (or toggle Allowlist on in the same dashboard page) to lock it in. Only one Clerk user exists (Brandon, Microsoft OAuth) as of this check — no unauthorized accounts were created while this was open.
- After any rotation, confirm `/health` is fully green before walking away.

---

## 4. Backups and restore
- **Content:** nightly OneDrive markdown export (`/Ledgr/Export/{type}/{year}/{slug}-{id8}.md` + YAML frontmatter; trashed/archived items under `/Export/_archive/`, attachment copies under `/Export/_attachments/`) plus on-demand exports (`POST /api/export`, Pulpit Ready's hook).
- **Everything else:** weekly `pg_dump` of the full DB (relations, revisions, metadata) via the GitHub Actions `backup` workflow (`.github/workflows/backup.yml`, Fridays 05:00 UTC so a fresh dump precedes every Sunday). The dump (`--format=custom --no-owner --no-privileges`; Neon's roles aren't portable) is uploaded to **OneDrive `/Ledgr/Backups/`** (private; the sole destination). It is **not** kept as a GitHub Actions artifact: the repo is public (ADR-101) and public-repo artifacts are downloadable by any signed-in user, so a full DB dump must never land there (ADR-103). The four Graph secrets (`GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET`/`ONEDRIVE_EXPORT_UPN`) are **required** repo Actions secrets — a missing one fails the run. This is the real restore path (free-tier Postgres PITR is thin).
- **Run a backup now:** `gh workflow run backup --field job=backup` (or Actions tab → backup → Run workflow). Failures email Brandon (GitHub default) and, when the `LEDGR_ERROR_TOKEN` repo secret is set (a cron-scope token, §3), also land in `error_log` via `POST /api/machine/report-error`.
- **Attachments:** R2 is durable on its own; OneDrive export holds a second copy.
- **Restore test (automated):** `gh workflow run backup --field job=restore-test` dumps production, restores into a throwaway Postgres 17 container, and diffs per-table row counts. **Run green 2026-06-12** (9 tables, all counts matched), so the dump format is proven restorable. Re-run after any schema change that touches extensions or generated columns.
- **Real restore procedure** (tested mechanics; the Neon leg differs only in the target):
  1. Download the newest `ledgr-backup-*` artifact (Actions tab) or grab the OneDrive copy.
  2. Provision a fresh Neon DB (or branch); take its **direct** (non-pooler) URL.
  3. `pg_restore --no-owner --no-privileges --exit-on-error -d "<direct url>" ledgr-<date>.dump` (client major version must be ≥ server's).
  4. Point `DATABASE_URL` (the **pooler** URL of the new DB) at it in Vercel, redeploy.
  5. Verify `/health`, spot-check recent items, confirm the nightly export resumes (`lastExportRunAt` advances).
- **An untested backup is a hope, not a backup.** The first test ran 2026-06-12; keep it green.

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

## 6a. Fragile areas (regressed more than once, check before merging)
These have each broken again after being fixed, so treat them as the usual suspects behind "this used to work." When a change could plausibly touch one, re-check it before you merge.
- **Styling / CSS load ("randomly unstyled content").** Sections sometimes rendered unstyled after a reload (plus a dark-scrollbar flash), and the heavy/light/unified style setting has failed to persist. The unstyled-flash was root-caused to non-deterministic CSS chunk ordering and fixed via strict `cssChunking` + a global `color-scheme` (PR #131, 2026-06-30); if it recurs, start there. After any change to global styles, the style setting, or the style-load path, hard-reload a few times and confirm styles hold and the setting saves.
- **Quick-add item-type coverage.** Quick-add is meant to create any item type and has silently regressed to tasks-only. After touching quick-add or the create flow, add one of each non-task type through it.
- **Lens interactions.** Lens work has broken unrelated surfaces (it once killed the upcoming-meetings calendar click-to-add), and lenses don't apply cleanly to meetings or to the tasks-of-a-meeting. After changing lenses, click through the calendar add and the meeting/task views before merging.
- **Mobile markdown editor.** Indent and the toolbar have gone off-screen on mobile, fixed before and regressed since. Test any editor or toolbar change at mobile width, not just desktop.
- **Favorites popup.** Has broken mid-change before; after touching nav or favorites, confirm it still opens.
- **The Desk reuses two fragile pieces (ADR-146).** Its panels mount the shared `ItemEditor` (the focused/writer panel) and the dashboard `RglInner` grid (read-only, `editMode=false`). A change to either — or to `ItemEditor`'s save path / the `onLiveChange` tap, or the dashboard resolver in `src/lib/dashboard-resolve.ts` — should be re-checked in a Desk panel: open the same item in two panels and confirm one editor + one live preview (a single PATCH stream, no clobber), and open a dashboard panel and confirm it renders static with real (date-formatted) data. The Desk is desktop-only (`/desk` below 640px is a plain tab list).

---

## 7. Common fixes *(stub: append real incidents and resolutions as they happen)*
Format each entry: symptom → cause → fix → prevention. Building this log over time is what keeps maintenance incidents under an hour.

- **Build surface (`/build`, `/build/templates`) 500s with `NeonDbError: relation "templates" does not exist`** (2026-06-14). *Symptom:* clicking the floating Build button throws on a query against `templates` (also any page calling `listTemplates`). *Cause:* migration `0009_square_maddog.sql` (the item-templates slice, ADR-045) was committed but never applied to the local `ledgr_dev` Neon database, so the code expected a table the DB didn't have. *Fix:* `npm run db:migrate`. *Prevention:* run `npm run db:migrate` after any pull that adds files to `drizzle/` (see §1a).

---

## 8. Phase 4 readiness (provider-interface seams, confirmed slice 32)
Phase 4 (a packageable local / self-hosted build) is gated and exploratory (roadmap), but the seams that keep it a *packaging* exercise rather than a rewrite are confirmed and enforced. `scripts/verify-provider-seams.mts` (run it after touching auth, storage, or any `/api/machine` route) fails loudly if a boundary breaks. What swaps where:

- **Auth (Clerk → local single-user):** the app reaches identity only through `authProvider.getCurrentUser()` (→ `resolveOwner` → `requireOwner`). `@clerk/nextjs` is imported in exactly four files — `src/lib/auth/clerk.ts` (the provider), `src/lib/auth/provider.tsx` (the React wrapper, with a no-key fallback), `src/proxy.ts` (route-protection middleware), and the sign-in page. The active provider is chosen in **one place**, `src/lib/auth/index.ts`. A local build adds a ~10-line `localAuthProvider` (returns the single user) and selects it there; the dev stand-in (`DEV_USER_EMAIL`, ADR-006) already proves the shape. Nothing else changes.
- **Scheduler (Vercel cron + GitHub Actions → local cron):** every scheduled job triggers an authenticated `GET /api/machine/*` with a `cron`-scoped machine token. The scheduler is interchangeable because the contract is just "authenticated HTTP call to a machine endpoint" — a local cron runs the identical `curl -H "Authorization: Bearer <token>" …`. All `/api/machine` endpoints verify their own token (the guard asserts this), so a local cron needs no new auth path.
- **Storage (R2 → local FS):** bytes go through the `StorageProvider` interface (`src/lib/storage/`); `aws4fetch`/the R2 client is confined there (guard-asserted). A local FS provider implements the same `putObject`/presign surface.
- **DB (Neon → local Postgres):** already portable — a `DATABASE_URL` change. The pooler guard in `src/db/index.ts` exempts non-Neon hosts, so a local Postgres connects directly.
- **Graph / Todoist / Web Push:** off or stubbed in a local build (each is already behind an interface — `CalendarSource`/`MailSource`/`ExportTarget`/`TodoistClient`/`PushSender` — and each has a stub used in verification).

Confirmed 2026-06-13 (ADR-036): no gaps; the audit added the guard, not code changes.
