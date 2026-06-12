# CLAUDE.md: Ledgr

This is the operating manual for building Ledgr with Claude Code. Read it at the start of every session. It points to the deeper docs rather than repeating them, so keep it short and keep the pointers current.

**Ledgr** is a single-user personal life management system (replacing Notion) for Brandon Collins, Executive Pastor at Edgewood Community Church. It stores meetings, tasks, notes, and links as richly formatted items in Postgres, presented through a Next.js PWA with two surfaces (Work for daily use, Build for configuration; PRD §4.10), integrated with Microsoft 365, Todoist, and Claude (via MCP).

## Where things live

- **`ledgr-prd.md`**: the full product spec and the source of truth for *intent*. When a behavior question isn't answered here, it's answered there.
- **`schema.md`**: the concrete data model (tables, columns, enums, indexes). Implement against this.
- **`roadmap.md`**: phase-by-phase checklist. What's in scope right now, and what's deliberately not.
- **`next_steps.md`**: the immediate work queue. Start here each session, update it when you finish a slice.
- **`runbook.md`**: operations: token rotation, restore procedure, common fixes, the performance rules. Keep current as you build.
- **`decisions.md`**: ADR log for choices made *during* the build (the PRD's §10 log is frozen intent; this is the running record).
- **`explorations/`**: parked fork-in-the-road ideas under consideration (not intent, not decisions). Currently: `local-first-split.md`, `project-items.md`.

## The non-negotiable rules

These come straight from the PRD's design principles. Breaking one is a design regression, not a style preference.

1. **DB is canonical; OneDrive export is one-way.** Never build bidirectional sync to files. The database is the source of truth.
2. **Everything is an item.** One `items` table, typed. Entities, tasks, meetings, notes, links, and user types are all rows in it. Don't add parallel tables for these.
3. **Deterministic by default, AI on purpose.** Routine plumbing (calendar matching, metadata extraction, formatting, sync) is plain code with no model in the loop. AI lives only in the deliberate, human-in-the-loop Claude/MCP layer, never in a cron job.
4. **Sunday-proof.** Nothing preached on Sunday may depend on Vercel, Neon, or church wifi. The OneDrive export and Pulpit Ready PDF are the fallback path. Don't weaken them.
5. **Boring stack, few dependencies.** Every new package is a future maintenance event. Justify additions; prefer what's already in the stack (e.g. Postgres `pg_trgm` over a new fuzzy-match lib).
6. **Notion-default.** Where several UX options exist, pick the one closest to how Notion works, unless it demands a major new feature. Brandon is migrating muscle memory, not just data.
7. **Multi-user-ready, not multi-user.** Every item carries `owner_id`; every query is owner-scoped. Build no invitations, permissions UI, or sharing-to-accounts in v1.
8. **Fast for the user, cheap on the back end.** Weigh both on every choice (see `runbook.md` perf rules): optimistic UI, stale-while-revalidate, lazy editor, virtualized lists; pooled connections, no `body` in list queries, incremental syncs, right-sized crons.
9. **Observable and debuggable.** Structured JSON logs with correlation ids, a toggleable debug mode, captured-and-surfaced cron/webhook errors (no silent failures), and docs kept current.

## Stack

- **App:** Next.js (single app) on Vercel
- **DB:** Postgres on Neon (free tier), always through the **connection pooler**, never a direct connection
- **Data layer:** Drizzle ORM + migrations (SQL-close, serverless-friendly; chosen over Prisma)
- **Editor:** BlockNote. **Canonical body format is BlockNote JSON**, not markdown. Markdown is the derived, color-safe export (colors/highlights serialize to inline HTML `<mark>`/`<span>`).
- **Auth:** Clerk (free tier), Microsoft sign-in primary. Machine-to-machine (MCP, cron, webhooks) uses scoped API tokens, separate from Clerk.
- **File storage:** Cloudflare R2 (object storage + CDN) behind a storage-provider interface; presigned URLs; per-user quota (~10GB). OneDrive gets backup copies via export.
- **Scheduler:** Vercel Hobby cron (daily only); sub-daily jobs triggered by a GitHub Actions workflow hitting authenticated endpoints.
- **Integrations:** Microsoft Graph (calendar, email-in, OneDrive export), Todoist (tasks/reminders/offline capture), Claude via a thin MCP server.
- **Cost target:** ~$0/month on free tiers (+ ~$12/yr domain).

## Provider-interface discipline

To keep a future local build (Phase 4) a packaging exercise rather than a rewrite, keep the three embedded cloud dependencies behind thin interfaces: **storage** (already), **auth** (Clerk reachable behind an interface so a local single-user mode can stand in), and the **scheduler** (GitHub Actions calls the same authenticated endpoints a local cron could). The DB is already portable via Drizzle (connection-string change).

## Working conventions

- **Owner-scope every query.** No query touches `items` without filtering `owner_id`.
- **List queries never select `body`.** Bodies load only when an item is opened.
- **Soft-delete only.** Deletes move to Trash (30-day purge); they don't hard-delete. Parent soft-delete cascades to children.
- **Snapshot bodies to `revisions` on save (debounced).** Cap ~50 per item.
- **Indexes are part of the feature.** When you add a queried field, add its index (see `schema.md`).
- **Incremental syncs only.** Delta/changed-since queries, never full re-pulls.
- **No deploys Saturday night.** (Sunday-proof.)
- **Writing style for any prose Claude generates for Brandon:** no em dashes (use commas, colons, parentheticals, or rework); don't split a contrast into two choppy sentences; concise, direct, warm, active voice.

## When you finish a slice

Update `next_steps.md` (move the slice to done, name the next one), check the box in `roadmap.md`, and if you made a real architectural choice, log it in `decisions.md`.
