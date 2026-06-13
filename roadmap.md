# roadmap.md: Ledgr Phasing Tracker

Phase-by-phase checklist derived from PRD §8. Check boxes as slices ship. The point is twofold: progress is visible, and scope discipline holds (what's deliberately *not* in a phase matters as much as what is). When something moves, update `next_steps.md` too.

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done.

---

## Phase 1: Core (build first, live in it)
The goal: a usable single-user tool Brandon can capture into and write in, with the export safety net working.

- [x] Repo scaffold (Next.js on Vercel, Drizzle, Neon via pooler, Clerk, env config) (`/health` green in production 2026-06-12; GitHub push → auto-deploy verified working)
- [x] Data model: `users`, `types` (seed 5 system rows), `items` (incl. `properties` JSONB), `relations`, `attachments`, `revisions`, `views`, `error_log` (see `schema.md`) (migration ran clean on Neon 2026-06-12; all 8 tables, 5 type rows, 1 user row verified)
- [x] Index plan in place (incl. FTS generated `tsvector` column) (all 22 indexes verified on Neon 2026-06-12, incl. `items_search_gin` and `items_properties_gin`)
- [x] Auth: Clerk + Microsoft sign-in; API-token scheme for machine access (done 2026-06-12: Brandon's first Microsoft sign-in landed and `users.clerk_id` is backfilled, verified against Neon; production route protection and machine tokens verified earlier same day)
- [x] Item CRUD (owner-scoped; list queries exclude `body`) (2026-06-12: full REST surface under `/api/items*` + `src/lib/items.ts`; verified against Neon incl. owner scoping, no-body list SQL, cycle guard)
- [x] Block editor (BlockNote): slash commands, headings, lists, checkboxes, quotes, dividers, code; bold/italic/highlight/text colors (2026-06-12: lazy-loaded via `next/dynamic`, verified in-browser incl. autosave; minimal `/items/[id]` host page until the canvas slice)
- [x] Markdown serialization (color/highlight → inline HTML `<mark>`/`<span>`; single mapping table) (2026-06-12: pure server-safe serializer in `src/lib/markdown.ts` + pinned color table in `src/lib/colors.ts`; 22 serializer checks pass; Obsidian eyeball check pending on `scripts/sample-export.md`)
- [x] Paste images inline (stored to R2) (2026-06-12: presign flow + `/api/attachments` + storage interface; R2 provisioned, CORS policy set, live paste confirmed by Brandon — slice 5 fully closed)
- [x] `@`-mention to other items (auto-creates a `relations` row) (2026-06-12: mention inline node + picker; diff-sync to `relations` role `mention` on every body save; verified end-to-end in-browser against Neon)
- [x] Entity pages (related items grouped by type) (2026-06-12: both-directions body-free query in `src/lib/relations.ts` + `GET /api/items/[id]/related`; entity items render a grouped Related section on `/items/[id]`; suggested edges render gray/dashed; 17/17 checks against Neon + browser-verified)
- [x] Parent/child subtasks: recursive tree reads, cycle guard, progress rollup, soft-delete cascade (2026-06-12: subtree + ancestors reads in `src/lib/subtasks.ts` + `GET /api/items/[id]/subtree`; Subtasks checklist with done-toggles, inline add, n-of-m rollups, and ancestor breadcrumb on `/items/[id]`; 21/21 checks against Neon + browser-verified; cycle guard and cascade were slice 4)
- [x] Item canvas: center modal default + expand to full screen; top/bottom field zones, horizontal top strip (PRD §4.13) (2026-06-12: intercepting-route modal at `src/app/@modal`, shared `ItemCanvas`, per-type strip defaults in `src/lib/canvas-fields.ts`; browser-verified end to end)
- [x] Today / dashboard view (batched single fetch; fixed layout, widgets come in Phase 2 per PRD §4.11) (2026-06-12: `/` is now Today — quick capture, today's meetings, due/overdue tasks, recent; one batched fetch in `src/lib/today.ts`, `LEDGR_TIMEZONE` defines the day, ADR-008; interim type-grouped list moved to `/items`)
- [x] Navigation shell: floating bottom bar on mobile (home locked to slot 1, user-assigned slots, badge-count support); desktop bottom-bar vs right-sidebar tested behind the same slot model (PRD §4.12, open Q9) (2026-06-12: slot table in `src/lib/nav.ts` + Nav/NavShell; both desktop candidates live behind an in-nav toggle, ADR-009 — Q9 stays open until Brandon picks)
- [x] Inbox view (untriaged items) (2026-06-12: explicit `items.inbox` flag set by quick capture, cleared by triage, ADR-010; `/inbox` with retype/triage/trash controls; live count badges the nav slot)
- [x] Per-type lists with simple filters (2026-06-12: `/tasks` `/meetings` `/notes` `/links` `/entities` + tab strip, filters carried in the URL over the `ViewFilter` shape a future `views` row stores, ADR-011; Tasks nav slot; Trash stays on `/items`)
- [x] Full-text search (Postgres FTS) filtered by type/entity/date (2026-06-12: `websearch_to_tsquery` over the stored tsvector with `ts_headline` snippets, `/search` + `GET /api/search`, ADR-012; Search nav slot, Ctrl/Cmd+K)
- [x] Quick capture (global affordance, desktop shortcut, title-only) (2026-06-12: nav "New" button + `q` shortcut open the capture modal — title, type, optional due/urgency, always `inbox: true` — ADR-013; share target rides the PWA-shell slice)
- [x] Backlinks panel (traverse `relations` both directions; suggested vs confirmed render) (2026-06-12: `RelatedPanel` on every item canvas — grouped by type, confirm/reject on suggested edges, "+ Relate" typeahead; first relations write path `POST/PATCH/DELETE /api/items/[id]/relations`, ADR-015; entity-at-capture joined the capture modal)
- [x] Soft delete + Trash (30-day purge); revision snapshots + restore (2026-06-12: cascade soft-delete restores as a unit, daily purge cron at `/api/machine/purge`, debounced snapshots capped at 50; Trash *UI* comes with the list views slice)
- [x] PWA shell (installable, responsive) (2026-06-12: manifest + generated icons + conservative SW — shell/static only, never item data, offline fallback page, pinned-cache seam for Pulpit Ready — + GET share target landing URLs as link items and text as tasks, all `inbox: true`, ADR-016; verified on a production build incl. offline navigation and all three share shapes; Brandon installs on his devices)
- [x] OneDrive export (nightly cron + on-demand; `/Export/{type}/{year}/{slug}-{id8}.md` + YAML frontmatter; archive path) (2026-06-12: engine + Graph app-only target + 06:30 UTC cron + `POST /api/export`, ADR-017; 21/21 checks against Neon with the local target; Azure app registration completed 2026-06-12, OneDrive end-to-end live)
- [x] Pulpit Ready action (immediate export + verified offline pin + print-styled PDF) (2026-06-12, ADR-019: self-contained /items/[id]/print render pins into ledgr-pin-v1 under both URLs, cache.match-verified “cached ✓”, print-to-PDF via @media print; OneDrive export leg live after Azure registration 2026-06-12)
- [x] `/health` endpoint (DB, last export timestamp; Todoist/Graph once they exist) (2026-06-12: reports `lastExportAt` — clean runs only — and `lastExportRunAt` from `job_state`; DB check since slice 1; Todoist/Graph checks ride their Phase 2 slices)
- [x] Structured JSON logging + correlation ids; toggleable debug mode (2026-06-12, ADR-020: shared logger, error_log capture surfaced in /health, DEBUG_MODE env toggle)
- [x] Weekly `pg_dump` to OneDrive; restore tested once before Phase 2 (2026-06-12, ADR-021: GitHub Actions weekly dump → artifact now + OneDrive after §1b; restore-test job ran green, all table counts matched)

**Not in Phase 1:** integrations (calendar/Todoist/email), view builder, embedded query views, widget dashboard, MCP server, Build surface (custom-type builder, workflow/wiki templates), sharing.

---

## Phase 2: Integrations + sharing

- [x] Microsoft Graph auth: interactive delegated OAuth (MFA) + app-only client credentials for unattended jobs; mailbox-scoped via Application Access Policy (2026-06-13, ADR-022: shared `src/lib/graph/client.ts` app-only token/fetch, `onedrive.ts` refactored onto it, `/health` `checks.graph` canary; interactive delegated = the existing Clerk+Microsoft sign-in, no new refresh token; 14/14 in `verify-graph-auth.mts` incl. a live token grant; **mailbox `Calendars.Read` + Application Access Policy is a Brandon-step, runbook §1c**)
- [x] Calendar sync (poll next 14 days, default 6h via GitHub Actions + "sync now"); auto-create meeting items; `ms_event_id` dedupe; reschedule/cancel handling (2026-06-13, ADR-023: `calendarView` per-occurrence meetings via the slice-21 app-only client, `CalendarSource` interface, full-window poll, write-only-on-change, cancel flags `properties.calendar.canceled` (never deletes), attendees stored structured + FTS-searchable, calendar arrivals skip the Inbox; `GET /api/machine/calendar-sync` + `POST /api/calendar/sync` + 6h GitHub Actions; 24/24 in `verify-calendar-sync.mts` + a live 403-clean Graph probe; **end-to-end blocked on §1c (Brandon-step 0) and the `LEDGR_CRON_TOKEN` repo secret**)
- [~] Matchers config + engine (attendee email → series id → title regex → `pg_trgm` fuzzy); setup wizard sampling; learn-by-confirmation; suggested/confirmed states (2026-06-13, ADR-024: `matchers` table + `pg_trgm` (migration 0004), engine with fixed kind precedence + fuzzy-as-last-resort gating + confirmed-wins accumulation, `addMatchEdge` never downgrades a confirmed edge, runs on meeting create via a `onCreated` seam, minimal `/api/matchers`; 16/16 in `verify-matchers.mts` against real pg_trgm. **Engine + config + suggested/confirmed states done; setup-wizard UI (needs live calendar, §1c) and learn-by-confirmation UI deferred — see next_steps.**)
- [x] Meeting prep templates (open tasks for the person, last 3 meetings, agenda headings; action-item → task promotion) (2026-06-13, ADR-025: live canvas panel — `getMeetingPrep` assembles the related person's open tasks + last 3 meetings + default agenda deterministically from confirmed edges, reusing `viewItemsQuery`; `promoteActionItem` turns an action item into a task related to the meeting + its people, flowing back into prep; not body-seeded. 10/10 in `verify-meeting-prep.mts`. **Panel UI built + wired; in-browser visual check pending a meeting-with-person, pairs with §1c.**)
- [x] Todoist sync: push dated tasks, completions sync back (webhook + polling fallback), inbox pull-in (offline capture), recurrence delegated to Todoist, conflict rule (Ledgr canonical) (2026-06-13, ADR-026: `src/lib/todoist/` engine behind a `TodoistClient` interface — push dated tasks, three-way due reconcile (Ledgr-canonical content, Ledgr-wins-on-conflict, Todoist-only date syncs back), completion both ways, lost-due unlink, inbox pull-in; HMAC-verified webhook triggers an idempotent sync + 3h polling backstop; `/health` canary. 14/14 in `verify-todoist-sync.mts` (stub client). **Live path needs Brandon-steps: `TODOIST_TOKEN`, `TODOIST_CLIENT_SECRET`, webhook registration, `LEDGR_CRON_TOKEN` — runbook §1d.** Recurrence-occurrence completion logging (Sync API) deferred.)
- [x] Email-in (Outlook "Ledgr Import" folder via Graph `messages/delta`; mark-read + move; note/`task:` prefix; attachments to R2) (2026-06-13, ADR-027: `src/lib/email/` engine behind a `MailSource` interface — `messages/delta`, HTML→text-paragraph BlockNote (no parser dep), `task:`→task/else note, `inbox:true`, `properties.email.messageId` dedup + move-out, delta token in `job_state` (advances only on clean run), attachments via the new server-side `storage.putObject`; 30-min cron + `POST /api/email/import`; `/health` canary. 20/20 in `verify-email-in.mts` incl. a real R2 putObject roundtrip. **Live path needs Brandon-steps: `Mail.ReadWrite` on the registration (§1c) + the `Ledgr Import` Outlook folder.**)
- [ ] View builder (custom views + layouts: list/table/board/calendar/agenda)
- [ ] Interactive embedded query views (editable filter, inline edit/check-off, create-inherits-filters, remove = un-relate)
- [ ] Widget dashboard (drag-and-drop View-Definition cards; item-count-driven heights with equal-height option; badge counts; fill-screen desktop, vertical-scroll mobile; PRD §4.11)
- [ ] Push notifications (morning agenda, meeting-prep-ready)
- [ ] Public share links (read-only, print-friendly, PDF download)
- [ ] Provider-interface discipline confirmed for auth + scheduler (keeps Phase 4 cheap)

**Possible late-Phase-2 ride-along:** the Meetings module's manual "Add-to-template" slice (from planning rhythms).

---

## Phase 3: Claude layer + migration + planning rhythms

- [ ] MCP server (search/read/create/update items, list by entity/date; personal API token)
- [ ] Scheduled Claude tasks (morning briefing, weekly health check) over the same API
- [ ] Selective Notion migration (full export to OneDrive archive first; import active items; map relations; share-to-app)
- [ ] Build surface shell (Work/Build toggle in the main menu; PRD §4.10)
- [ ] Custom type & property builder UI (writes `types.property_schema`; resolves custom-type identity, open Q6)
- [ ] Workflow & wiki templates ("New Workflow"/"New Wiki" guided creation → type + properties + views; on-the-fly tweaks; wire into Work as widget/nav slot; retire = archive, never delete; PRD §4.14)
- [ ] Per-type item templates (task/meeting/note templates storing property choices + starter canvas content; the meeting-prep template of Phase 2 becomes one instance; Brandon, 2026-06-12)
- [ ] Planning rhythms (configurable rituals; deterministic modules; AI-assembled agenda is the only model step)

---

## Phase 4: Packageable local / self-hosted build (exploratory)

- [ ] Gated on a genuine alternative-deployment motivation (not resilience, already covered by export + Pulpit Ready)
- [ ] Swap/stub external deps behind provider interfaces (Clerk → local single-user, R2 → local FS, scheduler → local cron, Graph/Todoist → off or stubbed)
- [ ] DB is already portable (Drizzle connection-string change)

---

## Later / ideas parking lot
Meeting capture + AI processing (PRD §4.15: Whisper or Teams-transcript + Anthropic API summary and suggested tasks; designed-for now, promoted when PRD Q10 resolves), pulpit mode (large-type distraction-free render), staff accounts (schema ready, product deferred), synced blocks, formulas/rollups, gallery/Gantt layouts, email-out, tiered attachment storage (cold-demotion, gated on a real R2-quota trigger; chosen variant is delete-from-R2-and-rehydrate-from-OneDrive).

---

## Success criteria (PRD §9)
- Brandon stops opening Notion for new items within 2 weeks of Phase 2 completing
- A 1:1 with Roger preps in one click and is conducted entirely in the app
- A sermon is written in the app and preached from it (or its export) at least once
- Zero data-loss incidents; export verified restorable
- Maintenance incidents ≤ 5/year, each resolved under an hour with Claude Code
- Monthly cost stays ~$0
