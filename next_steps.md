# next_steps.md: Ledgr Work Queue

The live, near-term work queue. Start here each session. When you finish a slice, move it to "Recently done," pull the next item up, and check its box in `roadmap.md`.

**Current state (2026-06-12, night):** R2 is provisioned (serving via the `*.r2.dev` public development URL; switching to a custom domain is an open follow-up, runbook §1 box) and an interim Work home is live at `/`: items grouped by type with create, open, trash, and restore, so manual testing finally has a front door. The home page is deliberately throwaway chrome; the Today view, per-type lists, and navigation shell slices replace it. Slice 5 (BlockNote editor) remains done except the Brandon-steps below. Test data left in the DB on purpose: "Editor test page (slice 5)", "Roger Smith" entity, and "Manual test task"; trash them anytime.

**Brandon-steps (manual checks):**
1. **Image paste check (closes slice 5):** paste an image into any item body and confirm it renders from the r2.dev base URL.
2. **Obsidian eyeball check:** open `scripts/sample-export.md` (also copied next to this file as `slice5-sample-export.md`) in Obsidian reading view; colors/highlights should render with no plugin.
3. (Still open from slice 3) Clerk dashboard tidy-up: disable Apple/Google/Email-password so Microsoft is the only visible method.
4. (New, no rush) Attach a custom domain to the R2 bucket and update `R2_PUBLIC_BASE_URL` (runbook §1 "R2 follow-up"); cheaper to do before many images exist.

---

## Next up (in order)

### 6. Entity pages
- Open any entity item and see all related items grouped by type (the "tag as dashboard" experience, PRD §4.2).
- Query `relations` both directions, `match_state = 'confirmed'` only for trusted lists; suggested renders dotted/grayed when it appears.
- Body-free list queries throughout; group by `items.type`.
- A first taste of the backlinks data path (the full backlinks panel is its own slice).

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
- **Interim Work home (2026-06-12):** replaced the placeholder `/` with a minimal owner-scoped item list grouped by type (seed order), per-type "+ New" (POST then jump into the editor), per-row Trash, and a collapsed Trash section with Restore; back link added to `/items/[id]`. Body-free list queries via the existing `listItems`; mutations go through the existing API routes and `router.refresh()`. Explicitly interim: no roadmap box checked; Today/per-type lists/nav shell replace it. Verified in a real browser end to end (create → autosave → back → trash → restore, zero console errors). `.claude/launch.json` now runs dev with the ADR-006 stand-in via Git Bash.
- **Slice 5, block editor (2026-06-12, ADR-006):** BlockNote 0.51 (core/react/mantine) with the default block set (covers all PRD §4.1 block types) plus a custom `mention` inline node; lazy-loaded so lists never pay the editor bundle. Pure JSON-walking markdown serializer (`src/lib/markdown.ts`, no editor import, usable by the future export cron) over the pinned color table (`src/lib/colors.ts`): text colors → `<span style>`, highlights → `<mark class="hl-*">` + inline style, mentions → `ledgr://item/<id>` links. Storage provider interface (`src/lib/storage/`, R2 via aws4fetch) + `/api/attachments` (presigned PUT, 100MB/file, ~10GB quota, metadata row at presign time). Mention diff-sync (`src/lib/mentions.ts`) on create/update/revision-restore, role `mention` only, other roles untouched. `q=` title search on `GET /api/items` for the picker. Minimal `/items/[id]` page with debounced autosave (1.5s, keepalive flush on pagehide). Dev auth stand-in (`DEV_USER_EMAIL`) + `resolveOwner` backfill hardened to never overwrite a linked `clerk_id`. Verified: 43/43 editor checks + 26/26 item checks against Neon; browser end-to-end (typing, autosave, @ picker → relations row, slash menu items, heading apply); BlockNote confirmed in lazy chunks only. Pending Brandon: R2 provisioning + Obsidian render check (see above).
- **Slice 4, item CRUD (2026-06-12, ADR-005):** `src/lib/items.ts` + routes `/api/items` (GET list / POST), `/api/items/[id]` (GET/PATCH/DELETE), `[id]/restore`, `[id]/revisions` (+ `[revisionId]/restore`), `/api/machine/purge`. Owner-scoped throughout; list queries select no `body`/`body_text`; `body_text` re-extracted on every body save (feeds the tsvector); revision snapshots debounced 5 min, capped 50, pre-restore body force-snapshotted so restores are undoable; cascade soft-delete stamps the unit with one `deleted_at` and restore matches on it; write-time parent cycle guard. Daily purge cron wired (`vercel.json`, `CRON_SECRET` + `vercel-cron` token set in production env via CLI). Verified: 26/26 checks in `scripts/verify-items.mts` against Neon, plus HTTP probes on the prod build (signed-out protected; purge 200 with cron scope, 401 without/with wrong scope). Added `tsx` (dev-only) to run TS verification scripts. Trash/Today UI comes with the views slices.
- **Slice 3 closed (2026-06-12):** Brandon signed in with Microsoft; `users.clerk_id` backfill confirmed on Neon.
- **Slice 3, auth code (2026-06-12, ADR-004):** route protection in `src/proxy.ts` via `auth.protect()` (public: `/sign-in`, `/api/machine/*`; `/health` stays outside the matcher); in-app `/sign-in` page (works on a Clerk dev instance now and a production instance later, no accounts.dev dependency); `resolveOwner()` in `src/lib/owner.ts` (clerk_id lookup, first-sign-in email match + backfill, no row creation); machine tokens per ADR-004 (`src/lib/auth/machine.ts`, `scripts/make-token.mjs`, `/api/machine/ping`). Verified locally on the production build: ping 200 with a valid token (name + scopes echoed), 401 without/with a bad one; home renders keyless. Production verification pending (see 3v); Clerk dashboard setup pending (Brandon).
- **Slice 2 verification (2026-06-12):** Neon provisioned via `vercel integration add neon` (`neon-teal-cushion`), pooled `DATABASE_URL` confirmed (`-pooler` host). `db:migrate` + `db:seed` ran clean; verified on Neon: 8 tables, 22 indexes (incl. `items_search_gin`, `items_properties_gin`), 5 `types` rows, 1 `users` row; `/health` green locally (DB latency ~190ms). Production `/health` still degraded: the pre-Neon deployment is serving, and new deploys are BLOCKED by Vercel pending the GitHub login connection (discovered via the deployment's `errorLink`; Hobby teams require the commit author to be verifiable as the team owner).
- **Slice 2, data model (2026-06-12, ADR-003):** all eight Phase 1 tables in `src/db/schema.ts` (users, types, items, relations, attachments, revisions, views, error_log; matchers deferred to Phase 2). Enums for status/urgency/match_state/layout; entity `kind` as a text column; app-maintained `body_text` feeding a stored generated `tsvector` (GIN); full index plan incl. separate `relations` source/target indexes and the (source, target, role) unique; `ON DELETE CASCADE` from child tables for the purge path. Migration `drizzle/0000_mean_lockheed.sql` generated and reviewed; `scripts/migrate.mjs` + `scripts/seed.mjs` (idempotent, pooler-guarded, zero new deps) wired as `db:generate`/`db:migrate`/`db:seed`. Build green. Verification on a real Neon DB pending (step 2v).
- **Slice 1 verification, partial (2026-06-12):** repo pushed to GitHub (`brandonscollins/ledgr`, private), Vercel project `ledgr` created and deployed from CLI (`ledgr-teal.vercel.app`); `/health` returns 503 `degraded / database unreachable` as designed with no `DATABASE_URL`. Still pending: Vercel GitHub App install (auto-deploys), Neon terms + provisioning, Clerk keys.
- **Slice 1, repo scaffold (2026-06-12, ADR-002):** create-next-app (TypeScript, App Router, Tailwind kept) at `C:\dev\ledgr` (outside OneDrive; node_modules and OneDrive sync don't mix). Drizzle ORM + Neon serverless HTTP driver; `src/db/index.ts` enforces the pooler rule (refuses a `*.neon.tech` host without `-pooler`). Clerk SDK behind a thin `AuthProvider` interface in `src/lib/auth/` with a no-key fallback (Phase 4 seam); Clerk middleware in `src/proxy.ts`, `/health` excluded. `.env.example` documented and mirrored in runbook §1. `/health` returns DB reachability + placeholder `lastExportAt` (verified locally: degraded without DB, pooler guard fires, debug mode gates error detail). Docs copied into the repo; initial commit made. Pending verification: GitHub push, Vercel deploy wiring, `/health` green against a real pooled Neon connection.
- PRD updated to v0.17 from the June 11 Tyler call: two-surface architecture (Work/Build, §4.10), widget dashboard (§4.11), navigation slots (§4.12), item canvas with field zones (§4.13), Build surface workflows/wikis (§4.14), meeting capture + AI specced design-ahead (§4.15); roadmap/schema/next_steps synced.
- PRD finalized (v0.16).
- Generated CLAUDE.md, schema.md, roadmap.md, runbook.md, decisions.md.
