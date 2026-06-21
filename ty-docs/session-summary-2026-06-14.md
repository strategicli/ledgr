# Ledgr Session Summary — June 14, 2026

A working session covering (1) the design of **Ledgr**, a personal life-manager /
digital brain; (2) the decision to build it jointly with Brandon on his existing
codebase; (3) a set of planning docs capturing the architecture; and (4) a built,
tested **MSM Word renderer** for seminary papers. This file is the record to pick
up from.

## The product: Ledgr

A single-user "digital brain" — part task/project manager, part life/work wiki,
part creative-work catalog — with an MCP server so Claude can answer questions
about everything in it directly. Stack matches Tyler's standard: Next.js on Vercel,
Neon/Postgres, Drizzle, Clerk, shadcn/ui; PWA now, native iOS wrapper later.

Core idea that shaped everything: **the schema and the MCP are the product;
surfaces are mostly Claude-generated on demand** rather than hand-built (the
inverse of a Notion-style view-builder). A few daily surfaces still earn permanent
UI (today/dashboard, capture, people-before-Sunday); the rest is conversational.

Modules identified, as workflows rather than one generic store:
- **Papers** (seminary) — first to build
- **Discipleship / relationships** — second; leadership-timing urgency
- **Songs** — chord studio (ChordPro), progression DB, Planning Center export
- **Sermons / lessons** — lighter; benefits from Savor + Scripture entities maturing

Integrations: **Savor** (Scripture journaling — pulls in read-only; already emits
structured passage refs), **Atlas** (church ops — read-only work tasks/projects),
**GitHub** (scan `next_steps.md` across repos for dev-portfolio state). MCP-as-hub
gives one Claude connector over the whole ecosystem.

## The big decision: build with Brandon

Brandon already had Ledgr at v0.17 with ~15 verified slices. On review, his system
is **not** a Notion clone — it's typed system-objects (task/meeting/note/link/entity)
with a custom-type sandbox, a real relations edge table, weighted FTS, and MCP as a
first-class principle. That's the foundation Tyler would have wanted, so the plan
shifted from "compare approaches" to "build together."

Agreed shape: **shared codebase, separate single-tenant deployments** (his
`owner_id`-everywhere discipline makes this clean; pastoral/personal data never
mixes). **Tyler and Brandon talked and are aligned.**

Key architecture decisions:
- **Canonical body format is per-type.** Brandon's BlockNote-canonical stays the
  default (sermons need colors); Tyler's papers/songs/slides are **markdown-canonical**
  (portability + multi-output rendering). Same items table, different body format.
- **A system type may declare its own canvas** (the co-own-vs-fork hinge; accepted).
- **Contributed workflow modules** — system type + canvas + exporters + optional
  integration, packaged as a unit. Extends Brandon's Tier-3 type-specific code.
- **Scripture references as first-class entities** (`entity.kind = passage`).
- **Provider seam for calendar/email** — Brandon = Microsoft (Graph), Tyler =
  Google; building the seam answers Brandon's own open question 7.
- **iOS App Store wrapper** — Tyler's hard requirement, additive, the final phase;
  PWA decisions made wrapper-aware now.
- **Todoist:** adopt Brandon's Ledgr-canonical rule (better than last-write-wins),
  recurrence delegated to Todoist.

Open question still to settle together: **discipleship privacy tier** — a
`confidential` flag that excludes items from MCP/export/briefings (Tyler's lean) vs
field-level encryption. Both have the same pastoral-notes need.

## What got built / written this session

**Planning docs** (slot into Brandon's repo structure; the first is the one to send
Brandon):
- `FOR-BRANDON-approach-diff.md` — same / differs / extends / separate + 6 decision points
- `tyler-additions-overview.md` — contributed-module pattern, markdown-canonical, custom canvas, Scripture entities, wrapper phase, module roster + build order
- `module-papers.md`, `module-discipleship.md`, `module-songs.md`, `module-sermons-lessons.md`
- `integrations-savor-atlas.md` — Savor pull, Atlas link, GitHub scan, provider seams
- `README.md` — index

**MSM Word renderer** (built and verified):
- `msm-render.js` — Markdown → MSM-compliant `.docx`. Title page, double-spaced body,
  real Word footnotes (positional allocation — duplicate-ID bug structurally
  impossible), block quotes, hanging-indent bibliography, correct page numbering.
- `README.md`, `CLAUDE_CODE_HANDOFF.md`, `sample-paper.md` / `.docx`.
- Verified page-by-page against the MSM spec.

## The Papers "paper writer" — scoped, not yet built

Confirmed against the live repo: **no schema migration needed.** A paper is an item
with `type='paper'`, stage/course/due in `properties` (JSONB, indexed); quote-bank
entries are `quote` items via the existing relations table. The decisive finding:
the existing `markdown.ts` exporter has **no footnote support** (BlockNote has no
footnote block), which is exactly why papers must be **markdown-canonical** — the
author types `[^1]` markers that the renderer consumes.

Minimal slice (≈1 focused day):
1. Seed the `paper` type (types row + register in the UI type lists). Config, no migration.
2. Markdown editor for `type='paper'` in `ItemEditor` (textarea → CodeMirror later);
   store body as `{format:'markdown', text}`, mirror to `bodyText` for FTS. (Confirm
   storage shape with Brandon since it's shared.)
3. Port `msm-render.js` into an `app/api/items/[id]/render-docx` route.

Explicitly deferred from v1: quote-bank-as-linked-items with a drag-to-cite sidebar
(quotes live as inline footnotes for now), MCP, stage automation.

## Context: the three immediate papers

Tyler has 3 MBTS papers due within ~2 weeks. Guidance held throughout: **don't build
the module under deadline pressure.** The renderer already delivers the formatting
payoff today (write markdown anywhere → render to MSM `.docx`); the in-Ledgr paper
writer is the durable version and can follow the papers. Running the workflow by
hand on these three is itself the best spec for the module. (Masters-folder rule
honored: formatting/organization help only, never content generation.)

## Where to pick up

- **Send Brandon** `FOR-BRANDON-approach-diff.md`; drop all planning docs in the repo.
- **Hand Claude Code** the `msm` folder (`CLAUDE_CODE_HANDOFF.md` first) — use as-is
  for the current papers, and/or integrate as the Papers export route.
- **Calibrate** the renderer's `TP` title-page constants against the 2 Timothy
  100/100 benchmark when convenient.
- **Decide with Brandon:** the discipleship privacy tier.
- **Build order when ready:** Papers → Discipleship → Songs → Sermons; integrations
  and MCP after; iOS wrapper last.
