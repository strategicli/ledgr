# next_steps.md: Ledgr Work Queue

The live, near-term work queue. Start here each session. When you finish a slice, move it to "Recently done," pull the next item up, and check its box in `roadmap.md`.

**Current state:** PRD complete (v0.17, now including the two-surface Work/Build architecture, widget dashboard, navigation, item canvas, and meeting-AI design-ahead from the June 11 Tyler call). Supporting docs written (CLAUDE.md, schema.md, roadmap.md, runbook.md, decisions.md). No code yet. We are at the very start of Phase 1.

---

## Next up (in order)

### 1. Scaffold the repo
- Create the GitHub repo (also the code backup and where Claude Code works).
- `create-next-app` (TypeScript, App Router). Add Drizzle, the Neon serverless driver, Clerk SDK.
- Wire Vercel deploy from the repo.
- Set up `.env` and a documented env-var list (Neon **pooler** connection string, Clerk keys, R2 keys, Graph app registration, Todoist token). Put placeholders + descriptions in the runbook.
- Add a `/health` endpoint stub (returns DB-reachable + a placeholder export timestamp).
- Verify: app deploys, `/health` is green, DB connects through the pooler.
- Log the scaffold choices (App Router, etc.) in `decisions.md`.

### 2. Define the schema in Drizzle and migrate
- Implement `users`, `types`, `items`, `relations`, `attachments`, `revisions`, `views`, `error_log` per `schema.md`.
- Seed the five system `types` rows and the single `users` row.
- Add the full index plan (incl. the FTS generated `tsvector` column).
- Decide entity `kind` placement (column vs `properties`); log it.
- Verify: migration runs clean on Neon; seed rows present; indexes exist.

### 3. Auth (Clerk + Microsoft sign-in)
- Clerk with Microsoft as the primary (only interactive) sign-in.
- Put all app routes behind auth.
- Stand up the scoped API-token scheme for machine access (MCP/cron/webhooks), separate from Clerk. Keep Clerk behind a thin interface (Phase 4 insurance).
- Verify: signed-out users are blocked; one API token authenticates a test machine route.

### 4. Item CRUD (owner-scoped)
- Create/read/update/soft-delete, all filtered on `owner_id`.
- List endpoints **exclude `body`**.
- Trash view + 30-day purge job; revision snapshot on save (debounced, cap ~50) + restore.
- Verify: a list query's SQL has no `body` and is owner-scoped; soft-delete + restore round-trips; a parent's soft-delete cascades to children.

### 5. Block editor (BlockNote) + markdown serialization
- Lazy-load / code-split the editor (don't pay its cost on lists/Today).
- Slash commands, headings, lists, checkboxes, quotes, dividers, code; bold/italic/highlight/text colors.
- Markdown export with the color/highlight → inline-HTML mapping table (one table, shared with any future importer).
- Paste images inline → R2 via presigned URL.
- `@`-mention creates a `relations` row.
- Verify: a colored/highlighted doc round-trips to markdown and renders in Obsidian reading view with no plugin.

---

## Then (rest of Phase 1, rough order)
Entity pages → parent/child subtasks (recursive reads, cycle guard, progress rollup) → item canvas (modal default, top/bottom field zones, PRD §4.13) → Today view (batched fetch; fixed layout) → navigation shell (mobile bottom bar; desktop nav test, PRD §4.12) → Inbox → per-type lists + filters → full-text search → quick capture → backlinks panel → PWA shell → OneDrive export → Pulpit Ready → structured logging + debug mode → weekly `pg_dump` + a tested restore. See `roadmap.md` for the full Phase 1 checklist.

**Before starting Phase 2:** the backup restore must be tested once for real. An untested backup is a hope, not a backup.

---

## Open decisions to make as we build
- Entity `kind`: column on `items` vs inside `properties` (decide at step 2).
- OneDrive export file scope: app-only `Files.ReadWrite.All` vs a stored delegated token (settle when the export job is built; affects the app registration).
- Error capture: small `error_log` table vs free Sentry tier (pick before wiring "no silent failures").
- Desktop navigation: floating bottom bar vs right sidebar (PRD Q9). Build both behind the same slot model when the nav shell lands, try each, keep the winner; log it.
- See `decisions.md` for the running log and PRD §10/§11 for what's already frozen vs still open.

---

## Recently done
- PRD updated to v0.17 from the June 11 Tyler call: two-surface architecture (Work/Build, §4.10), widget dashboard (§4.11), navigation slots (§4.12), item canvas with field zones (§4.13), Build surface workflows/wikis (§4.14), meeting capture + AI specced design-ahead (§4.15); roadmap/schema/next_steps synced.
- PRD finalized (v0.16).
- Generated CLAUDE.md, schema.md, roadmap.md, runbook.md, decisions.md.
