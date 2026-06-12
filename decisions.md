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

<!-- Add ADR-002 onward as the build proceeds. First likely entries:
  - repo scaffold choices (App Router, project layout)
  - entity `kind`: column vs properties
  - error capture: error_log table vs Sentry
  - OneDrive export file scope: app-only vs delegated token
-->
