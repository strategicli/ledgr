# Exploration: project treatment for items with subtasks

**Status:** parked (Brandon, 2026-06-12). Not intent, not a decision; revisit in a later phase.

> **Meeting note (2026-06-14, ADR-057):** confirmed in practice that **a project is *not* a functional type — it's a relational connection** across tasks/meetings/notes. Live test data created a "project" entity linking items, and both agreed nothing functionally changes about a task when it gains subtasks or a parent; it just needs relations ("relational connections... that's all you really need"). So any future "project treatment" is purely a presentation/behavior layer over a related item (the constraint already noted below), never a new type or table.

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
