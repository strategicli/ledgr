# next_steps.md: Ledgr Work Queue

The live, near-term work queue. Start here each session. When you finish a slice, move it to "Recently done," pull the next item up, and check its box in `roadmap.md`.

**Current state (2026-06-12, end of day):** Production is fully live and verified: `/health` green (Neon via pooler), GitHub push → auto-deploy working, signed-out browsers redirected to `/sign-in` (API clients get 404), `/api/machine/ping` 200 with the diag token / 401 without. Clerk is wired end to end (app `app_3F2TycnY7yaP2Lypfc3gFp0KLls`, dev instance `tough-redbird-21.clerk.accounts.dev`, keys in `.env.local` + all three Vercel envs); sign-ups are allowlist-restricted to brandoncollins@edgewoodcommunity.org (set via Backend API). **Remaining for slice 3:** (1) Brandon signs in once at https://ledgr-teal.vercel.app with the Microsoft account (creates his Clerk user, backfills `users.clerk_id`, home shows "Signed in as …"); (2) optional dashboard tidy-up: disable Apple, Google, and Email/password so Microsoft is the only visible method (Clerk dashboard → Configure). Then flip the auth box and start slice 4.

---

## Next up (in order)

### 3v. Finish slice 3 (one manual step)
- Brandon signs in once with Microsoft at the production URL; confirm home shows "Signed in as brandoncollins@edgewoodcommunity.org" (proves the `clerk_id` backfill in `src/lib/owner.ts` ran; check `users.clerk_id` is set).
- Flip the auth roadmap box; move slice 3 to done here.

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
- ~~Entity `kind`~~: decided, real column on `items` (ADR-003).
- OneDrive export file scope: app-only `Files.ReadWrite.All` vs a stored delegated token (settle when the export job is built; affects the app registration).
- Error capture: small `error_log` table vs free Sentry tier (pick before wiring "no silent failures").
- Desktop navigation: floating bottom bar vs right sidebar (PRD Q9). Build both behind the same slot model when the nav shell lands, try each, keep the winner; log it.
- See `decisions.md` for the running log and PRD §10/§11 for what's already frozen vs still open.

---

## Recently done
- **Slice 3, auth code (2026-06-12, ADR-004):** route protection in `src/proxy.ts` via `auth.protect()` (public: `/sign-in`, `/api/machine/*`; `/health` stays outside the matcher); in-app `/sign-in` page (works on a Clerk dev instance now and a production instance later, no accounts.dev dependency); `resolveOwner()` in `src/lib/owner.ts` (clerk_id lookup, first-sign-in email match + backfill, no row creation); machine tokens per ADR-004 (`src/lib/auth/machine.ts`, `scripts/make-token.mjs`, `/api/machine/ping`). Verified locally on the production build: ping 200 with a valid token (name + scopes echoed), 401 without/with a bad one; home renders keyless. Production verification pending (see 3v); Clerk dashboard setup pending (Brandon).
- **Slice 2 verification (2026-06-12):** Neon provisioned via `vercel integration add neon` (`neon-teal-cushion`), pooled `DATABASE_URL` confirmed (`-pooler` host). `db:migrate` + `db:seed` ran clean; verified on Neon: 8 tables, 22 indexes (incl. `items_search_gin`, `items_properties_gin`), 5 `types` rows, 1 `users` row; `/health` green locally (DB latency ~190ms). Production `/health` still degraded: the pre-Neon deployment is serving, and new deploys are BLOCKED by Vercel pending the GitHub login connection (discovered via the deployment's `errorLink`; Hobby teams require the commit author to be verifiable as the team owner).
- **Slice 2, data model (2026-06-12, ADR-003):** all eight Phase 1 tables in `src/db/schema.ts` (users, types, items, relations, attachments, revisions, views, error_log; matchers deferred to Phase 2). Enums for status/urgency/match_state/layout; entity `kind` as a text column; app-maintained `body_text` feeding a stored generated `tsvector` (GIN); full index plan incl. separate `relations` source/target indexes and the (source, target, role) unique; `ON DELETE CASCADE` from child tables for the purge path. Migration `drizzle/0000_mean_lockheed.sql` generated and reviewed; `scripts/migrate.mjs` + `scripts/seed.mjs` (idempotent, pooler-guarded, zero new deps) wired as `db:generate`/`db:migrate`/`db:seed`. Build green. Verification on a real Neon DB pending (step 2v).
- **Slice 1 verification, partial (2026-06-12):** repo pushed to GitHub (`brandonscollins/ledgr`, private), Vercel project `ledgr` created and deployed from CLI (`ledgr-teal.vercel.app`); `/health` returns 503 `degraded / database unreachable` as designed with no `DATABASE_URL`. Still pending: Vercel GitHub App install (auto-deploys), Neon terms + provisioning, Clerk keys.
- **Slice 1, repo scaffold (2026-06-12, ADR-002):** create-next-app (TypeScript, App Router, Tailwind kept) at `C:\dev\ledgr` (outside OneDrive; node_modules and OneDrive sync don't mix). Drizzle ORM + Neon serverless HTTP driver; `src/db/index.ts` enforces the pooler rule (refuses a `*.neon.tech` host without `-pooler`). Clerk SDK behind a thin `AuthProvider` interface in `src/lib/auth/` with a no-key fallback (Phase 4 seam); Clerk middleware in `src/proxy.ts`, `/health` excluded. `.env.example` documented and mirrored in runbook §1. `/health` returns DB reachability + placeholder `lastExportAt` (verified locally: degraded without DB, pooler guard fires, debug mode gates error detail). Docs copied into the repo; initial commit made. Pending verification: GitHub push, Vercel deploy wiring, `/health` green against a real pooled Neon connection.
- PRD updated to v0.17 from the June 11 Tyler call: two-surface architecture (Work/Build, §4.10), widget dashboard (§4.11), navigation slots (§4.12), item canvas with field zones (§4.13), Build surface workflows/wikis (§4.14), meeting capture + AI specced design-ahead (§4.15); roadmap/schema/next_steps synced.
- PRD finalized (v0.16).
- Generated CLAUDE.md, schema.md, roadmap.md, runbook.md, decisions.md.
