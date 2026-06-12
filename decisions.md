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
