# next_steps.md: Ledgr Work Queue

The live, near-term work queue. Start here each session. When you finish a slice, move it to "Recently done," pull the next item up, and check its box in `roadmap.md`.

**Current state (2026-06-12, late night):** Four slices landed this session. **Brandon's field-discipline feedback is in (ADR-018):** status, due date, urgency, and the Subtasks section are task-only in the UI now; other types show only their own core fields, and quick capture hides due/urgency unless the type is task. **Pulpit Ready is live (ADR-019):** every canvas has the button — export-now (reports honestly until the Azure registration exists), a verified offline pin ("cached ✓" only after a cache round-trip), and a Print/PDF view. **Logging is consolidated (ADR-020):** one JSON-line logger with correlation ids, `captureError` → `error_log`, surfaced as `errors.last24h` on `/health` (messages in debug mode). **Backups are real (ADR-021):** weekly GitHub Actions `pg_dump` → workflow artifact (OneDrive joins after the Azure registration), and the **restore was tested for real** — dump restored into a clean Postgres and every table's row count matched. That closes every Phase 1 box except the OneDrive end-to-end, which is Brandon-step 1.

**Phase 1 is code-complete pending Brandon-steps.** Remaining Phase 1 work is entirely the manual checklist below; the next build work is Phase 2's first slice.

**Brandon-steps (manual checks):**
1. **Azure app registration for the export (~10 min, unblocks the nightly export, Pulpit Ready's OneDrive leg, and the backup's OneDrive copy):** follow runbook §1b (new registration `ledgr-export`, app-only `Files.ReadWrite.All` + admin consent, secret → Vercel env), run the step-6 verify, and eyeball the exported files in OneDrive — opening one in Obsidian also closes the old slice-5 render check. Then add the same four values as **GitHub repo secrets** (`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `ONEDRIVE_EXPORT_UPN`) so the weekly backup also lands in `/Ledgr/Backups/` (runbook §4).
2. **Try Pulpit Ready on something real:** open a sermon/note → Pulpit Ready → expect "cached for offline ✓" (the OneDrive line will say not-configured until step 1). Then turn on airplane mode and reopen that item in the installed PWA — you should get the clean document render. Try the Print/PDF view too.
3. **Install the PWA** (if not done): Android Chrome → Install app; share a link to Ledgr from another app and confirm it lands in the Inbox.
4. (No rush) Attach a custom domain to the R2 bucket and update `R2_PUBLIC_BASE_URL` (runbook §1 "R2 follow-up"); cheaper to do before many images exist.
5. **Try both desktop navs** (the panel icon at the end of the nav bar flips bar ↔ right sidebar). When one wins, say so and Q9 gets closed and the loser deleted.
6. **Live with the keys:** `q` to capture, `Ctrl/Cmd+K` to search; one-line changes if they feel wrong.
7. (Optional, completes failure surfacing) Issue a cron-scope token for GitHub Actions: `node scripts/make-token.mjs gh-actions cron`, append the entry to `LEDGR_API_TOKENS` in Vercel + redeploy, set the raw value as the `LEDGR_ERROR_TOKEN` repo secret. Until then, failed backup runs surface via GitHub's failure emails only.

---

## Next up (in order)

### 21. Phase 2 opener: Microsoft Graph delegated auth (PRD §5.1)
- Interactive delegated OAuth (MFA-capable) for calendar reads, alongside the existing app-only credentials; mailbox-scoped via Application Access Policy.
- This is the foundation calendar sync (next slice after) stands on; design the token storage so refresh-token death is a *visible* /health condition, not a silent stall.
- Worth re-reading PRD §5.1/§6.3 and runbook §1b before starting; decide whether the same Azure registration or a second one carries the delegated flow.

---

## Then (rest of Phase 2, rough order)
Calendar sync (14-day poll via GitHub Actions + sync-now) → matchers config + engine → meeting prep templates → Todoist sync → email-in → view builder → widget dashboard → push notifications → public share links. See `roadmap.md`.

---

## Open decisions to make as we build
- ~~Entity `kind`~~: decided, real column on `items` (ADR-003).
- ~~OneDrive export file scope~~: decided, app-only client credentials (ADR-017).
- ~~Error capture~~: decided, `error_log` table over Sentry (ADR-020).
- Desktop navigation: floating bottom bar vs right sidebar (PRD Q9). Both built behind the same slot model; Brandon picks, loser gets deleted.
- Per-type item templates (tasks/meetings/notes storing property choices + starter content) parked for a later phase (roadmap Phase 3); the meeting-prep template is the Phase 2 forerunner.
- "Project" treatment for subtask-having items: parked in `explorations/project-items.md`.
- See `decisions.md` for the running log and PRD §10/§11 for what's already frozen vs still open.

---

## Recently done
- **Slice 20, weekly backup + tested restore (2026-06-12, ADR-021):** GitHub Actions `backup` workflow (Fridays 05:00 UTC): `pg_dump --format=custom --no-owner --no-privileges` (Neon roles aren't portable) → workflow artifact `ledgr-backup-YYYY-MM-DD` (60-day retention) now, OneDrive `/Ledgr/Backups/` once the §1b secrets exist as repo secrets (skips loudly until then). `restore-test` job dumps production, restores into a Postgres 17 container, diffs per-table row counts — **ran green: 9 tables, all counts matched**, closing the "tested once before Phase 2" gate. New `POST /api/machine/report-error` (cron scope) lets failed Actions runs land in `error_log`; GitHub failure emails cover the gap until its token is issued. Repo secret `DATABASE_URL_UNPOOLED` added (pg_dump needs the direct connection). Two real bugs found by running it: client-16-vs-server-17 abort (PATH override) and `neon_superuser` grants (`--no-privileges`).
- **Slice 19, structured logging + error capture (2026-06-12, ADR-020):** `src/lib/log.ts` — `createLogger(source)` emits one JSON line per event with a per-run correlation id; `captureError` logs + inserts to `error_log` and never throws. Every 500 (user API via `errorResponse`, both export routes, purge) now returns its correlation id. `/health` gained `errors.last24h` (counts always, 5 recent messages when `DEBUG_MODE=true`, which also unlocks real DB-check errors). Error-capture decision settled: `error_log` table, not Sentry (rule 5). Verified 13/13 in `scripts/verify-logging.mts` against Neon + live `/health`.
- **Slice 18, Pulpit Ready (2026-06-12, ADR-019):** `GET /items/[id]/print` renders any document as a self-contained page (pure JSON-walking HTML renderer in `src/lib/print-html.ts`, inline CSS, dark on screen / print-styled black-on-white, mentions as styled names) — one artifact serves all three legs: the PulpitReady button on every canvas (1) POSTs `/api/export` (503 reports "not configured yet" honestly), (2) pins the print HTML + its images into `ledgr-pin-v1` under both the print URL and `/items/[id]`, showing "cached ✓" **only after a cache.match round-trip re-reads the document**, with a pinned-state row and remove control on revisit, (3) Print/PDF via the print view's `@media print` (browser print-to-PDF; no PDF dependency). SW bumped to v2: non-navigation and cross-origin GETs fall back to the pin cache so pinned images serve offline; the SW still never writes item data. Verified: 23/23 renderer checks (`scripts/verify-print.mts`, which also caught an `<h7>` bug), browser end to end (pin + verify + honest 503, print view render, zero console errors), SW v2 manually registered → precache present and the pinned entry answers the exact `cache.match` call the fallback makes (dead-server navigation was verified with identical fallback code in slice 16; airplane-mode-on-the-phone is Brandon-step 2).
- **Field discipline per Brandon (2026-06-12, ADR-018):** status/due date/urgency/Subtasks are task-only in the UI (canvas strip, Fields footer, capture modal, export frontmatter, /items badge, meetings strike-through removed); the columns stay (archive rides `status` for every type and will need its own affordance someday). Custom types get an empty strip until the Build surface. Two future ideas recorded: per-type item templates (roadmap Phase 3) and project-ification of subtask-having items (`explorations/project-items.md`).
- **Slice 17, OneDrive export (2026-06-12, ADR-017):** engine over `ExportTarget` (OneDrive app-only Graph; local-FS for verification), one `updated_at > exported_at` comparison drives edits/renames/archive/restore, paths `/Ledgr/Export/{type}/{year}/{slug}-{id8}.md`, `job_state` + `/health` reporting, nightly 06:30 UTC cron + `POST /api/export`. 21/21 checks. **Real-OneDrive end-to-end awaits the Azure registration (Brandon-step 1).**
- **Slice 16, PWA shell + share target (2026-06-12, ADR-016):** installable PWA, conservative hand-rolled SW (shell only, offline page, pin-cache seam), GET share target → inbox link/task items. Verified on a stand-in production build.
- (Older entries: see git history of this file or `decisions.md`.)
