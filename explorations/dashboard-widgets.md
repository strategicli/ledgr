# Exploration: richer dashboard widgets + flexible layout

**Status:** parked (Brandon, 2026-06-13). Not intent, not a decision; a Phase 2 follow-on or Phase 3 Build-surface feature. Raised reviewing slice 29.

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

## Open questions

- One dashboard or several (per context: a "Sunday" board, a "weekly review" board)?
- Is the dashboard eventually the Work home (PRD §4.11 implies yes), replacing the fixed Today layout, or a peer surface? (Slice 29 deliberately kept them separate.)
- Widget config UI: inline on the card (like Notion) vs a separate edit mode?
