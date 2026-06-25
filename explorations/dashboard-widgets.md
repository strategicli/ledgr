# Exploration: richer dashboard widgets + flexible layout

**Status:** parked (Brandon, 2026-06-13). Not intent, not a decision; a Phase 2 follow-on or Phase 3 Build-surface feature. Raised reviewing slice 29.

> **Follow-on (2026-06-25):** the *visual* customization of the dashboard (full-bleed backgrounds, per-widget chrome toggles, any-item embed/sticky notes, tab/section containers) is now decided and planned separately in **`dashboard-canvas.md`** (ADR-111). This doc's "richer widget types/sizes" half shipped via ADR-064/065; the "universal placeable widgets on item canvases" carry-forward below is still post-1.0 and distinct from both.

## What's there now (slice 29 / ADR-031)

The dashboard pins View Definitions as cards in a uniform responsive grid (1/2/3 columns), each card a list preview + a count badge, with native drag-reorder and an equal-height toggle. Every widget renders the same way **regardless of the view's layout** — a calendar view and a table view both show as a list preview.

## What Brandon wants

A genuinely customizable dashboard:

- **Widget types beyond the list preview.** A widget should be able to render as its view's layout (a mini calendar, a small table, a board), and there should be non-view widget types too — a single number/count "stat" card, maybe a chart, a notes/quick-capture widget.
- **Flexible layout, not a fixed 3×3.** Widgets that span more than one cell (2×1, 2×2), sidebars / distinct regions, a real grid the user shapes.
- **Per-widget settings.** How many items show, sort, some design choices (density, accent), title override.

## Constraints to honor if built

- The config still rides existing structures where it can: today `views.dashboard_order` is the whole config. Sizes/types/regions need more — a `dashboard_layout` jsonb (per owner) or a small `dashboard_widgets` table. Prefer extending over a new table until multiple dashboards are real (rule 5, "multi-user-ready not multi-user").
- Reuse the slice-27 `ViewRenderer` for the layout-faithful widgets rather than writing parallel renderers — a widget becomes "a view rendered at card scale."
- Few dependencies (rule 5): native HTML5 DnD got reorder for free; resizable/spanning grid is the point where a small library (or a CSS-grid-based home-grown solution) earns its keep — justify it then.
- Fast + cheap (rule 8): the dashboard already does one count + one capped preview query per widget; richer widgets must stay batched and body-free.
- Mobile stays vertical-scroll (PRD §4.11); spanning/sidebars are a desktop affordance that collapses on small screens.

## Relationship to other parked work

- This is squarely the **Build surface** territory (PRD §4.10/§4.11): the widget palette and grid editor are Build-surface configuration. It may wait for that shell rather than landing piecemeal.
- A "stat" widget (just a number) is the cheapest first step and could ship before the full grid editor — it reuses `countViewItems` and needs no new layout engine.

## Direction (Brandon, 2026-06-13)

- **The dashboard is intended to become the Work home**, replacing the fixed Phase-1 Today layout once the richer widget types/sizes exist. Slice 29 kept `/dashboard` separate deliberately (don't break the working Today mid-build); the merge happens when widgets are good enough to carry the home. Until then, `/dashboard` is the staging ground and Today stays as-is.

## Open questions

- One dashboard or several (per context: a "Sunday" board, a "weekly review" board)? (If several, the merge-into-home picks a default.)
- Widget config UI: inline on the card (like Notion) vs a separate edit mode?

## Carried forward (Brandon, 2026-06-21; verified 2026-06-22) — universal, host-scoped placeable widgets

A refinement on top of the now-shipped multi-dashboard build (ADR-064/065): **make a widget droppable onto any item or type canvas, scoped to its host.** Use case Brandon named: stop hand-building per-person query blocks on meeting notes — drop one standard "open tasks related to the people on this item" widget and it scopes itself per item. Pair it with **per-type default widget layouts** so a type comes with a sensible arrangement out of the box (not Notion-style homework).

**Verified state on main:** the two building blocks exist but are not wired together. (1) Dashboard widgets are dashboard-only (`WIDGET_KINDS = view|stat|action|text`, `src/lib/dashboard-widgets.ts`); a *dashboard* can carry a `focusItemId` that `applyFocus()` merges as `relatedTo` into every widget — the host-scoping seed, but bound to a dashboard, not an item canvas. (2) The item canvas (`src/lib/canvas-layout.ts`, ADR-069) arranges a closed set of field-level cards (`title`/`body`/`related`/`prop:*`/`rel:*`/…) — there is **no `view`/`query`/`widget` card kind**. (3) The event task-pull (`src/lib/events/task-pull.ts`, ADR-094) is exactly "tasks related to the people on this item" via a `@people` sentinel — but it's a bespoke `event`-only card, not a generalized placeable widget. (4) Per-type layouts are *generated* (`defaultLayout`), not curated/shipped per type.

The build is therefore: add a `view`/`query` card kind to the canvas vocabulary + a host-scoping mechanism on it (auto-bind `relatedTo: <this item>`, generalizing the proven `@people` / dashboard `applyFocus` patterns). This is the same convergence `flexible-surfaces.md` §2 describes (interactive embeds on any surface) and `flexible-surfaces.md`'s recommendation holds: build one block/layout engine shared with the dashboard, don't fork. Post-1.0.
