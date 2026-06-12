# decisions.md: Ledgr Architecture Decision Log

A running log of decisions made *during the build*. The PRD's §10 decisions log is frozen product intent; this file captures the implementation choices that come up as code gets written (library picks, schema judgment calls, trade-offs Claude Code and Brandon settle in the moment).

**Why a separate log:** so the reasoning behind a choice survives past the session that made it. When future-Brandon (or Claude Code) wonders "why did we do it this way," the answer is here, not lost in chat history.

## How to use this
- Add an entry when you make a real architectural or tooling choice, not for routine code.
- Keep entries short: context, the decision, and why (plus what was rejected, if it matters).
- Never rewrite history. If a decision is reversed, add a new entry that supersedes the old one and note it.
- Number sequentially. Date each entry.

### Template
```
## ADR-NNN: <short title>
**Date:** YYYY-MM-DD
**Status:** accepted | superseded by ADR-NNN | reversed
**Context:** what prompted the decision.
**Decision:** what we chose.
**Why / alternatives:** the reasoning; what was rejected and why.
**Affects:** files/areas touched.
```

---

## Decisions inherited from the PRD (frozen, not re-litigated here)
These are settled in PRD §10. Listed only as pointers so this log is self-orienting; don't duplicate or re-debate them:
stack (Next.js/Vercel, Neon, Drizzle, Clerk, R2, BlockNote), DB-canonical one-way export, everything-is-an-item, deterministic-by-default, Todoist for recurrence + offline + notifications, BlockNote JSON canonical body, soft-deletes + revisions in v1, generic page-to-page relations, single-parent containment, table-backed types, baseline encryption posture, GitHub Actions for sub-daily crons, packageable-local gated to Phase 4. See PRD §10/§11 for the full list and the still-open questions.

---

## Build decisions (newest at the bottom)

## ADR-001: Supporting docs split into five files
**Date:** 2026-06-11
**Status:** accepted
**Context:** PRD is complete; needed working docs to drive a Claude Code build.
**Decision:** CLAUDE.md (concise pointer/operating manual), schema.md (implementable data model), roadmap.md (phase checklist), next_steps.md (near-term queue), runbook.md (operations), decisions.md (this log).
**Why / alternatives:** CLAUDE.md kept as a pointer rather than self-contained so it can't drift from the PRD. A single mega-doc was rejected as harder for Claude Code to load selectively.
**Affects:** repo root docs.

## ADR-002: Repo scaffold choices
**Date:** 2026-06-12
**Status:** accepted
**Context:** First code slice. create-next-app defaults plus the project's non-negotiables needed concrete picks.
**Decision:**
- Next.js 16 (App Router, TypeScript, Turbopack) scaffolded with create-next-app at `C:\dev\ledgr`. Code lives outside OneDrive on purpose: node_modules and `.next` in a synced folder cause churn, file locks, and slow installs. The project docs are copied into the repo root so GitHub backs them up and Claude Code sessions in the repo have them.
- Tailwind CSS v4 kept from the scaffold default: one well-trodden dependency instead of a bespoke CSS system, consistent with the boring-stack rule.
- Drizzle ORM over the Neon serverless HTTP driver (`drizzle-orm/neon-http`). `src/db/index.ts` is a lazy singleton that refuses any `*.neon.tech` connection string whose host lacks `-pooler`, turning the pooler rule from a convention into a runtime guard. Local Postgres (Phase 4) is exempt from the guard.
- Clerk wired behind a thin `AuthProvider` interface (`src/lib/auth/`): server code calls `authProvider.getCurrentUser()`, the layout wraps `AppAuthProvider`, and both fall back cleanly when no Clerk key is configured. This is the Phase 4 local-mode seam made real, and it also lets the repo build on a fresh clone with no secrets.
- Clerk middleware lives in `src/proxy.ts` (the Next 16 convention replacing `middleware.ts`) and excludes `/health`, since machine endpoints authenticate with scoped API tokens, never Clerk.
- Dependencies pinned exactly (`--save-exact`) per the "updates batched intentionally, never auto" rule.
- `/health` reports DB reachability plus a placeholder `lastExportAt`; raw error detail is gated behind `DEBUG_MODE` so failures stay legible without leaking connection details.
**Why / alternatives:** The Neon HTTP driver was chosen over node-postgres/TCP because it is built for serverless functions and pairs naturally with the pooled endpoint. Requiring Clerk keys at build time was rejected; the no-key fallback keeps the auth seam genuine rather than decorative. Skipping Tailwind was rejected as trading one dependency for a pile of hand-rolled CSS.
**Affects:** `package.json`, `src/db/`, `src/lib/auth/`, `src/proxy.ts`, `src/app/health/`, `drizzle.config.ts`, `.env.example`, runbook §1.

## ADR-003: Schema implementation judgment calls
**Date:** 2026-06-12
**Status:** accepted
**Context:** Implementing schema.md in Drizzle (slice 2) surfaced the deferred decisions schema.md flagged, plus a few implementable-form details.
**Decision:**
- **Entity `kind` is a real column on `items`** (`text`, nullable), not a key in `properties`. It is a hot, filterable field ("show all people"), and hot fields are columns. Plain `text` rather than a Postgres enum so adding a kind never needs a migration.
- **FTS uses an app-maintained `body_text` column** plus a `GENERATED ALWAYS AS (...) STORED` `tsvector` over `title + body_text`, GIN-indexed. Generating the tsvector straight from the BlockNote JSONB was rejected: `body::text` would index structural noise (`"type":"paragraph"`, etc.) and pollute results. App code extracts plain text from the BlockNote doc on save (same save path that snapshots revisions).
- **Child tables hard-cascade:** `relations`, `attachments`, `revisions` have `ON DELETE CASCADE` to `items`, so the 30-day Trash purge (the only hard delete) cleans up edges and snapshots in one statement. Soft-delete cascade to child *items* stays app-level (slice 4).
- **`users.email` is unique and `clerk_id` is nullable-unique**, so the seed is idempotent (`ON CONFLICT DO NOTHING` on email) and the row can exist before Clerk is wired in slice 3.
- **Migrations:** `drizzle-kit generate` produces SQL into `drizzle/`; `scripts/migrate.mjs` applies it via `drizzle-orm/neon-http/migrator`, and `scripts/seed.mjs` seeds via the same Neon HTTP driver. Both are plain Node (`--env-file-if-exists`), reuse existing deps, and enforce the pooler guard. No `tsx`/`dotenv` added (boring-stack rule).
- `matchers` (Phase 2) deliberately not created.
**Why / alternatives:** Each call follows an existing principle (hot-fields-are-columns, no-new-deps, purge must not strand rows). A separate `entities` table for `kind` was rejected (violates everything-is-an-item).
**Affects:** `src/db/schema.ts`, `drizzle/0000_*.sql`, `scripts/migrate.mjs`, `scripts/seed.mjs`, `package.json` (db:* scripts), schema.md corrected per its own header rule.

## ADR-004: Machine API tokens as hashed env entries, no DB table
**Date:** 2026-06-12
**Status:** accepted
**Context:** Slice 3 needs the machine-to-machine auth scheme (MCP, cron, webhooks) the PRD requires to be scoped, revocable, and separate from Clerk. The obvious designs were a `api_tokens` DB table or an env-var scheme.
**Decision:** Tokens live as comma-separated `name:scope1+scope2:sha256hex` entries in the `LEDGR_API_TOKENS` env var. `scripts/make-token.mjs` generates a raw token (`lgr_` + 48 hex chars, shown once, held only by the caller) and its env entry. `src/lib/auth/machine.ts` verifies `Authorization: Bearer` headers by SHA-256 + constant-time compare and returns `{name, scopes}`. Machine routes live under `/api/machine/*`, are excluded from Clerk protection in `src/proxy.ts`, and verify their own token per-handler; `/api/machine/ping` is the diagnostic route (any valid token; echoes the caller's own identity). Revocation = remove the entry, redeploy.
**Why / alternatives:** Single user with a handful of long-lived tokens does not justify a table, issuance UI, or query on every request (fast-and-cheap rule); env entries are zero-dependency and the hash-only storage means neither a DB dump nor an env dump leaks a credential. A DB table becomes the right answer if tokens ever need per-token expiry, usage audit, or self-serve issuance; nothing in the route contract would change, only `verifyMachineToken`'s lookup.
**Affects:** `src/lib/auth/machine.ts`, `src/app/api/machine/ping/`, `src/proxy.ts`, `scripts/make-token.mjs`, `.env.example`, runbook §1/§3.

## ADR-005: Trash/restore semantics, purge-cron auth, and a dev-only TS runner
**Date:** 2026-06-12
**Status:** accepted
**Context:** Slice 4 (item CRUD) had to make the PRD's soft-delete promises concrete: "soft-deleting a parent takes its children to Trash with it so the unit restores together" (§3.5/§4.6), a 30-day purge, and debounced revision snapshots. It also needed the first real scheduled job and a way to verify app code outside an HTTP request.
**Decision:**
- **Deletion units via shared `deleted_at`.** Cascade soft-delete stamps the item and every live descendant with the same `deleted_at` in one recursive-CTE UPDATE. Restore matches on that shared timestamp, so the unit round-trips together while a child trashed earlier in a *separate* delete keeps its own timestamp and stays in Trash. No extra `deletion_group` column needed; the timestamp already encodes the group.
- **Purge is the only hard delete** (`purgeExpiredTrash`): items with `deleted_at` older than 30 days are deleted (child tables cascade per ADR-003) after a detach UPDATE clears `parent_id` on any non-expiring item still pointing at an expiring one (the restored-out-of-a-unit edge case). Two statements without a transaction is accepted: a stray detach is harmless and the delete retries next run.
- **Vercel cron authenticates as a machine token.** `vercel.json` schedules `GET /api/machine/purge` daily (08:00 UTC); Vercel sends `Authorization: Bearer $CRON_SECRET`, and `CRON_SECRET` holds a raw `cron`-scoped token from the ADR-004 scheme. The platform cron walks through the same door as GitHub Actions or any future local scheduler — no second auth path, which keeps the provider-interface discipline (CLAUDE.md) intact. Purge failures insert into `error_log` with a correlation id (no silent failures).
- **Cycle guard at write time.** `parent_id` updates reject self and descendants (recursive CTE check), since one cycle would hang every recursive tree read; the cascade CTEs additionally use `UNION` (not `UNION ALL`) so even bad data can't recurse forever. The fuller subtasks slice still owns recursive reads + rollup.
- **`tsx` added as a devDependency** to run `scripts/verify-items.mts`, which exercises the real `src/lib/items.ts` against Neon. ADR-003 declined `tsx` when plain-Node `.mjs` scripts sufficed; this slice is the first whose verification must import app TypeScript (with `@/` aliases). Dev-only, zero runtime footprint, and it's the seam a future test runner would use. Duplicating the logic in `.mjs` was rejected as verifying a copy, not the code.
**Why / alternatives:** A `deletion_group_id` column was rejected as a second source of truth for what the timestamp already says. Vercel's implicit `CRON_SECRET` comparison alone (without the token scheme) was rejected because it would create an unscoped, unnamed credential outside the rotation runbook. Restoring a child out of a still-trashed parent intentionally keeps `parent_id` (the Trash view shows everything, and restoring the parent later reunites the tree); detach-on-restore was rejected as destroying hierarchy.
**Affects:** `src/lib/items.ts`, `src/lib/body-text.ts`, `src/lib/api.ts`, `src/app/api/items*`, `src/app/api/machine/purge/`, `vercel.json`, `scripts/verify-items.mts`, `package.json` (tsx), runbook §1/§2a/§3.

## ADR-006: Editor slice judgment calls (serializer, storage, mentions, dev auth stand-in)
**Date:** 2026-06-12
**Status:** accepted
**Context:** Slice 5 (BlockNote editor + markdown serialization + image paste + @-mentions) forced four implementation choices the PRD leaves open.
**Decision:**
- **The markdown serializer is hand-rolled, pure JSON-walking code** (`src/lib/markdown.ts`) with no `@blocknote` import, fed by the single color mapping table in `src/lib/colors.ts` (PRD §4.1). BlockNote's own `blocksToMarkdownLossy` was rejected: it drops colors/highlights (the whole point of §4.1's encoding) and would drag the editor bundle into the OneDrive-export cron and Pulpit Ready paths, which must stay server-side and editor-free. The color table pins BlockNote's default palette hexes so an editor upgrade can't silently change what exported documents mean. Highlights emit both the class (`hl-*`, the stable theming hook) and an inline `background-color` style so the exact color renders even with no CSS snippet; mentions export as `[@Title](ledgr://item/<uuid>)`, a stable URI for the future importer/link-rewriter.
- **R2 via `aws4fetch`** (~6KB, zero deps) behind the `StorageProvider` interface (`src/lib/storage/`): presigned PUT from the browser, bytes never proxy through the app. The full AWS SDK was rejected on Principle 5. The attachment **metadata row is created at presign time**, before the upload: an orphaned row from an abandoned upload is harmless, an untracked R2 object would leak quota. Per-file cap 100MB; per-user quota ~10GB enforced by summing `attachments.size_bytes`. Keys are `ownerId/attachmentId/filename` so per-user accounting and cleanup are prefix operations.
- **Mentions sync as `relations` rows with role `'mention'`**, diffed on every body save (create, update, revision restore): rows appear when a mention is added, disappear when it's removed, and rows with any other role are never touched, so the auto-sync can never destroy a manual link. `'mention'` rather than the schema example `'references'` precisely because the sync deletes what it owns; an auto-managed role must not be shared with hand-made edges. Targets are owner-scoped on insert; self-mentions and dangling ids are dropped silently.
- **A dev-only auth stand-in** joins the provider seam (`src/lib/auth/index.ts`): with no Clerk key, `NODE_ENV=development`, and `DEV_USER_EMAIL` set, the app resolves that email as the signed-in user. This is the Phase 4 local single-user mode in miniature and exists so editor UI (and every future UI slice) can be exercised locally without a Microsoft sign-in. Alongside it, **`resolveOwner`'s email backfill now only fills an empty `clerk_id`**, never overwrites an existing link; the old behavior would have let any second provider identity with a matching email silently steal the row.
**Why / alternatives:** Each choice keeps a non-negotiable intact: editor-free exports (rule 3/8), no new heavyweight deps (rule 5), deterministic mention plumbing with no model in the loop (rule 3), and a genuine auth seam (provider-interface discipline). A `mentions` join table separate from `relations` was rejected (relations *is* the unified edge table).
**Affects:** `src/lib/colors.ts`, `src/lib/markdown.ts`, `src/lib/storage/`, `src/lib/attachments.ts`, `src/lib/mentions.ts`, `src/lib/items.ts`, `src/lib/owner.ts`, `src/lib/auth/index.ts`, `src/app/api/attachments/`, `src/components/editor/`, `src/app/items/[id]/`, `package.json` (@blocknote/*, aws4fetch), `.env.example`, runbook §1, `scripts/verify-editor.mts`.

## ADR-007: Item canvas via intercepting routes; hardcoded field-zone table
**Date:** 2026-06-12
**Status:** accepted
**Context:** Slice 8 (item canvas, PRD §4.13) needs the center modal as the default open with the URL still routable, a full-screen expand, and per-type field zones, all without forking the editing core.
**Decision:**
- **The modal is a Next.js intercepting + parallel route** (`src/app/@modal/(.)items/[id]` rendered through a `modal` slot in the root layout). Client-side navigation to any `/items/[id]` link intercepts into a center modal over the launching list; a document load (refresh, deep link, the ⤢ Expand control) renders the full page at `src/app/items/[id]`. Expand is therefore a plain `<a>`, not `<Link>`: a soft navigation to the same URL would stay intercepted. Both forms render one shared `ItemCanvas` server component; ItemEditor is untouched except a `fields` slot.
- **Edit-loss seams closed at unmount:** ItemEditor flushes pending autosave edits in an unmount cleanup (keepalive PATCH), since closing the modal inside the 1.5s debounce window would otherwise drop the last edit; the Modal calls `router.refresh()` on unmount so the list underneath shows modal-made changes the moment it closes.
- **The top strip is a hardcoded per-type table** (`src/lib/canvas-fields.ts`): task status/due/urgency, meeting when/status, link url/status, entity kind/status, note status, unknown types status only. PRD §4.13's user-configurable field placement is a Build-surface feature; this table is the seam it replaces. Non-strip fields render read-only in a collapsed Fields footer.
- **Status/urgency enums moved to `src/lib/item-enums.ts`** (re-exported from `items.ts`) because the client-side strip needs the value lists and importing `items.ts` would drag the DB layer into the browser bundle.
- **Esc closes the modal only when unclaimed** (`!e.defaultPrevented`), so BlockNote popovers (slash menu, mention picker) keep their own Esc and the modal closes on the next one (verified in-browser).
**Why / alternatives:** Client-managed modal state (open-in-place without a route) was rejected: the URL wouldn't be routable, breaking refresh, sharing, and the Notion-default contract. A separate modal editor component was rejected as forking the editing core the PRD says carries over unchanged. Per-user opening-mode preference (side panel, new tab) is deferred; the renderer is shared, so adding modes later is chrome, not a rewrite.
**Affects:** `src/app/layout.tsx`, `src/app/@modal/`, `src/app/items/[id]/page.tsx`, `src/components/canvas/` (ItemCanvas, Modal, FieldStrip), `src/components/editor/ItemEditor.tsx`, `src/lib/canvas-fields.ts`, `src/lib/item-enums.ts`, `src/lib/items.ts`.

## ADR-008: "Today" is computed against an explicit app timezone; due dates and meeting times use different day boundaries
**Date:** 2026-06-12
**Status:** accepted
**Context:** The Today view (slice 9) needs day boundaries, but the server runs in UTC on Vercel and the PRD never pins a timezone. Worse, the two date fields encode time differently: `meeting_at` is a real instant (the canvas strip round-trips local↔UTC), while `due_date` is a calendar day stored as UTC midnight (the strip's date input slices the ISO date).
**Decision:** A `LEDGR_TIMEZONE` env var (IANA name, default `America/New_York`) defines "today"; `src/lib/today.ts` computes the day's bounds with hand-rolled `Intl.formatToParts` math (a guess-and-correct pass that survives DST, no date library). Meetings filter on the timezone's real midnights; due-date comparisons use plain UTC midnights matching the storage encoding. `getTodayData` batches the screen's three queries (meetings, due/overdue open tasks, recent) in one `Promise.all`, all body-free `listColumns`.
**Why / alternatives:** Deriving the timezone from the browser was rejected: day-scoped *queries* run on the server, and a cron (morning agenda, Phase 2) has no browser. Normalizing both fields to one encoding was rejected as a rewrite of working slice-8 semantics; the two-boundary rule is small and contained in one file. A date library (Luxon, date-fns-tz) was rejected under rule 5 for what is ~30 lines of `Intl`. The env var becomes a per-user column if Ledgr ever goes multi-user.
**Affects:** `src/lib/today.ts`, `src/app/page.tsx` (Today replaces the interim home; the type-grouped list moved to `/items`), `src/components/today/QuickCapture.tsx`, `.env.example`, runbook §1.

## ADR-009: Navigation shell as a hardcoded slot table; desktop bar-vs-sidebar resolved by a live toggle
**Date:** 2026-06-12
**Status:** accepted
**Context:** PRD §4.12 wants user-chosen nav slots (Home locked to slot 1, badge counts) with mobile settled on a floating bottom bar and desktop deliberately undecided (open Q9: same bar vs right sidebar), to be settled by trying both.
**Decision:** `src/lib/nav.ts` is a hardcoded slot table (Home, Inbox+badge, Items), the same Build-surface seam pattern as `canvas-fields.ts`; a server `Nav` wrapper resolves the owner (no nav signed out) and fills badge counts, and a client `NavShell` renders the chrome. Both desktop candidates are built behind the same slot model and a toggle button *in the nav itself* flips between them, persisting to localStorage via `useSyncExternalStore` (server renders the bar default; the stored preference applies after hydration). Mobile always gets the bottom bar. Badges re-render on every `router.refresh()`, which all mutation components already call.
**Why / alternatives:** A DB-backed preference was rejected for a single-user A/B trial: localStorage costs nothing, needs no schema, and the loser gets deleted along with the toggle once Q9 is decided (the keeper may then become a Build-surface setting). Building only one candidate was rejected because the PRD explicitly calls for a try-both decision. Icons are three hand-rolled SVGs, not an icon library (rule 5).
**Affects:** `src/lib/nav.ts`, `src/components/nav/` (Nav, NavShell), `src/app/layout.tsx`.

## ADR-010: Inbox membership is an explicit boolean column, set on arrival, cleared only by deliberate triage
**Date:** 2026-06-12
**Status:** accepted
**Context:** The Inbox (PRD §4.2) holds "items that arrived untriaged, awaiting type/entity/date assignment," but Phase 1's only arrival path is quick capture and the PRD doesn't define what makes an item leave.
**Decision:** A real `items.inbox` boolean (not null, default false) with a partial index (`owner_id where inbox and deleted_at is null`). Arrival paths set it (quick capture today; email-in, Todoist pull-ins, and the share target reuse it in Phase 2). It clears only when a control says so: the Inbox row's "✓ Triaged" button or any explicit `inbox: false` PATCH. The nav badge is `countInbox`, riding the partial index.
**Why / alternatives:** A derived definition ("task with no due date or entity") was rejected: a deliberately dateless someday-task would squat in the Inbox forever, and assigning a date would silently "triage" items behind Brandon's back, violating deterministic-and-predictable behavior. A `properties` JSONB key was rejected because the flag is hot (the badge counts it on every page render) and hot fields are columns (ADR-003). Auto-clearing on any edit was rejected for the same predictability reason; if real use shows the explicit click is friction, auto-clear-on-date/entity-assignment is a one-line loosening, and the reverse migration would be impossible to get right.
**Affects:** `src/db/schema.ts`, `drizzle/0001_*.sql`, `src/lib/items.ts` (input/patch/list/`countInbox`), `src/lib/api.ts`, `src/app/api/items/route.ts`, `src/app/inbox/`, `src/components/inbox/TriageControls.tsx`, `src/components/today/QuickCapture.tsx`, `src/lib/nav.ts`, schema.md.

## ADR-011: Per-type lists ride a ViewFilter shape a `views` row can store; the URL carries the filter
**Date:** 2026-06-12
**Status:** accepted
**Context:** Slice 12 needed per-type list pages now, but PRD §4.2 makes every view a stored View Definition in Phase 2; building pages against ad-hoc query params would mean a rewrite when the view builder lands.
**Decision:** `src/lib/views.ts` defines `ViewFilter` (type, status, urgency, kind, due window, entityId) and `ViewSort`, exactly the shapes a `views` row's `filter`/`sort` jsonb will store, plus one query builder over the body-free `listColumns`. Pages (`/tasks`, `/meetings`, `/notes`, `/links`, `/entities`) parse URL search params into that shape and `FilterBar` selects write params back, so the URL *is* the filter state (shareable, back-button-friendly, zero client list state). The entity filter is an EXISTS over `relations` in both directions, **confirmed edges only** (suggested edges stay out of trusted queries, PRD §3.3). Due windows reuse ADR-008's UTC-midnight calendar encoding; date sorts push nulls last (undated tasks sink). `/items` stays as the all-type sweep and the Trash's home; a tab strip links the six pages; Tasks joins the nav slots.
**Why / alternatives:** Client-side filter state was rejected (server-rendered + URL is simpler and matches every existing page). Filtering through suggested edges was rejected: a provisional calendar match must not silently shape a task list. Creating real seeded `views` rows now was rejected as premature; the shape is the contract, the storage rides in with the view builder.
**Affects:** `src/lib/views.ts`, `src/app/{tasks,meetings,notes,links,entities}/`, `src/components/lists/` (ListPage, ListTabs, FilterBar), `src/app/items/page.tsx`, `src/lib/nav.ts`, `src/components/nav/NavShell.tsx`.

## ADR-012: Search binds raw input through `websearch_to_tsquery`; snippets via `ts_headline` over capped `body_text`; the date filter is `updated_at`
**Date:** 2026-06-12
**Status:** accepted
**Context:** Slice 13. PRD §4.2 wants full-text search filtered by type/entity/date but pins neither query syntax, nor snippets, nor which date "date" means.
**Decision:** `GET /api/search` binds the user's raw string through `websearch_to_tsquery('english', …)` (Google-ish syntax: words, quoted phrases, OR, -exclusions; never throws on any input), matches the stored generated tsvector (ADR-003) on `items_search_gin`, ranks with `ts_rank`. Filters: type, entity (confirmed edges, both directions, same fragment as ADR-011), and an `updated_at` day-window in `LEDGR_TIMEZONE`. Results are body-free list rows plus a snippet `ts_headline` computes **in the database** over `left(body_text, 4000)` with `[[..]]` markers the client renders as `<mark>`; markerless headlines (title-only hits) are dropped as noise. The client debounces 300ms and aborts stale requests.
**Why / alternatives:** The snippet is a deliberate, bounded brush with body content on a list-shaped read: the no-body rule's point is never shipping whole bodies to lists, and an ~18-word db-computed excerpt honors that while making results scannable; returning no snippet was rejected as a worse product for zero real savings. `plainto_tsquery` was rejected (no phrases or negation). Filtering on due/meeting dates was rejected for v1: "that note from March" means recency of touch, and the per-type lists already filter their own date fields.
**Affects:** `src/lib/search.ts`, `src/app/api/search/route.ts`, `src/app/search/page.tsx`, `src/components/search/SearchClient.tsx`, `src/lib/nav.ts`.

## ADR-013: Quick capture is a nav-mounted modal with `q` / `Ctrl+K` shortcuts; captures always arrive `inbox: true`
**Date:** 2026-06-12
**Status:** accepted
**Context:** Slice 14 (PRD §4.4): a global "new item" affordance on every screen with a desktop shortcut, title-only creation, date/urgency/entity optional inline.
**Decision:** `NavShell` (already on every signed-in page) owns a "New" button and the global keydown: `q` opens the capture modal (inert while typing — inputs, selects, contentEditable), `Ctrl/Cmd+K` navigates to `/search`. The modal: title (Enter submits and closes), type select defaulting to task, optional due date and urgency. It always posts `inbox: true`, even with fields set: per ADR-010, leaving the Inbox is a deliberate act, never a side effect of capture-time detail. Its Esc handler claims the key in the **capture phase** (preventDefault + stopPropagation) so a capture opened above the item-canvas modal (which closes on any unclaimed Esc at document level, ADR-007) closes alone, one layer per press. Entity assignment at capture is deferred until a relations write path exists (the backlinks slice builds it).
**Why / alternatives:** `q` follows Todoist's quick-add key (Brandon's existing muscle memory; browser `Ctrl+N` can't be intercepted), `Ctrl+K` is the Notion-default for search. Auto-triaging a capture that has a date set was rejected per ADR-010's reasoning. The PWA share target is deliberately deferred to the PWA-shell slice, which owns the manifest it requires.
**Affects:** `src/components/capture/CaptureModal.tsx`, `src/components/nav/Nav.tsx`, `src/components/nav/NavShell.tsx`.

## ADR-014: The FTS document covers title, body, url, kind, and property values — weighted, always on, no toggle
**Date:** 2026-06-12
**Status:** accepted
**Context:** Brandon asked what search combs through and wanted broader coverage ("search more, not less"), locked on or behind a toggle. The original tsvector (ADR-003) covered only `title + body_text`: a link's URL, an entity's kind, and custom `properties` values were invisible to search.
**Decision:** The generated `search` column (migration 0002) is now a weighted concatenation: title at `A`, `body_text` at `B`, then url + kind and `properties` string values (via `jsonb_to_tsvector('english', …, '["string"]')`) at `C`. URLs and kinds pass through `regexp_replace([^a-zA-Z0-9]+ → space)` first, because Postgres tokenizes a URL as whole host/path lexemes and "youtube" would never match `www.youtube.com` otherwise. Coverage is always on — no toggle. **Status, urgency, and dates stay out deliberately:** searching "done" should find items that *say* done, not every completed task; enums belong in filters (the list pages have them, and the search page can grow them if wanted). The weights make `ts_rank` order title hits above body hits above metadata hits with zero query-side work.
**Why / alternatives:** A toggle was rejected: it adds a control nobody would turn off, and false-positive risk is handled by ranking instead. Re-deriving the column meant a drop/re-add of the generated column; **drizzle-kit did not regenerate the dependent GIN index** (dropping the column drops it silently), so the migration file gained an explicit `CREATE INDEX items_search_gin` — check this any time a generated, indexed column is rebuilt.
**Affects:** `src/db/schema.ts`, `drizzle/0002_*.sql`, schema.md (index plan + gaps list), `scripts/verify-lists-search.mts` (coverage + weighting checks).
