# Exploration: project treatment for items with subtasks

**Status:** parked (Brandon, 2026-06-12). Not intent, not a decision; revisit in a later phase.

> **Meeting note (2026-06-14, ADR-061):** confirmed in practice that **a project is *not* a functional type — it's a relational connection** across tasks/meetings/notes. Live test data created a "project" entity linking items, and both agreed nothing functionally changes about a task when it gains subtasks or a parent; it just needs relations ("relational connections... that's all you really need"). So any future "project treatment" is purely a presentation/behavior layer over a related item (the constraint already noted below), never a new type or table.

## The idea

When a task accumulates subtasks, it's often really a *project*. Ledgr could notice that and treat it differently:

- A distinct icon and styling in lists (so projects read differently from one-off tasks)
- Project-specific features: progress visualization beyond the n/m rollup, maybe a default view of its subtree, milestone-ish grouping
- Possibly a threshold or an explicit "promote to project" gesture rather than anything automatic

## Constraints to honor if built

- Everything stays an item (rule 2): "project" would be a presentation/behavior layer over a task with children, or at most a built-in type, never a parallel table.
- Subtask checklists are a task-only built-in (ADR-018). A project treatment is the sanctioned way that affordance would widen, rather than putting Subtasks back on every type.
- Deterministic: whatever marks something a project is a flag or a rule, not a model call.

## Open questions

- Automatic (has children → styled as project) vs explicit (user promotes)? Automatic is zero-friction but surprising; explicit matches "AI on purpose" culture.
- Does a project deserve its own list page / nav slot, or is it a filter on /tasks?
- Relationship to the Build surface: is "project" just the first workflow template (§4.14)?

## Carried forward (Brandon, 2026-06-21; verified 2026-06-22) — the layer *above* a project ("initiative" / "arc" / "season")

Distinct from the `project` *type* that now exists on main (Tyler's Tasks redesign: a `project` type with workflow statuses + repo/liveURL/stack props). Brandon wants the **layer above** a project: a multi-month, **no-due-date** container, only 2-3 active at once, a place to "keep tabs on everything related." He came full circle to: it's essentially **"a tag that is a type — a really specific dashboard you make."**

**Resolution he reached:** make it a **TYPE that's built-in-by-default but hideable/renamable** (because a type item has a markdown body + can host scoped widgets), **not** a dashboard-only thing. He also wants a **"duplicate type" button** so a user can clone `tag`/`initiative` and rename it.

**Verified state on main (2026-06-22):** every primitive this needs already exists, so this is *largely expressible today* — what's missing is the convenience wrapper and one shipped seed:
- Hideable type (ADR-059, `/api/types/[key]/hidden`), renamable label (ADR-068, `/api/types/[key]/rename`, key immutable), markdown body (default canvas), the universal Related panel ("gathers everything related"), and dashboard focus (`focusItemId`, ADR-065) — all present. A type needs no due date and isn't required to.
- **"Duplicate type" — NOT BUILT.** No clone-type route/UI (`/api/types` is GET/POST; `[key]` is GET/PATCH/DELETE). Notably *views* already have a `DuplicateViewButton` — the pattern exists, just not extended to types.
- The "scoped widgets on a type/item canvas" half is the `dashboard-widgets.md` "host-scoped placeable widgets" refinement (also not built).

So the honest build is small: (a) a **duplicate-type** button/API (mirror `DuplicateViewButton`), optionally (b) a seeded-but-hideable `initiative` type, and it inherits the host-scoped-widgets work when that lands. Before building a bespoke `initiative` type, confirm the existing `project` type + a focused dashboard + relations don't already deliver it (Brandon's own "came full circle" suggests they nearly do). Post-1.0.
