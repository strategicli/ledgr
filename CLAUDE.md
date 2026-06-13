# CLAUDE.md: Ledgr

This is the operating manual for building Ledgr with Claude Code. Read it at the start of every session. It points to the deeper docs rather than repeating them, so keep it short and keep the pointers current.

**Ledgr** is a single-user personal life management system (replacing Notion) for Brandon Collins, Executive Pastor at Edgewood Community Church. It stores meetings, tasks, notes, and links as richly formatted items in Postgres, presented through a Next.js PWA with two surfaces (Work for daily use, Build for configuration; PRD §4.10), integrated with Microsoft 365, Todoist, and Claude (via MCP).

> **🚧 Project status: ALPHA / build phase — pre-production (ADR-039, 2026-06-13).** Ledgr is not in real use yet: there is **no production data to protect**. Do not slow down for data-loss, careful-migration, or backward-compatibility concerns — favor the cleanest, most direct path and convert-or-reseed dev data freely. The same flip that ends this phase turns on the "no Saturday deploys" rule (below): when Ledgr goes into real Sunday/daily use, record the flip to **v1.0 production** in `decisions.md`, update this line, and *then* migration caution applies. Until that note exists, assume alpha.

## Where things live

- **`ledgr-prd.md`**: the full product spec and the source of truth for *intent*. When a behavior question isn't answered here, it's answered there.
- **`schema.md`**: the concrete data model (tables, columns, enums, indexes). Implement against this.
- **`roadmap.md`**: phase-by-phase checklist. What's in scope right now, and what's deliberately not.
- **`next_steps.md`**: the immediate work queue. Start here each session, update it when you finish a slice.
- **`runbook.md`**: operations: token rotation, restore procedure, common fixes, the performance rules. Keep current as you build.
- **`decisions.md`**: ADR log for choices made *during* the build (the PRD's §10 log is frozen intent; this is the running record).
- **`explorations/`**: parked fork-in-the-road ideas under consideration (not intent, not decisions). Currently: `local-first-split.md`, `project-items.md`, `block-linked-action-items.md`, `dashboard-widgets.md`.

## The non-negotiable rules

These come straight from the PRD's design principles. Breaking one is a design regression, not a style preference.

1. **DB is canonical; OneDrive export is one-way.** Never build bidirectional sync to files. The database is the source of truth.
2. **Everything is an item.** One `items` table, typed. Entities, tasks, meetings, notes, links, and user types are all rows in it. Don't add parallel tables for these.
3. **Deterministic by default, AI on purpose.** Routine plumbing (calendar matching, metadata extraction, formatting, sync) is plain code with no model in the loop. AI lives only in the deliberate, human-in-the-loop Claude/MCP layer, never in a cron job.
4. **Sunday-proof.** Nothing preached on Sunday may depend on Vercel, Neon, or church wifi. The OneDrive export and Pulpit Ready PDF are the fallback path. Don't weaken them.
5. **Boring stack, few dependencies.** Every new package is a future maintenance event. Justify additions; prefer what's already in the stack (e.g. Postgres `pg_trgm` over a new fuzzy-match lib).
6. **Bespoke-first, one catch-all.** Design each content type (notes, tasks, meetings, songs, papers, hiring, etc.) with built-in features and, where it earns it, its own canvas. One customizable catch-all type absorbs temporary or unanticipated uses; when a catch-all use proves itself, promote it to a permanent bespoke type (Claude Code does the conversion). This replaces the former "Notion-default" principle: Ledgr is no longer generic-first. Notion stays a reference for individual interactions and muscle memory where it fits, not the default shape of the system. (Pivot: ADR-037.)
7. **Multi-user-ready, not multi-user.** Every item carries `owner_id`; every query is owner-scoped. Build no invitations, permissions UI, or sharing-to-accounts in v1.
8. **Fast for the user, cheap on the back end.** Weigh both on every choice (see `runbook.md` perf rules): optimistic UI, stale-while-revalidate, lazy editor, virtualized lists; pooled connections, no `body` in list queries, incremental syncs, right-sized crons.
9. **Observable and debuggable.** Structured JSON logs with correlation ids, a toggleable debug mode, captured-and-surfaced cron/webhook errors (no silent failures), and docs kept current.

## Stack

- **App:** Next.js (single app) on Vercel
- **DB:** Postgres on Neon (free tier), always through the **connection pooler**, never a direct connection
- **Data layer:** Drizzle ORM + migrations (SQL-close, serverless-friendly; chosen over Prisma)
- **Editor & body format:** **Canonical body format is Markdown** (an extended dialect: CommonMark/GFM plus Pandoc features — footnotes, superscripts, citations, attribute spans — and inline HTML `<mark>`/`<span>` for sermon colors/highlights). `items.body` stores `{format, text}` (jsonb), `format: "markdown"` by default; markdown-family formats like `chordpro` are allowed per type. Markdown is the **source of truth**; rich features layer on top of it per content type, and every other output (Word/`.docx` via pandoc, chord charts, slides, print/PDF) is **rendered from** the markdown, never stored as a second source. The editor is a **markdown-native WYSIWYG** surface (renders rich, not raw, with a likely source/preview toggle); the specific library is TBD (tiptap / Milkdown / Lexical with markdown serialization are candidates). A content type may declare its own canvas (chord editor, paper workspace); types without one get the default markdown canvas. The polished "Notion feel" (slash menu, block drag) is wanted but explicitly **not** a v1 requirement: revisit later, or adopt an existing lib. (Pivot from BlockNote-JSON-canonical: ADR-037.)
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
- **No deploys Saturday night — once Ledgr is in real Sunday use.** The rule guards a working tool Brandon relies on for Sunday; it does not apply during build-out, when there's nothing live to break and shipping fast matters more. Treat it as active from the day Brandon starts preaching/working from Ledgr (track that flip in `decisions.md`), not before.
- **Standardized, generic language in the tool's UI.** Prefer plain, conventional product language over church-specific jargon for labels, buttons, and surfaces (e.g. "Save Offline", not "Pulpit Ready"; "Sync to Storage" over insider terms). Brandon is the only user, but the tool should read like a general product so its concepts stay portable. PRD section names can keep their original wording; this is about what's rendered on screen.
- **Writing style for any prose Claude generates for Brandon:** no em dashes (use commas, colons, parentheticals, or rework); don't split a contrast into two choppy sentences; concise, direct, warm, active voice.

## Building together (Brandon + Tyler)

Ledgr is now built by two people sharing one codebase and schema, each deploying their own single-tenant instance (separate Vercel + Neon; `owner_id`-everywhere makes this clean). The risk in the foundation phase is not scheduling, it's two people making different decisions about the same core. Guardrails:

- **Core is frozen behind agreement.** A change to anything in the **core list** below needs both people to agree and an ADR in `decisions.md` before it merges. Everything else, either person moves fast on, solo.
  - **Core (both-agree + ADR):** the data model / `schema.md` (`items`, `types`, `relations`, `revisions`, properties, owner-scoping); the **canonical body format** and its `{format, text}` contract; the **type + canvas model** (bespoke-per-type, the single catch-all, the promotion path, how a type declares a canvas); the **module system boundary** (how a module registers its type/canvas/exporters/integration, and the per-user enable model); the **provider interfaces** (storage, auth, scheduler, calendar, mail, push, tasks); the cross-cutting invariants (owner-scope every query, no `body` in list queries, soft-delete + revisions, the FTS approach, incremental syncs); the **machine/MCP API contract**; and the nine principles above.
  - **Not core (move fast, solo):** individual module internals (papers, songs, discipleship, sermons, hiring — their canvases, exporters, stage models); UI/UX polish; view definitions and dashboard widgets; per-instance adapter choices (Microsoft vs Google vs iCloud) and per-instance integrations (Savor, Atlas, PCO).
- **`COLLAB.md` is the heads-up board.** Two sections only (Brandon, Tyler), each holding *current* availability and plan ("away until Tuesday," "this week: papers module"). Overwrite in place, no archive. Pair it with a quick Discord/Telegram ping. Decisions go in `decisions.md`; plans go here.
- **Modules are standalone on a shared frame.** Build each module so it registers onto core rather than reaching into it. Keep boundaries clean now so per-user enable/disable is a later config flip (module-ready, not a marketplace — the analog of "multi-user-ready, not multi-user").

## When you finish a slice

Update `next_steps.md` (move the slice to done, name the next one), check the box in `roadmap.md`, and if you made a real architectural choice, log it in `decisions.md`.
