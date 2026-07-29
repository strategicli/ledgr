# Dashboard once-over: status + plan

**Status:** audit complete 2026-07-29 (Claude, at Brandon's request), on `main` @ `066e707`. **D0 (the blank-dashboard fix) shipped and deployed to prod the same day (PR #226).** **Part 2 below is superseded:** Brandon redirected the feature to "dashboards as activity surfaces" (widgets you act through: row menus, inline add, board drag, freshness), killed the host-scoped-widgets-on-item-canvases idea, and approved MCP parity. The current plan is `plans/dashboard-phase2-mcp-parity-host-widgets.html` (local build artifact). Part 1 (the status audit) remains accurate. This is the status of the shipped dashboard feature plus the plan to make it a usable, full-featured chunk. **Mostly non-core/solo** (the Work-surface dashboard, the same lane as ADR-064/065/111/120); the two exceptions are flagged inline as needing Tyler + an ADR.

---

## Part 1: where it is now

### What is actually built

Four ADRs stacked on one another, and the surface area is genuinely large:

| Layer | ADR | State |
| --- | --- | --- |
| `dashboards` table (`name`, `position`, `focus_item_id`, `widgets` jsonb) | 064 | shipped, migrations 0016/0017 |
| Multiple named dashboards, RGL grid, gear settings, focus, Set-as-Home/Today | 065 | shipped |
| Per-widget appearance, stage background, item embed, tab/section container | 111 | shipped |
| Build record of the above + the nested-list (`tree`) widget | 120 | shipped, migration 0034 (`appearance`) |

**Eight widget kinds** (`src/lib/dashboard-widgets.ts`): `view` (compact list or layout-faithful via `ViewRenderer`), `stat` (a count), `action` (quick-capture / new-from-template / link), `text` (heading + note), `tree` (N parents from a view, each with children by `parent_id` or by relation role), `embed` (any item, edited in place through `ItemEditor`), `container` (tabs / stack / section, one level deep), `image` (a URL).

**Per-widget appearance:** header on/off, border on/off, 8 background tokens, 7 accent tokens, collapsible + collapsed. Header-off is the chrome-free path, so a header-off `embed` on a colored background is a sticky note.

**The stage:** full-bleed color / gradient / image-URL background, scrim and blur sliders, title visibility, density. `video` is parsed but has no UI (deliberate seam).

**Plumbing that is in good shape:**

- One persistence path. Every change goes through `PATCH /api/dashboards/[id]` with the whole `DashboardInput`. Layout drag is debounced and does not refetch; data-affecting settings debounce then `router.refresh()`.
- Tolerant parsers throughout (`src/lib/dashboards.ts`): unknown keys dropped, numbers clamped, malformed widgets skipped, nested containers dropped. Adding a field inside the `widgets` jsonb is migration-free.
- Owner-scoped, body-free everywhere except the `embed` widget (which is supposed to read a body).
- The resolver is shared, not forked: `src/lib/dashboard-resolve.ts` serves the page, the Desk panel, and `GET /api/dashboards/[id]/resolved`.
- Nav integration is complete: a Build INTERFACE entry, and any dashboard is a valid Work nav destination (`nav-slot-options.ts`).
- `verify-dashboards.mts` (19 checks) + `verify-dashboard-canvas.mts` (26 checks).

So the feature is not thin. The problem is not missing capability, it is that the capability is unreachable, unsafe to touch, and unfinished at the edges.

### Bugs, ranked

**P0 - the dashboard renders completely blank.** Reproduced deterministically on the dev-auth preview, on both `/dashboards/[id]` and `/` (the Home surface). Every widget gets `width: 0px` and the grid drops to the single-column `sm` breakpoint. Read straight off the React fiber: `WidthProvider` state `width = 0` while the grid container measures 1101px.

Cause: `measureBeforeMount` on `ResponsiveGridLayout` (`src/components/dashboards/RglInner.tsx:87`). react-grid-layout 1.5.3's `WidthProvider` renders a bare placeholder `div` holding `elementRef` until it has measured, and observes that node with a `ResizeObserver`. The first callback delivers the real width, which triggers the re-render that swaps the placeholder `div` for the grid component. React sees a different element type, so it unmounts the placeholder and mounts a fresh subtree. `elementRef` now points at the new node, but the `ResizeObserver` is still watching the **detached** placeholder, which reports 0x0 the moment it leaves the DOM. That second callback sets `width: 0`, and nothing ever recovers: the observer is attached to a dead node, so no window resize, viewport change, or manual `resize` event fixes it (all three tested).

Verified fix: setting `measureBeforeMount={false}` restores real widths (447px cells, `providerWidth: 910`) and the dashboard renders correctly. The flag was added in `6012f81` (2026-07-11) to stop a load-flash, but the same commit also added the height reservation plus skeleton in `DashboardGridLayout`, which solves that flash on its own. The flag is redundant as well as harmful.

`6012f81` is in `origin/prod-brandon`, so this has been live for roughly 18 days. Note that `ItemRglInner` (the item canvas) does **not** pass the flag, which is why only dashboards are affected. Worth a 60-second look at the production Home screen to confirm it presents the same way there.

**P1 - destroying a widget is one misclick with no way back.** The `✕` sits 8px from the gear in the widget header. It removes the widget, its settings, its appearance, and its grid placement immediately. No confirm, no toast, no undo. `showToast(text, undo?)` exists and is mounted once in the root layout precisely for this, and `grep` for `showToast` or `ConfirmButton` across `src/components/dashboards/` and `src/app/dashboards/` returns nothing. The dashboard surface is the one place that skipped the ADR-142 standard.

**P1 - a dashboard cannot be deleted or reordered from the app.** `DELETE /api/dashboards/[id]` and `PUT /api/dashboards/reorder` both exist and both have zero callers outside `src/app/api`. Renaming works only from inside that dashboard's edit mode. There is no duplicate. The `/dashboards` index is a bare list of names and widget counts: it does not even show which dashboard is Home or Today.

**P2 - a container's active tab never persists.** `activeTab` is stored, parsed, and clamped on the server, but `ContainerWidget` holds the tab in local `useState` and never calls back. A tab group always reopens on tab 0, and the stored field is dead weight.

**P2 - the mobile edit header is broken.** Seven controls wrap onto three rows and the `flex-1` name input loses the fight, collapsing to a roughly 10px sliver. The dashboard name is effectively invisible and unusable on a phone in edit mode. In view mode the title collides with the floating Build pill.

**P2 - a widget cannot be repointed at a different view.** The gear has no view picker, so changing what a widget shows means delete, re-add, re-arrange, re-style. This is the single most common edit anyone would want to make.

**P2 - edit mode does not show what view mode shows.** Collapsed widgets force-expand in edit mode, so you arrange and size a layout you cannot see. Come back out and the board is a different shape.

**P3 - the papercuts:**

- Sort dropdown lists raw field keys: `updatedAt`, `createdAt`, `dueDate`, `meetingAt`, `title`.
- Two different empty states: `No items match.` (compact) vs `No items match this view.` (faithful).
- An empty widget still holds its full stored height. A zero-item list is 404px of nothing; two stat cards eat about 300px of the first mobile screen to show two zeros.
- The Add menu is one long 320px scroll that truncates names ("Recently Touch…", "Timeline (dev t…"), has no search, and lists the same thing twice: picking a Prebuilt creates a saved view, which then also appears under From Views. Reuse is matched by view **name**, which is fragile.
- `Recently Touched` reports `99+` and `+8932 more →`, including `Untitled` and `ARCHIVE:` rows. It is the whole corpus in a box. (Logged as deferred S7b.)
- The `image` widget is URL-only, and its own help text tells you to embed a note and paste instead.
- Chrome is raw text glyphs (`⠿ ⚙ ✕ ▸ ▾`) rather than the app's icon system.
- A chrome-free widget has no click-through at all: a header-off stat is a dead number.

**Structural, already logged, needs Tyler:**

- Two conflicting `WidgetKind` vocabularies: the dashboard's 8 kinds vs `src/lib/widgets.ts`'s 4 record-widget kinds (`property` / `collection` / `relation` / `derived`), plus an `md` breakpoint mismatch (dashboards 768px, item canvas 480px). This is open item 1 in `docs/architecture-refinements-2026-07.md`, parked on the A/B/C widget-engine decision.
- MCP can place only 4 of the 8 kinds (`MCP_WIDGET_KINDS` is pinned to the ADR-064/065 base). Correct as written, since the machine contract is frozen-core, but it means an AI-shaped dashboard cannot use `tree`, `embed`, `container`, or `image`.

**Cost note:** the fan-out is roughly 3 to 4 DB round trips per view widget (`queryViewItems` + `countViewItems` + `relatedSummaryFor`), the routes are `force-dynamic`, and nothing is cached. A 10-widget Home is 25 to 35 queries per render. Parallel, owner-scoped, and body-free, so it is not wrong, but it is worth measuring against Principle 8 before adding more widgets.

### The honest summary

The data model and the persistence path are good and should not be touched. What makes it feel half-baked is a single rendering regression that blanks the whole surface, a destructive action with no safety net, a missing management layer for the dashboards themselves, and an editor that hides the one setting you most want to change. Roughly a week of small, additive work, not a rebuild.

---

## Part 2: the plan

Cheapest-first, each slice independently shippable, reuse-led. No new dependencies. No schema changes except where noted (there are none).

### D0 - unblank it (ship alone, today)

Drop `measureBeforeMount` from `RglInner.tsx`. One line. The height reservation plus skeleton already in `DashboardGridLayout` covers the load-flash it was added for.

*Acceptance:* `/`, `/today`, `/dashboards/[id]`, and a Desk dashboard panel all render real widget widths at 1440, 768, and 375. Confirm no load-flash regression. Then check production.

*Also:* add a `ponytail:`-style guard comment naming the WidthProvider trap, so nobody re-adds the flag. This is exactly the "document rationale against reversal" case.

### D1 - stop losing work

1. Widget `✕` fires `showToast("Widget removed", undo)` where undo re-inserts the widget object (it is already in hand). About 10 lines in `DashboardClient.handleRemove`.
2. Same treatment for a container child removal in `ContainerWidget`.
3. `/dashboards` index gains: Home/Today badges, inline rename, duplicate, delete behind the same undo toast, and drag-reorder wired to the `PUT /api/dashboards/reorder` endpoint that already exists.

*Acceptance:* every destructive dashboard action is reversible; both dead endpoints have a caller.

### D2 - make the gear worth opening

1. **View picker.** Add "Shows" to the gear for `view` / `stat` / `tree`, listing the owner's saved views. `AddWidgetMenu` already fetches `/api/views`; lift that fetch into a tiny shared hook and reuse it. Changing it patches `viewId` and refetches, which the existing `REFETCH_KINDS` path already handles.
2. **Human sort labels.** A 5-entry label map. About 8 lines.
3. **Split the popover** into Data and Appearance sections behind a two-tab strip, and widen 256px to 300px. The backing view's name and the widget kind go at the top so you know what you are editing.
4. Dedupe the Add menu against existing views by **id**, not name; add a filter input; widen to 380px and stop truncating.

*Acceptance:* a widget can be repointed without being deleted; no raw field keys or truncated names in any dashboard menu.

### D3 - make edit mode tell the truth

1. Collapsed stays collapsed in edit mode. Keep the chevron live so you can expand to resize, and keep the stored `h` untouched (the existing view-mode-only forced height already proves the mechanism).
2. Rebuild the edit header: name on its own row, and fold Home / Today / Focus / Background behind one `⋯` popover so the action row is just `+ Add widget` and `Done`. This fixes the desktop crowding and the mobile sliver in one move.
3. Give the view-mode title a top offset clear of the floating Build pill.

*Acceptance:* the board has the same shape in edit and view mode; the name input is usable at 375px; the header never wraps past two rows.

### D4 - make the content look intentional

1. One empty-state string, used by both render styles.
2. An empty `view` / `tree` widget shrinks to its header bar in view mode, reusing the collapse mechanism. A dashboard of empty widgets stops being a wall of voids.
3. Cap `Recently Touched`-style widgets: exclude `done` and `ARCHIVE:`-prefixed rows at the view level, and stop rendering `+8932 more`. (This is the deferred S7b, and it is a view-definition change, so it is Brandon's call on his own data rather than a code change.)
4. Replace the text glyphs with the app's icon components.
5. Give a chrome-free widget a click-through: the whole tile links to `titleHref(data)` when the header is off.

### D5 - the genuinely missing features

Everything above is repair. These are the additions that make it "full-featured", and all four are already-recorded intent rather than new invention:

- **Journal / daily-note mode** (ADR-111 DC5, spec'd and deferred). A "new page" affordance that creates a date-titled item from a template and surfaces today's entry. Builds on templates (ADR-093) plus the `embed` widget. Non-core.
- **A widget preview in the Add menu.** Small, high leverage: the current menu asks you to pick between List / Count / Nested with no idea what any of them looks like.
- **Host-scoped placeable widgets on item and type canvases** (the `dashboard-widgets.md` carry-forward: "open tasks related to the people on this item", dropped on any canvas, scoping itself). This is the convergence with `WidgetCanvas` and the parked A/B/C decision. **Core: needs both-agree + an ADR.** Do not start it inside this chunk.
- **MCP parity for `tree` / `embed` / `container` / `image`.** **Core: the machine/MCP contract is frozen, so this needs both-agree + an ADR.** Worth raising, since AI-shaped dashboards are currently limited to half the vocabulary.

### Not in this chunk

- Any change to the `dashboards` table, the widget jsonb contract, or the single-PATCH persistence path. They work.
- Stage video and byte upload. The parser seam stays; the UI stays absent.
- The fan-out batching. Measure first. If a 10-widget board is fine in production, leave it alone.

### Suggested order

D0 alone and immediately, since it is one line and the whole surface is dark without it. Then D1, then D2, then D3 and D4 together as a polish pass. D5 after Brandon picks which of the four he actually wants, and after Tyler weighs in on the two core items.

### Open questions for Brandon

1. Editing your Work home inside Build chrome: `/dashboards/[id]` renders in the Build sidebar (correct per ADR-063, dashboards are INTERFACE-building), but you edit a Work surface there. Leave it, or give an assigned Home/Today dashboard an in-place edit affordance on `/`?
2. Should edit mode exist on a phone at all, or should it be desktop-only with a read-only mobile view? RGL touch drag in a single column only reorders vertically, which is a weak payoff for the header crowding it causes.
3. `Recently Touched` in D4.3 touches your live view definitions. Want me to change the view, or just report it?
