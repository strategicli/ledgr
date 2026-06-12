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
