# Exploration → build brief: arrangeable, per-type item canvas layout (Feature B)

**Status:** ✅ BUILT (B1, 2026-06-17, ADR-069). Shipped end-to-end: the spike (`/scratch/layout`, since graduated + deleted), migration 0019 (`types.canvas_layout`), pure `src/lib/canvas-layout.ts` (+ `verify-canvas-layout` 36/36), the `react-grid-layout` item grid (`ItemRglInner`/`ItemLayoutGrid`) with flow auto-height + pin + hide palette, `MarkdownCanvas` classic-vs-grid dispatch + node map, full-page `?arrange=1`, `PATCH /api/types/[key]/layout`, the atomic `propertyPatch` jsonb merge, `ItemEditor` slot prop. In-browser cycle verified against live Neon. See ADR-069. Deferred later slices (grouping/collapsible cards, pin-to-fixed polish, bespoke-canvas arrangeability) remain below. The original brief is kept for the record.

**Status (original):** DECIDED, ready to build. This is the implementation brief for "Feature B," the second half of the 2026-06-16 item-view UX push (Feature A — inline editing — shipped in ADR-068/PR #11). Written as a **handoff to a local session** (where a browser, dev server, and `DATABASE_URL` are available — the grid needs an in-browser eyeball that a CI container can't give). It supersedes the lower-priority "item 4" in `canvas-drag-and-drop.md` and the short Feature-B notes in `next_steps.md`/`COLLAB.md` with the full, current decision set (several calls below were made in chat *after* those notes were written).

**One-line goal:** an item's detail view becomes a free, dashboard-style 2D grid the user can arrange however they like, **per type**, with a sensible default so it's never forced.

---

## Locked decisions (from the 2026-06-16 conversation)

1. **2D free grid, not vertical-only.** Reuse the dashboards' `react-grid-layout` engine. The whole item window is one grid; cards go anywhere (drag + resize). Brandon's words: "an item view becomes essentially zoneless, full DnD anywhere."
2. **Field-level granularity.** Each individual field is its own draggable card — every custom property, each system field (Status, Due, Urgency, When, URL), each relation field — **not** grouped into a "Properties" panel. (We considered block-level — whole panels as cards — and chose field-level. The only cards that are *not* split: the markdown **body** and the **title**, which are always single blocks; and the **Related** backlinks panel, which is a dynamic list, stays one card.)
3. **Always a default arrangement; never forced.** A type with no saved layout renders exactly as it does today. Arranging is opt-in. (Implementation: `null` saved layout → the current classic stacked render, untouched. See "Rendering & de-risking.")
4. **Per type, with a default.** Layout is stored per type (a `Book` can look different from a `Meeting`). Stored as a new nullable `types.canvas_layout` jsonb; `null` = default. Types are **instance-global** (no `owner_id` — see `src/lib/types.ts` header), so per-type = per-user here, which is fine.
5. **Responsive, auto-derived, overridable.** Per-breakpoint layouts (`lg` full width / `md` modal-small / `sm` mobile). The user arranges `lg`; `md`/`sm` are auto-derived by the library's vertical compaction unless the user drags at that width, which saves an override for that breakpoint. Mobile (`sm`) is a single stacked column and is **view-only** (no drag — HTML5/RGL DnD is poor on touch).
6. **Body auto-height by default; pin-to-fixed optional.** ~90% of types want the body full-width with height following content (`mode: "flow"`). A per-card **pin** toggle flips any card to `mode: "fixed"` (a normal drag/resize/locked cell; content scrolls inside). This is the **one genuinely risky piece** — see "The spike."
7. **Grouping / collapsible containers: DEFERRED.** Brandon's "both/and" idea (group several fields into one movable, collapsible unit) is a *later* slice. Design the layout schema so a `group` card (holding child card ids, with a `collapsed` flag) can be added without a rewrite, but do not build it now. Revisit after living with the flat field grid.
8. **Bespoke module canvases (Chord, Paper, Link) are out of scope.** They are custom components, not the standard zone set. They opt into arrangeability at the module level later. Feature B applies to the **default `MarkdownCanvas`** only. (Idea Brandon raised: a per-type "Customize layout" toggle at type creation — worth a small checkbox, default on, but the real gate is simply "does this type use the default canvas.")

---

## Data model

Add one column; no other schema changes.

- **`types.canvas_layout` jsonb, nullable** (migration **0019**). `null` = use the generated default. `src/db/schema.ts` types table gets `canvasLayout: jsonb("canvas_layout")`. Thread it through `rowToDefinition` + `TypeDefinition` in `src/lib/types.ts` (default-tolerant: a malformed value reads as `null`, mirroring how `rowToDefinition` already swallows a bad `property_schema`).
- **Store fns** in `src/lib/types.ts`: `setTypeCanvasLayout(key, layout | null)` (and the layout flows out via `getType`). Mirror the focused-endpoint precedent (`setTypeQuickCapture` + `/api/types/[key]/quick-capture`, and the new `renameTypeLabel` + `/api/types/[key]/rename` from ADR-068) — a small dedicated route, not the whole-definition builder PATCH.
- **API:** `PATCH /api/types/[key]/layout` with `{ layout }` (or `{ layout: null }` to reset). Owner-guarded like the other type routes.

### Layout shape (client-safe pure module: `src/lib/canvas-layout.ts`)

Mirror the `src/lib/dashboard-widgets.ts` (client-safe shapes/vocab) ↔ `src/lib/dashboards.ts` (server store + tolerant parse) split, so the client grid imports shapes without pulling server code.

```ts
type CardId = string; // see vocabulary below
type Cell = { i: CardId; x: number; y: number; w: number; h: number };
type CardMeta = { mode: "flow" | "fixed"; hidden?: boolean };
type CanvasLayout = {
  version: 1;
  cards: Record<CardId, CardMeta>;
  layouts: { lg: Cell[]; md: Cell[]; sm: Cell[] };
};
```

Pure functions to build:
- `cardVocabulary(type, propertySchema)` → the ordered list of `CardId`s available for a type (see below).
- `defaultLayout(type, propertySchema)` → a `CanvasLayout` reproducing **today's** order (so the default looks unchanged).
- `parseCanvasLayout(raw): CanvasLayout | null` → tolerant (bad shape → `null`).
- `reconcile(layout, vocabulary)` → **critical**: drop cards no longer in the vocabulary (a deleted property), append newly-added cards (a property added later) at the bottom with a default cell/size. Run on every read so the grid never goes stale when a type's schema changes.
- `deriveResponsive(layout)` → fill any missing `md`/`sm` from `lg` (let RGL compact), so authoring `lg` is enough.

### Card vocabulary (field-level)

- **Structural blocks (always single):** `title`, `body`, `related`, `saveOffline`, `share`, `meta` (the read-only footer: Type / Created / Updated, today's `<details>` "Fields").
- **Type-conditional blocks:** `subtasks` (task only), `meetingPrep` (meeting only).
- **System field cards:** `sys:status`, `sys:dueDate`, `sys:urgency`, `sys:meetingAt`, `sys:url` — applicability per type mirrors `topStripFields`/`footerFieldsFor` in `src/lib/canvas-fields.ts` (e.g. `dueDate`/`urgency` are task-only per ADR-018; don't surface a field a type shouldn't have).
- **Custom scalar property cards:** `prop:<key>` for each non-relation `PropertyDef`.
- **Relation field cards:** `rel:<key>` for each `relation` `PropertyDef`.

The default layout places them in today's reading order: title → system strip fields → body → subtasks/meetingPrep → custom props → relations → related → saveOffline → share → meta.

---

## Rendering & de-risking

The safe move: **the grid is additive, not a forced rewrite of the default render.**

- **`null` layout, not arranging → classic stacked render** (today's `MarkdownCanvas` JSX, unchanged). Zero risk for the common case.
- **Saved layout, not arranging → grid render, read-only** (cards positioned by RGL, no drag handles). Field-level free placement can't be a vertical stack, so a customized type renders through the grid.
- **Arranging → grid + RGL edit handles + a palette** (show/hide cards, pin flow/fixed) + Save/Done (debounced `PATCH …/layout`) + "Reset to default."

**Arrange entry point:** a "Customize layout" / "Arrange" button on the canvas. Enter arrange mode via a **full-page `?arrange=1`** route (a hard navigation, so it escapes the intercepting-route modal — same trick `Modal.tsx`'s "Expand" uses; a soft `router.push` leaves the `@modal` slot mounted, which is exactly the bug fixed in ADR-068). Arranging is desktop, full-screen; the modal stays a quick reader.

**RSC seam:** `MarkdownCanvas` (server) renders each card's content into a `Record<CardId, ReactNode>` and hands it to a client `ItemLayoutGrid` (a `next/dynamic`, `ssr:false` wrapper around an `ItemRglInner`, exactly mirroring `DashboardGridLayout` → `RglInner`). React Server Components can be passed as props/children into a client component, so the editor, relations, etc. keep working untouched inside their cells — the grid only positions them.

---

## The spike (build this FIRST, eyeball before wiring the real thing)

The make-or-break is **a flow (auto-height) body living in the same RGL grid as fixed cards.** RGL needs an explicit `h` (row units) per item; "flow" means we measure content and feed `h` back. Build a throwaway-ish `/scratch/layout` route (a sibling to the existing `/scratch/editor`) that proves the mechanics, then graduate the engine into `ItemRglInner`.

What the spike must demonstrate, and what to eyeball in the browser:
- A **flow** card (a body proxy — an auto-growing `<textarea>` or the real `LazyMarkdownEditor`) whose height tracks content; **type into it and watch the grid reflow.**
- **Fixed** cards (field-sized) that drag + resize normally.
- **Responsive:** shrink the window → `lg`→`md`→`sm`; `sm` stacks to one column.
- A **pin** toggle flipping the body flow ⇄ fixed (fixed = content scrolls in a set-height cell).
- **Persistence:** save layouts to `localStorage`; reload → arrangement and pin state survive.

Engine details (reuse from `src/components/dashboards/RglInner.tsx`):
- `WidthProvider(Responsive)`, `cols {lg:12, md:6, sm:1}`, `breakpoints {lg:1024, md:768, sm:0}`, `rowHeight: 40`, `margin: [16, 12]`, `compactType: "vertical"`, `draggableHandle`, `draggableCancel`.
- Reuse the **`.dash-edit`** scoped CSS already in `src/app/globals.css` (accent placeholder, item outline, resize handle) by setting that class on the grid in edit mode.
- **Auto-height measurement:** a `ResizeObserver` on each flow card's *natural content height* → `rows = max(1, ceil((px + marginY) / (rowHeight + marginY)))` with `rowHeight=40, marginY=12`; set that card's `h` across breakpoints. **Avoid the feedback loop** by measuring the content's natural/`scrollHeight` (independent of the RGL box), not the box itself; debounce; only `setState` when `rows` actually changes. Give flow cards width-only resize (`resizeHandles: ["e","w"]`) so the user can't fight the auto-height.

---

## Phasing

1. **Spike** (`/scratch/layout`) → Brandon eyeballs on the dev server. Lock the flow/fixed feel.
2. **B1 — the real feature:** migration 0019 + schema/`TypeDefinition` + `src/lib/canvas-layout.ts` (pure) + `scripts/verify-canvas-layout.mts` (pure, **runs without a DB** — default/parse/reconcile/responsive) + `ItemLayoutGrid`/`ItemRglInner` + `MarkdownCanvas` dispatch (classic vs grid) + arrange mode (`?arrange=1`, palette, pin, save/reset) + `PATCH /api/types/[key]/layout` + the "Customize layout" entry. Write **ADR-069**, update `schema.md`, `next_steps.md`, `roadmap.md`, `COLLAB.md`.
3. **B2 is mostly subsumed.** Field-level already delivers PRD §4.13's "which fields go top-strip vs. footer, configurable per type" — you just place the cards. Keep the `meta` card for the read-only system fields. No separate B2 build needed beyond that.
4. **Later slices:** grouping/collapsible container cards (the deferred "both/and"); polishing pin-to-fixed for the body; opening bespoke canvases (Chord/Paper) to arrangeability.

---

## Core / collaboration

This is **core** (a `schema.md` column + the type/canvas model — both on CLAUDE.md's frozen "core" list). Brandon has said the direction is fine and Tyler is good to proceed (see the COLLAB heads-up). Still: write **ADR-069** when B1 lands, and update `schema.md` for the `canvas_layout` column. No `relations`/`items` changes.

---

## Reuse pointers (exact files)

- **RGL engine:** `src/components/dashboards/RglInner.tsx` (the grid), `src/components/dashboards/DashboardGridLayout.tsx` (the `dynamic ssr:false` wrapper). Pinned dep: **`react-grid-layout@1.5.3`** (do NOT bump to npm `@latest` — that's the v2 hook rewrite without `WidthProvider`).
- **Scoped CSS:** `src/app/globals.css`, the `.dash-edit .react-grid-item…` block (~line 119+).
- **Shapes/store split to mirror:** `src/lib/dashboard-widgets.ts` (client-safe) ↔ `src/lib/dashboards.ts` (server + tolerant parse). Tolerant-parse precedent also in `src/lib/settings.ts` (`parseSettings`).
- **Current canvas:** `src/components/canvas/MarkdownCanvas.tsx` (today's zone order — the default layout must reproduce it), `src/components/canvas/ItemCanvas.tsx` (shell), `src/components/canvas/Modal.tsx` (the hard-nav-to-escape-modal pattern for `?arrange=1`), entry routes `src/app/items/[id]/page.tsx` + `src/app/@modal/(.)items/[id]/page.tsx`.
- **Fields/panels rendered into cards:** `src/lib/canvas-fields.ts` (`topStripFields`/`footerFieldsFor` — drives system-field applicability + the `meta` card), `src/components/canvas/FieldStrip.tsx`, `src/components/build/CustomProperties.tsx`, `src/components/relations/RelationProperties.tsx`, `src/components/relations/RelatedPanel.tsx`, `src/components/subtasks/Subtasks.tsx`, `src/components/meetings/MeetingPrep.tsx`, `src/components/canvas/SaveOffline.tsx`, `src/components/canvas/ShareLink.tsx`.
- **Type store + focused-endpoint pattern:** `src/lib/types.ts` (`getType`, `updateType`, `rowToDefinition`, `setTypeQuickCapture`), `src/app/api/types/[key]/rename/route.ts` (ADR-068 — copy this shape for `…/layout`).
- **Migrations:** `drizzle/` (last is `0018_unmarked_type.sql`; generate `0019`). Apply with the repo's migrate step.

---

## Verification

- **`scripts/verify-canvas-layout.mts`** — pure, no DB: `defaultLayout` reproduces the classic order; `parseCanvasLayout` tolerates junk → `null`; `reconcile` drops removed cards + appends added ones; `deriveResponsive` fills `md`/`sm`. Runs anywhere (`npx tsx`).
- **Migration applied** to Neon; `getType` round-trips a saved layout.
- **In-browser eyeball checklist:** default type looks unchanged; enter Arrange (full-page, escapes modal); drag a field anywhere; resize; type in the body and watch it grow/reflow; pin the body to fixed and back; hide/show a card; shrink to `md`/`sm`; Save → reopen the item → layout persisted; add a property to the type → its card appears (reconcile); mobile is single-column and view-only.

---

## Open decisions to settle while building (not blockers)

- Default `flow` vs `fixed` per card (proposal: `body` flow; `related`/`subtasks`/`meetingPrep` flow; small field cards fixed).
- Exact placement of the "Customize layout" button (proposal: a quiet control near the top of the canvas, plus a command-palette entry).
- Whether `meta`/`saveOffline`/`share` are hideable (proposal: yes, all cards hideable; default visible).
- Whether to add the per-type "Customize layout enabled" checkbox now or rely on "uses default canvas" as the gate (proposal: skip the checkbox for v1).

---

## How to start the local session

1. `git checkout main && git pull` (this brief is on `main`). Branch: continue on `claude/item-canvas-layout` or start fresh.
2. Ensure `.env.local` has the pooled `DATABASE_URL` (so migrations + DB-backed verifies run) and `npm install`, then `npm run dev`.
3. Paste this kickoff prompt to Claude Code:

   > Read `explorations/item-canvas-layout.md` end to end — it's the full, decided build brief for Feature B (the arrangeable, field-level, per-type item canvas layout). Don't re-litigate the decisions; they're locked. **Start with "The spike":** build the `/scratch/layout` route that proves a flow/auto-height body in a react-grid-layout grid alongside fixed cards, responsive + pin + localStorage. Reuse the dashboards' RGL pattern (`RglInner`/`DashboardGridLayout`) and the `.dash-edit` CSS. Get it running so I can eyeball it in the browser, and confirm the plan back to me before wiring the real per-type version (B1).

4. After the spike feels right, build B1 per the phasing above, then write ADR-069 and update the docs.
