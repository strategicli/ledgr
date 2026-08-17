# The project markdown file — a whole project as one readable document

**Status:** designed in conversation, awaiting Tyler's finalize (2026-08-17). Not built. Touches Principle 1 (DB canonical, markdown one-way) and sits beside `storage-organization.md` (how types lay out as exported MD — core, both-agree), so settle the mechanism question below before building.

## The idea (Tyler, 2026-08-17, assembled from the brainstorm)

Every project has **a markdown file associated with it** — one document a person can read (or hand to someone) that tells the whole story of the project without opening Ledgr. In it:

- **Who** — a small section at the top: the people associated with the project.
- **Summary** — the project's overview text.
- **Timeline** — the project's history as dated lines ("the timeline lives in the markdown... that way users don't need to make a new type for that").
- **Milestones** — with their dates/completions.
- **Tasks** — what tasks were added, with **date added and date completed**.
- **Meetings** — when they were scheduled (time + date).
- **Links** — with the URL itself in there, **clickable from the markdown file**.

This supersedes (or absorbs) the standalone vertical review page direction in `project-review-timeline.md` — Tyler's instinct is the markdown IS the review surface.

## Recommended mechanism (Claude's feedback, pending Tyler's call)

**A deterministic projection, rendered on demand — never a stored second copy.** The DB stays canonical; the "file" is the project *rendered as* markdown, the same way a song renders as a chord chart. Storing it (in the body, or as a real file kept in sync) would make every task tick a document edit too — the bidirectional-sync trap Principle 1 exists to forbid.

Concretely:

1. **A pure composer** (`projectMarkdown(record, collections)` in lib): title → people → summary (the body) → milestones → tasks (added/completed dates) → meetings (date + time) → links (`[title](url)`) → timeline (the merged dated history). Pure function, unit-verifiable.
2. **Served where markdown already lives:** `/items/[id]/markdown` (the ⋯ → Markdown view) renders the composed document for widget-home records instead of just the bare body, with the existing copy/download affordances.
3. **The OneDrive export emits the same composition** for project items, so the .md sitting in OneDrive is this document — readable, links clickable, Sunday-proof, shareable outside Ledgr.
4. **One data gap to close first:** task completion dates aren't stored. Widen the ADR-196 `properties.completed_at` stamp from milestones to tasks (same hook, additive; recurring series never enter done so they're naturally exempt). Historical completions render with an approximate date (`updated_at`) until re-completed.

**Explicitly not:** a user-editable generated document (edits would be overwritten by the next render), or a new item type. The user's editable prose is the overview (already in the body); everything else is derived.

## Open questions for the finalize

- Section order (proposal above: who → summary → milestones → tasks → meetings → links → timeline at the end as the full history; Tyler may want timeline higher).
- Does the in-app **Timeline page** (`/items/[id]/timeline`) stay as the interactive twin? (Proposal: yes — same data, two renderings.)
- People links: plain names in the markdown (portable) vs `ledgr://` item links (rich in-app, dead outside). Proposal: plain names in the export, linked in-app.
- Whether the composed document also becomes the **print/PDF** rendering for projects.
