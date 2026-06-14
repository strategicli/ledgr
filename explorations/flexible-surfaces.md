# Exploration: more flexible interactive surfaces (configurable columns → custom pages)

**Status:** part 1 (per-view columns) **BUILT** (2026-06-14, ADR-049); part 2 (custom composable pages) still parked. Build-surface (PRD §4.10/§4.11) territory. Sibling to `dashboard-widgets.md` (this is the broader frame; that note stays the dashboard-specific cut).

## What Brandon wants

> "There should be more places where a user can select what properties show in what view — the items list only shows the created date on most items. Or maybe it's more about letting the user build custom pages and embed things: a task entry form, a 'new meeting' button, a view of a certain type with certain properties. The interactive surfaces need to be more flexible."

Two scales in one note, smallest first:

### 1. Per-view column / property visibility (near-term, concrete) — ✅ BUILT (ADR-049, 2026-06-14)

> Shipped: `columns` jsonb on `views` (migration 0010), tolerant `parseColumns`, `ViewBuilder` Columns picker, `ViewRenderer` list/table/agenda honoring it with type-schema-resolved property labels. The rest of this section is the original plan, kept for the record.

Today a view's row set is fixed in code. `ViewRenderer.tsx` decides what each layout shows; the list/table layouts surface type + title + a single date and a couple of system chips (status/urgency), with no per-view choice of which properties appear. `ViewItem` already carries `properties` (the board grouping rides it, ADR-046), so the data is present — what's missing is a **`columns` field on the View Definition** and a renderer that honors it.

- Extend `ViewDefinition` (`src/lib/views.ts`) with an ordered `columns: { source: "field" | "property", key: string }[]` (system fields like dueDate/createdAt/status + custom `property_schema` keys). Null = today's default.
- `ViewBuilder` offers a column picker off the view's type schema (same pattern the board-grouping picker already uses).
- `ViewRenderer` table/list render the chosen columns; keep it body-free and batched (rule 8).
- Resolves the literal "only shows created date" complaint, and is self-contained (views are non-core).

### 2. Custom composable pages with interactive embeds (larger, future)

The bigger ask: user-built pages that compose **interactive** blocks, not just read-only widgets —

- an **embedded entry form** (capture a task/meeting inline with chosen defaults),
- an **action button** ("New meeting", "New from <template>") wired to the create path,
- an **embedded view** of a type filtered to chosen properties/columns (#1 is the building block),
- alongside ordinary markdown/text.

This is the generalization of three things that already exist as point features: the dashboard (read-only view widgets, `dashboard-widgets.md`), the template-aware "+ New ▾" button (`NewItemButton`), and embedded query views on entity canvases (`EmbeddedView`, ADR-030). A "custom page" is a saved layout of blocks where some blocks are those existing pieces made placeable.

## Constraints to honor if built

- **Reuse, don't fork.** A page's "view block" is the slice-27 `ViewRenderer` at page scale; its "button"/"form" blocks are the existing create/capture components made embeddable. No parallel renderers (the dashboard-widgets rule, generalized).
- **Config rides existing structures first (rule 5).** #1 is a column list on `views`. A custom page needs a place to live — likely a `page`/catch-all **item type with a block-layout body**, or a small `pages` table only once #1 + a couple of block types prove the shape. Prefer extending over a new table until multiple custom pages are real ("multi-user-ready, not multi-user").
- **Deterministic (rule 3).** Forms/buttons are plain create calls, no model in the loop.
- **Fast + cheap (rule 8):** each embedded view is still one count + one capped, body-free query.
- **Mobile stays vertical scroll (PRD §4.11);** multi-region page layouts are a desktop affordance that collapses.

## Relationship to other parked work

- **`dashboard-widgets.md`** is the read-only-widgets-on-the-home cut; this note is the wider "any surface, including interactive blocks, anywhere." If the dashboard becomes the Work home (that note's direction), custom pages and the dashboard likely converge on one block/layout engine — build the engine once.
- **#1 (per-view columns)** is a prerequisite for the "view with certain properties" block in #2 and is shippable on its own.

## Recommendation

Split the ask: **#1 is a near-term, self-contained view-builder slice** (non-core, no ADR needed) and is the honest answer to the "only shows created date" pain. **#2 is a Build-surface design effort** that should converge with `dashboard-widgets.md` on a single block/layout engine rather than landing piecemeal; decide its data home (catch-all `page` item vs `pages` table) when #1 and the first interactive block exist. See [[dashboard-widgets]].
