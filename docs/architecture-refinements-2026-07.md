# Architecture refinements (flyover, 2026-07-01)

A structural review of the codebase: no feature changes, just seams worth straightening before the next building phase leans on them. Three deep scans ran (duplication/overlap, vestigial code, structure/perf). This doc records what was checked, what came back clean (so a future session doesn't re-litigate it), and a simple plan for each change worth making. Nothing here is urgent; items 2, 3, and 5 are safe mechanical refactors, item 1 touches a core-ish contract and needs Tyler.

## Overall verdict

The codebase is in good shape. Cleared by the scans:

- **Query discipline is real.** Owner-scoping everywhere, shared `listColumns`, no `body` in list queries, no N+1 patterns found in the core paths (items, views, relations, search).
- **One write path.** REST (`/api/items*`), machine (`/api/machine/items`), and MCP all funnel through the same `createItem` / `updateItem` / `softDeleteItem` in `src/lib/items.ts`. No drift risk between them.
- **API routes share one skeleton** (`requireOwner()` + `errorResponse()` from `src/lib/api.ts`); no hand-rolled boilerplate per route.
- **Lazy loading is in place.** Tiptap and react-grid-layout load via `next/dynamic`; nothing heavy sits in the root layout.
- **Index coverage matches the hot query columns** in `src/db/schema.ts` (owner, type, status, status_category, due/scheduled/note dates, parent, partial inbox, GIN on properties + search).
- **All 24 runtime dependencies are in use.** No dead packages.
- **Vestigial code is nearly nonexistent.** Todoist is a live, properly gated adapter behind the tasks seam (`TASKS_ADAPTER`), not a leftover. The hidden stubs (scratch editor, Build stubs, `WidgetGear`) are defer-by-hiding working as intended. The "BlockNote colors" in `colors.ts` are live export-compatibility code.
- **Module splits that look duplicative are deliberate** pure-math-vs-DB-service layering, not drift: `recurrence`/`recurrence-service`, `ics`/`ics-data`, `body`/`body-text`, `health`/`health-check`, the subtasks trio (`subtasks` / `relative-subtask` / `relative-subtask-service`), the templates trio (`templates` / `template-vars` / `structure-templates`), and the view/lens family (`view-render` / `related-lens` / `list-lenses`, different layers, zero shared code by design).
- **The component layer shares rendering.** No parallel row/card/list implementations across tasks/, today/, inbox/, lists/, projects/; everything routes through `ViewRenderer`, `RelatedLensBar`, and the shared selection/bulk machinery.

The real findings are five, ranked by impact-to-effort below. Check items off here as they land, and move this doc's pointer out of `next_steps.md` when the list is done.

---

## 1. Unify the widget world's types ⚠️ needs Tyler (core-ish)

**Status:** [ ] not started

**The problem.** Two exported types named `WidgetKind` mean different things: `src/lib/widgets.ts:14` (`"property" | "collection" | "relation" | "derived"`, the record-widget catalog) vs `src/lib/dashboard-widgets.ts:19` (`"view" | "stat" | "action" | "text" | "tree" | "embed" | "container" | "image"`, the dashboard UI layer). `src/lib/record-widgets.ts` reinvents row/result shapes (`WidgetItemRow`) rather than sharing them. And the two grid systems disagree on the `md` breakpoint while storing the identical per-breakpoint `{x,y,w,h}` layout shape: the item canvas breaks at 480px (`src/lib/canvas-layout.ts:53`) vs dashboards at 768px (`src/components/dashboards/RglInner.tsx:25`).

**Why now.** The A/B/C widget-engine decision (see the parked block in `next_steps.md`) will spread widget composition across more types. Whichever letter Tyler picks, this cleanup is the same, and it's much cheaper before the rollout than after.

**Plan.**
1. Rename the enums apart (e.g. `RecordWidgetKind` vs `DashboardWidgetKind`), or merge into one enum with explicit layer tags. Renaming apart is the lighter, safer first step; merging can ride the A/B/C decision.
2. Hoist a single shared `WidgetItemRow` / widget-result type that both `record-widgets.ts` and the dashboard data path consume.
3. Pick one `md` breakpoint (or make the breakpoint map a parameter of one shared grid config) so the stored layouts mean the same thing everywhere.
4. Because this touches the widget contract Tyler is actively speccing against, post a COLLAB heads-up first; if the merged-enum route is taken, log a short ADR.

**Effort:** ~half a day for the rename + shared row type + breakpoint decision; the full merge rides the widget-engine ADR.

---

## 2. Split `src/lib/mcp/tools.ts` into per-tool modules

**Status:** [ ] not started

**The problem.** At 1,372 lines it's the largest file in the repo and the fastest-growing (AI Memory just added to it). It holds 20+ tool schemas, handlers, and one-off serializers (`typeView`, `viewView`, `dashView`, `navView`, `slotView`) in one file.

**Plan.**
1. Create `src/lib/mcp/tools/<name>.ts`, one per tool (or per small family, e.g. the item CRUD tools together), each exporting its schema + handler.
2. Move the response serializers to `src/lib/mcp/serializers.ts`.
3. `src/lib/mcp/tools/index.ts` assembles the registry in the current order; `server.ts` imports the registry unchanged.
4. Pure mechanical move, no behavior change. Verify with tsc + the existing MCP verify scripts.

**Effort:** a focused session. Safe to do solo (module internals, not the MCP *contract*, which stays identical).

---

## 3. Carve mutations out of `src/lib/items.ts`

**Status:** [ ] not started

**The problem.** At 1,024 lines it mixes query builders (`listItemsQuery`, `getItem`, counts) with create/update/delete and all their side effects (revision snapshots, mention-edge syncing, activity logging, recurrence hooks, template inheritance). The circular-dependency guard comments near the top (~line 23) are the early warning sign.

**Plan.**
1. New `src/lib/item-mutations.ts`: move `createItem`, `updateItem`, `softDeleteItem` (+ restore/purge helpers) and their side-effect plumbing.
2. `items.ts` keeps the read side: query builders, `listColumns`, shared types. Re-export the mutation functions from `items.ts` initially so no import site has to change in the same PR; migrate imports opportunistically after.
3. Watch the existing circular-dependency guards; the split should dissolve them, not relocate them.

**Effort:** ~a day. Safe mechanical refactor; every write path funnels through these three functions, so the verify scripts cover it well.

---

## 4. Break `NavShell.tsx` into memoized sub-islands

**Status:** [ ] not started

**The problem.** `src/components/nav/NavShell.tsx` is 958 lines of `"use client"` loaded and hydrated on every page. It tangles icon rendering, the capture modal wiring, the command palette, rail sizing/density state, popovers, keyboard shortcuts, and mobile-responsive logic into one stateful component; any state change re-renders the shell.

**Why it matters.** This is the one item on the list with a felt payoff: snappier nav interactions and faster hydration on the phone (it's a PWA used from a pocket).

**Plan.**
1. Extract the static destination list as a memoized `<NavDestinations>` component (props: destinations + active route; no shell state).
2. Extract `<NavIcon>` / glyph logic and the popover + hover-timing logic into a small custom hook.
3. Keep `NavShell` as the thin orchestrator holding the layout knobs (railSize, density, openTools).
4. No visual or behavioral change intended; eyeball nav on desktop + mobile widths after.

**Effort:** ~a day. Solo-safe (UI internals).

---

## 5. Fifteen-minute items

**Status:** [ ] not started

1. **Fold `src/lib/item-enums.ts` (24 lines) into `items.ts`.** It has exactly one importer; a standalone module is below the threshold.
2. **Hoist shared recurrence constants.** `OCCURRENCE_ROLE` and the `appTodayYmd` / `ymdInZone` overlap live half in `src/lib/recurrence.ts`, half re-derived in `src/lib/recurrence-service.ts`. Move them to one home (either export from `recurrence.ts` or a tiny `recurrence-common.ts`) so the service stops re-deriving what the pure layer already knows.
3. **Delete three already-run one-off scripts** once confirmed executed: `scripts/clear-import-transcript-minutes.mjs`, `scripts/set-import-statuses.mjs`, `scripts/verify-db.mjs`. (The affected-IDs JSON from the first one is the rollback record; keep that if it's still around.)
4. Optional, trivial: add a `views_owner_idx` on `views.owner_id` in the next migration that's happening anyway. Views aren't hot, so don't cut a migration just for this.

---

## Suggested order

1. **Item 5** (warm-up, any session's spare half hour).
2. **Item 2** (mcp/tools.ts split) and **item 3** (items.ts split): one PR each, solo, mechanical.
3. **Item 4** (NavShell) when a session has room for an eyeball pass on mobile.
4. **Item 1** (widget types) as the prerequisite step of whichever widget-engine direction (A/B/C) Tyler picks; COLLAB heads-up first, ADR if the enums merge.
