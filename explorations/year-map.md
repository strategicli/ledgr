# Year Map

**Status:** slice 1 built 2026-10-02 (ADR-287). Slices 2 and 3 are the queue.
**Visual spec:** `explorations/year-map-mock.html`, also at https://claude.ai/artifact/VSA9umLnBeHNLYufYnkNoq.

## What it is

A calendar mode, not a type. One saved view lays a year (or a fiscal year, or a few months) out as month rows. Each row is a month with days lined up by weekday. Items are colored bars, labeled and stacked, and the whole thing prints on one landscape sheet. It ships as the `year-map` module, default off. Switching it on creates a "Year Map" saved view.

## What slice 1 built

- **A module slot for calendar modes.** The manifest's `calendarModes` says a mode exists; `src/lib/module-calendar-modes.tsx` wires the id to a renderer. A module that is off, or an unknown id, renders as Month and keeps the stored mode.
- **Per-mode saved settings** at `display.modes.year`, opaque to core, parsed by the module.
- **The view**, with these controls: Layout (Scroll or Fit), Columns (Weekdays or Day 1), Text px, Day px, Window (calendar year, fiscal year with a start month, rolling N months), Color by, Style by, a legend, and a More menu (fade past, shade weekends, dots, Paper, Print).
- **A hidden flag on fields** (`hidden` on `PropertyDef`, a checkbox in the type builder) so a helper field can drive a view without cluttering the item page. See ADR-287.
- **`assignLanes`**, exported from `src/lib/planner-overlap.ts`: shared lane packing for the bars.

## Where the code lives

- `src/modules/year-map/`: `manifest.ts`, `lib.ts` (pure: settings parse, window, month geometry, segments, color and style), `YearMap.tsx` (server half: resolves rows to spans and values), `YearMapClient.tsx` (the grid and controls), `year-map.css`, `server.ts` (seeds the first view).
- Core touchpoints: `src/lib/views.ts` (`ViewMode`, `display.modes`), `src/lib/modules.ts`, `src/lib/module-calendar-modes.tsx`, `ViewRenderer.tsx` (calendar branch), `ViewBuilder.tsx`, `src/app/views/[id]/page.tsx` (wide page, `VIEW_MAX`), `src/app/api/settings/route.ts` (seeds on first enable).
- Check: `npx tsx scripts/verify-year-map.mts`.

## Design decisions

- A view mode, not a type, so any item with a date shows up and nothing is copied.
- Module, default off, per ADR-272.
- Weekday columns by default (37 slots, so a month starting Sunday still fits), with a Day 1 option.
- Scroll by default (a fixed width per day), with a Fit option. Text size and day width are plain pixel numbers.
- Color by one field, with a color per value set from the legend swatches. Style by a second field, mapped in order to outline, striped, bold, dashed, caps, dot.
- Clicking a legend chip hides that group. Hidden groups are saved in the view.
- Bar labels stay visible while you scroll. A centered hover card shows the details. Today is marked, past items fade, and one-day items become dots when days are narrow.
- Window: calendar year, fiscal year (any start month), or rolling N months.
- Print through the browser, with a paper picker: Letter (default), Legal, Tabloid, A4, A3, all landscape.
- Settings save per view, so several Year Map views can hold different looks.
- Fields marked Hidden still appear (labeled) in the color and style pickers.

## Known ceilings

- **No date window in the query.** The view reads at most `VIEW_MAX` (2,000) rows in the view's own sort, then places them. A view with more rows than that can drop items that fall in the window. Fix when it bites: pass the window's date range into the view query.
- **A no-type view falls back across date sources.** With no type or custom date field chosen, an item uses its plan date, else its meeting time, else its note date.
- **Color and style use an item's first value** for a field with several values (tags, multi-select).

## Next slices

- **S2: edit on the map. BUILT 2026-10-02.** Drag a bar to move it, drag an end to resize it (or stretch a one-day item into a span when the view names an end field), drag across empty days or double-click one to create. Writes go through `buildPatch` in `src/lib/placement.ts`, the same path the Timeline uses, with an Undo toast. Hit testing reads the date off the day cell under the pointer, so drags cross month rows with no geometry of their own. The pure drag math (`dragSpan`, `addDays`, `dayDiff`) is in `lib.ts` and checked by `scripts/verify-year-map.mts`. Ceiling: mouse and pen only; touch keeps scrolling, and a long-press gesture is the upgrade.
- **S3: Outlook overlay and a dashboard widget.** Show Outlook events as a read-only layer, limited to all-day and multi-day events (a timed meeting is noise at this zoom). Add a dashboard widget preset with a rolling 3-month window, using the same renderer and per-view settings.
