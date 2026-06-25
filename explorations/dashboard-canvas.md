# Plan: the dashboard canvas

**Status:** decided 2026-06-25 (Brandon), logged as **ADR-111**. **Not core** (the Work-surface dashboard; the "views/dashboard widgets, move fast solo" side of the collab line, like ADR-064/065). One additive schema change (`dashboards.appearance`); everything else rides existing jsonb or reuses shipped machinery. This is the build plan; the decision record is ADR-111.

## The idea

ADR-064/065 made dashboards real: multiple named, resizable/draggable grids of `view`/`stat`/`action`/`text` widgets, a dashboard-level focus, Set-as-Home/Today. The base is good. This turns the dashboard from "a uniform grid of cards" into a **canvas with three customization layers**, plus a way to embed and type into real items:

1. **The stage** (whole dashboard): background color, gradient, image, or video, with a legibility scrim; plus title-visibility and density.
2. **The widgets** (each tile): toggle the header, toggle the border, set a background color and accent, collapse.
3. **Containers** (new): a tab / stack / section widget holding other widgets.
4. **Item embed** (new): drop any item onto the board and edit it in place. The sticky note is this with a color and no header.

## What exists today (the base to build on)

- `dashboards` table: `name`, `position`, `focus_item_id`, `widgets` (jsonb). One row read + a batched per-widget data fan-out. (`src/lib/dashboards.ts`)
- Widget shape `{id, kind, viewId, settings, layout}`; kinds `view`/`stat`/`action`/`text`. Pure shapes + helpers in `src/lib/dashboard-widgets.ts` (client-safe); tolerant parsers + CRUD in `src/lib/dashboards.ts`.
- Grid: `react-grid-layout@1.5.3` behind a `dynamic ssr:false` boundary (`DashboardGridLayout` -> `RglInner`); breakpoints lg/md/sm at 12/6/1 cols.
- `WidgetFrame` renders card chrome (header + count + gear + remove) over `WidgetBody`; the `text` kind already renders **chrome-free**, which is the proof that per-widget chrome is feasible.
- One save path: debounced layout PATCH + `router.refresh()` for data-changing edits, all through `PATCH /api/dashboards/[id]`. Parsers are tolerant (unknown keys dropped, numbers clamped), so adding fields is safe and migration-free when they live inside the `widgets` jsonb.
- R2 storage behind the storage-provider interface (presigned URLs) is already the path for uploaded bytes.
- The autosaving markdown editor (`ItemEditor` / the default canvas) already edits an item's title + body and snapshots revisions; the embed widget reuses it.

## Data model changes

- **`dashboards.appearance` jsonb** (one additive migration): the stage. `{ background: { kind: "none"|"color"|"gradient"|"image"|"video", value, scrim: 0-1, blur: 0-1 }, showTitle: bool, density: "comfortable"|"compact", accent?: string }`. `null` = today's plain dark dashboard, untouched (never forced, the canvas-layout precedent).
- **`DashboardWidget.appearance`** (rides the existing `widgets` jsonb, **no migration**): `{ showHeader: bool, showBorder: bool, background: "panel"|"transparent"|<colorToken>, accent?: string, collapsible: bool, collapsed: bool }`. Tolerant parser, sensible defaults (a missing `appearance` = today's full-chrome card), so existing dashboards render identically.
- **New widget kinds** in `WIDGET_KINDS`: `embed`, `container`.
  - `embed` adds **`itemId`** (sibling to `viewId`): the item it renders/edits.
  - `container` carries `{ mode: "tabs"|"stack"|"section", activeTab: number, children: DashboardWidget[] }` in its settings. One-level nesting only.
- Image/video bytes -> R2 (existing provider). `appearance.background.value` stores a storage key or a color/gradient token, never bytes.

## The four capabilities

### 1. The stage (dashboard background)

- **Looks:** the grid floats over a full-bleed background. The scrim (an adjustable dark overlay) + an optional blur keep widgets legible over any photo. That overlay is the whole trick: without it, text on a photo is unreadable, which is why Notion limits backgrounds to a header strip.
- **UI:** in Edit mode a `Background` button opens a panel: none / color / gradient / image / video, an upload or a small curated set, two sliders (scrim darkness, blur), live preview. Dashboard-level toggles for title visibility and density live here too.
- **Storage:** `dashboards.appearance`. The PATCH body gains `appearance`; the page reads it server-side and applies it to the stage wrapper.
- **Video caveat (the one cost item, rules 4 + 8):** opt-in, off by default; muted, looped, `playsInline`; paused when the tab is hidden; disabled under `prefers-reduced-motion`; always a poster still so slow wifi and the offline fallback degrade to a static image. Backgrounds never touch the export or print path, so nothing preached depends on them.

### 2. Per-widget appearance + collapse

- **Looks:** header off + border off + transparent background = content floating directly on the stage (the big stat number). A solid background = a colored tile (the sticky note, a colored stat). An accent edge tints a tile. Collapsed = a single one-line bar.
- **Behavior:** collapse is a **view-mode** chevron (not edit-gated), so a reader folds a section to its title bar; it remembers the expanded height (keep the grid `h`, render a forced height of 1 while collapsed) and restores on expand. State persists.
- **UI:** `WidgetSettingsPopover` (the gear) gains an Appearance section: Header / Border / Collapsible toggles, a background swatch row, an accent swatch row.
- **Storage:** `DashboardWidget.appearance` in the `widgets` jsonb. No migration. `WidgetFrame` branches on `appearance` (generalizing today's `if kind === "text"` chrome-free path to all kinds).

### 3. Item-embed widget (any item)

- **Looks:** a tile showing an item's title (toggleable) + body, editable in place. A sticky note is an `embed` with a colored background and the header off.
- **Behavior:** typing autosaves straight to the item via the existing editor (revisions snapshot as usual). Because it is a real item it stays searchable, exportable to OneDrive, openable full-screen, and relatable. Embeds **any** item, not only notes (a meeting's notes, a person page, a task) (Brandon, 2026-06-25).
- **UI:** "Add widget -> Embed an item" opens the item picker (the existing search/picker); or "New note" creates a `note` and embeds it. The lightweight `text` widget **stays** for pure labels/headings (a header should not cost an item).
- **Storage:** `embed` kind + `itemId`. The page fan-out fetches the embedded item's body (the one place a widget reads a body, acceptable since it is the content).

### 4. Tab / section container

- **Looks:** a card whose header is a tab strip (This week / Next / Someday), or a vertical stack of child widgets, or a collapsible labeled section.
- **Behavior:** one `container` kind, a `mode` switch. Holds child widgets; shows the active tab. One-level nesting (containers do not nest), so the server fan-out is a single recursion.
- **UI:** in Edit mode, drag widgets into the container or "add to this tab." Whole-*page* tabs (a Sunday board, a review board) are already served by **multiple dashboards** + the switcher, so the tab *widget* is only for tabs *within* a board.
- **Storage:** children + mode + activeTab in the container's settings (inside the `widgets` jsonb). This is the heaviest slice; build it last.

## Deferred: journal / daily-note mode (future, more plumbing)

Brandon (2026-06-25): a "new page" affordance that creates an item **titled by date** (e.g. today's date, from a template) and surfaces today's entry, optionally listing recent ones. Builds on item templates (ADR-093) + a date-naming rule + the `embed` widget. Spec'd here, not in the first build; revisit after slices 1-4 prove the embed.

## Build order (each slice independently shippable, cheapest-first)

1. **Per-widget appearance + collapse.** No migration. Biggest visible change for the least work; generalizes the `text` chrome-free path. Acceptance: a widget can hide its header/border, take a background color + accent, and collapse to a bar with state persisting; existing dashboards look identical (defaults = today's chrome).
2. **Dashboard background.** Add the `appearance` column + Background panel (color/gradient/image, scrim/blur, title/density) + R2 upload reuse. **Video** as a guarded opt-in sub-step. Acceptance: a photo background with a scrim keeps widgets legible; `null` appearance = today's look; export/print unaffected; video respects reduced-motion and has a poster.
3. **Item-embed widget (any item).** New `embed` kind + `itemId`, reusing the autosaving editor. Acceptance: embed any item, type into it, the change autosaves and shows in search/export; sticky-note look = embed + color + no header; `text` widget still available for labels.
4. **Tab / section container.** New `container` kind, child fan-out, drag-into. Acceptance: a tab widget swaps its body per tab; one-level nesting; data fan-out stays batched.
5. **(Future) Journal / daily-note mode.** Date-titled create + today's-entry surface.

## Rules check

- **Few dependencies (5):** none new. react-grid-layout, the editor, and R2 are all present. Color choice is a swatch set, not a picker lib.
- **Sunday-proof (4):** backgrounds/video are pure chrome; export + print ignore `appearance`. The item-backed embed makes note content *more* durable (it exports). Video degrades to a poster still offline.
- **Everything is an item (2):** the embed is a real item, not a second content store; the `text` widget stays only for non-content labels.
- **Fast/cheap (8):** per-widget fan-out stays batched and body-free except the embed (which reads one body, the content). Video is the watched cost item and ships guarded.
- **Non-core / solo:** only an additive `dashboards.appearance` column; courtesy COLLAB note to Tyler when the migration lands, no both-agree gate.

## Open questions

- Curated background set: ship a handful of presets (color/gradient + a few images) alongside upload, or upload-only first?
- Accent source: per-widget accent only, or also let a dashboard accent (in `appearance`) cascade as the default?
- Embed render scope: title + body only (proposed), or an optional "full canvas" embed later for richer types?
