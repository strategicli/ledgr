# next_steps.md: Ledgr Work Queue

The live, near-term work queue. Start here each session. When you finish a slice, move it to "Recently done," pull the next item up, and check its box in `roadmap.md`.

**Current state:** Repo scaffolded (slice 1, ADR-002): Next.js 16 App Router at `C:\dev\ledgr`, Drizzle + Neon serverless driver with a pooler guard, Clerk behind a thin auth interface, `/health` stub, docs copied into the repo. Remaining slice-1 verification (GitHub push, Vercel deploy, green `/health` against a real Neon DB) waits on one-time interactive logins (gh, Vercel) and Neon/Clerk account setup. Next code work is step 2, the schema.

---

## Next up (in order)

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
- **Slice 1, repo scaffold (2026-06-12, ADR-002):** create-next-app (TypeScript, App Router, Tailwind kept) at `C:\dev\ledgr` (outside OneDrive; node_modules and OneDrive sync don't mix). Drizzle ORM + Neon serverless HTTP driver; `src/db/index.ts` enforces the pooler rule (refuses a `*.neon.tech` host without `-pooler`). Clerk SDK behind a thin `AuthProvider` interface in `src/lib/auth/` with a no-key fallback (Phase 4 seam); Clerk middleware in `src/proxy.ts`, `/health` excluded. `.env.example` documented and mirrored in runbook §1. `/health` returns DB reachability + placeholder `lastExportAt` (verified locally: degraded without DB, pooler guard fires, debug mode gates error detail). Docs copied into the repo; initial commit made. Pending verification: GitHub push, Vercel deploy wiring, `/health` green against a real pooled Neon connection.
- PRD updated to v0.17 from the June 11 Tyler call: two-surface architecture (Work/Build, §4.10), widget dashboard (§4.11), navigation slots (§4.12), item canvas with field zones (§4.13), Build surface workflows/wikis (§4.14), meeting capture + AI specced design-ahead (§4.15); roadmap/schema/next_steps synced.
- PRD finalized (v0.16).
- Generated CLAUDE.md, schema.md, roadmap.md, runbook.md, decisions.md.
