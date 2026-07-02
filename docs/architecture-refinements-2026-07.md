# Architecture refinements (flyover, 2026-07-01)

A structural review of the codebase: no feature changes, just seams worth straightening before the next building phase leans on them. Three deep scans ran (duplication/overlap, vestigial code, structure/perf). This doc records what was checked, what came back clean (so a future session doesn't re-litigate it), and a plan for each change worth making.

**Update (2026-07-01, same day):** items 2, 3, 4, and 5 shipped on branch `refactor/architecture-cleanup-2026-07` (PR pending). Item 1 stays un-coded on purpose — it's core-ish and needs Tyler's input first (posted to `COLLAB.md`). Two of item 5's three sub-findings turned out to be false positives on closer inspection, and item 3's actual approach diverged from the plan below in one important way. Both are noted inline where they happened, since the corrections are worth more to a future reader than the original guess.

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

**Status:** [ ] not started — heads-up posted to `COLLAB.md` (2026-07-01), awaiting Tyler's input. No code touched.

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

**Status:** [x] done (2026-07-01)

**The problem.** At 1,372 lines it's the largest file in the repo and the fastest-growing (AI Memory just added to it). It holds 20+ tool schemas, handlers, and one-off serializers (`typeView`, `viewView`, `dashView`, `navView`, `slotView`) in one file.

**Plan.**
1. Create `src/lib/mcp/tools/<name>.ts`, one per tool (or per small family, e.g. the item CRUD tools together), each exporting its schema + handler.
2. Move the response serializers to `src/lib/mcp/serializers.ts`.
3. `src/lib/mcp/tools/index.ts` assembles the registry in the current order; `server.ts` imports the registry unchanged.
4. Pure mechanical move, no behavior change. Verify with tsc + the existing MCP verify scripts.

**Effort:** a focused session. Safe to do solo (module internals, not the MCP *contract*, which stays identical).

**What shipped.** Split into `src/lib/mcp/tools/`: `wire.ts` (types), `args.ts` (arg parsing), `serializers.ts` (response views), one file per family (`items`, `types`, `relations`, `views`, `templates`, `dashboards`, `workspace`, `memory`), and `index.ts` assembling the registry + `listToolDefs`/`callTool`. Same `@/lib/mcp/tools` import path (only 2 importers: `server.ts`, `build/claude/page.tsx`). Tool list order changed (grouped by family instead of the original ad-hoc sequence) — confirmed nothing depends on order (`callTool` looks up by name; `verify-mcp.mts` doesn't assert it). `verify-mcp`/`verify-mcp-large-body`/`verify-oauth-mcp` all green.

---

## 3. Carve mutations out of `src/lib/items.ts`

**Status:** [x] done (2026-07-01), one approach change from the plan below

**The problem.** At 1,024 lines it mixes query builders (`listItemsQuery`, `getItem`, counts) with create/update/delete and all their side effects (revision snapshots, mention-edge syncing, activity logging, recurrence hooks, template inheritance). The circular-dependency guard comments near the top (~line 23) are the early warning sign.

**Plan (as written; step 2 didn't survive contact — see below).**
1. New `src/lib/item-mutations.ts`: move `createItem`, `updateItem`, `softDeleteItem` (+ restore/purge helpers) and their side-effect plumbing.
2. `items.ts` keeps the read side: query builders, `listColumns`, shared types. Re-export the mutation functions from `items.ts` initially so no import site has to change in the same PR; migrate imports opportunistically after.
3. Watch the existing circular-dependency guards; the split should dissolve them, not relocate them.

**What actually shipped, and why step 2 changed.** Re-exporting the mutations back through `items.ts` would create `item-mutations.ts → items.ts → item-mutations.ts` — a real circular import, exactly the shape the existing `items.ts`/`types.ts` guard (dynamic `import()` for `getType`) goes out of its way to avoid. Instead the split stayed one-directional (`item-mutations.ts` imports `getItem`/`itemColumns`/`ItemError` from `items.ts`; `items.ts` never imports back), which meant updating every call site that imported a mutation symbol from `"@/lib/items"` to import it from `"@/lib/item-mutations"` instead: 23 app/lib files (mechanical import-line edits) plus 50 `scripts/verify-*.mts` files using the dynamic `await import(...)` destructuring pattern (fixed with a small script that split each destructured name list into "stays"/"moves" buckets). Bigger diff than planned (76 files touched total), but each edit is a one-line import-source change, and it closes off a drift risk rather than papering over it.

**Effort:** ended up most of a session once the call-site fan-out showed up, not the ~a day estimated — the mechanical fixup was straightforward but wide. Verified via tsc (clean), eslint (clean), a full production build, and running all ~104 verify scripts; the only failures were 5 pre-existing ones confirmed to reproduce identically on unmodified `origin/main` (storage-adapter env config, an unseeded `mindmap` type, a stale `project` capability expectation, a stale `buildDestOptions` count, and date-window-dependent notification tests in `verify-push`) — none caused by this split.

---

## 4. Break `NavShell.tsx` into memoized sub-islands

**Status:** [x] done (2026-07-01), narrower than planned — see below

**The problem.** `src/components/nav/NavShell.tsx` is 958 lines of `"use client"` loaded and hydrated on every page. It tangles icon rendering, the capture modal wiring, the command palette, rail sizing/density state, popovers, keyboard shortcuts, and mobile-responsive logic into one stateful component; any state change re-renders the shell.

**Why "faster hydration" didn't hold up.** The plan's framing — splitting files would mean "snappier nav interactions and faster hydration on the phone" — doesn't actually follow. NavShell is one `"use client"` component tree; moving code to sibling files doesn't shrink the client JS bundle or change re-render granularity unless something is also deferred via `next/dynamic` (a bigger, separately-risky change — nav chrome popping in after hydration — not attempted here). The real, honest payoff of what shipped is maintainability/readability, not a measurable perf win.

**What shipped (narrower than the plan's step 1).** Two extractions, chosen for being genuinely self-contained rather than for maximum line-count reduction:
- `src/components/nav/NavGlyphs.tsx`: the 9 pure, stateless icon/logo components (`Icon`, `PlusIcon`, `WrenchIcon`, `Logo`, `KebabIcon`, `Chevron`, `IconWithCount`, `InlineBadge`, plus the private `CountBubble`) — no hooks, no closures over NavShell state, so this is a pure file move with zero behavior risk.
- `src/components/nav/useHoverPopover.ts`: the tools-group/Favorites popover's hover-intent + click-toggle + outside-click-dismiss state. `openTools` turned out to be read nowhere outside that one concern, so it lifted out cleanly. Bonus: this collapsed two byte-identical copies of the click-toggle ternary (one for the "tools" slot kind, one for the Favorites destination) into the hook's single `toggle(id)`.

**Why the plan's step 1 (a memoized `<NavDestinations>`) didn't happen.** `renderSlot`/`toolsPopover`/the four per-layout class builders are genuinely entangled with per-call-site props — there are 4 render call sites (mobile pill, desktop bottom pill, top bar, rail), each passing a different `classNameFor`/`showLabel`/`toolsPos`. Extracting that tree is real, riskier surgery on the single most-used piece of UI in the app for a benefit ("memoization") that doesn't actually reduce work in the cases that matter (any nav interaction changes `pathname` or `openTools`, invalidating the memo anyway). Left alone rather than forced.

**Verification.** tsc/eslint clean. Confirmed via `git diff` that no JSX/className in the *remaining* render tree changed (every removed line belonged to the relocated glyph components) — the only functional edit was collapsing the two onClick ternaries. Then verified live in the dev-auth preview: rail fat/thin/hidden cycling, the Favorites flyout (the `isFavoritesHref` hook path) and a tools-group popover ("Other", the `kind: "tools"` hook path) both open/close and outside-click-dismiss correctly, the independent More menu (untouched `menuOpen` state) is unaffected, all glyphs render. Caught one thing worth remembering: **both the mobile pill and the matching desktop layout are simultaneously mounted in the DOM** (CSS `sm:hidden`/`hidden sm:block` hides one, not React) — a naive `document.querySelector('[aria-label="..."]')` grabs whichever renders first in the JSX, not necessarily the visible one. Filtering by `offsetParent !== null` (or scoping the selector to the `<aside>`/pill wrapper) is what actually targets the visible instance.

**Effort:** about a day including the in-browser verification pass. Solo-safe (UI internals only).

---

## 5. Fifteen-minute items

**Status:** [x] done (2026-07-01) — 2 of 3 sub-findings turned out to be false positives; see below

1. ~~Fold `src/lib/item-enums.ts` (24 lines) into `items.ts`.~~ **False positive — did not do this.** The original "exactly one importer" claim was wrong: `item-enums.ts`'s own header comment explains it was deliberately split out of `items.ts` so **client components** (`FieldStrip.tsx`, `BoardDnd.tsx`) can import the status/priority enums *without* pulling in `items.ts`'s server-only `getDb()`/drizzle imports into the browser bundle. Verified: 7 real importers across lib + 2 client components. Folding it in would have broken the client/server boundary it exists to preserve. Left as-is.
2. ~~Hoist shared recurrence constants.~~ **Also a false positive.** `appTodayYmd` in `recurrence-service.ts` is a one-line wrapper around `ymdInZone` (imported from `@/lib/today`, not from `recurrence.ts` at all) — nothing to de-duplicate. `OCCURRENCE_ROLE` is defined exactly once. The one real repeat found — `clone.ts`'s `ALWAYS_STRIP` array hardcodes the literal string `"occurrence"` — turned out to be a *different* thing: `ALWAYS_STRIP` holds item **property keys**, `OCCURRENCE_ROLE` is a **relation role** value; they share a string by coincidence, not by shared meaning. Importing the constant there would have wrongly coupled two unrelated concepts. Left as-is.
3. **Deleted two of the three one-off scripts** — `scripts/clear-import-transcript-minutes.mjs` and `scripts/set-import-statuses.mjs`, confirmed already-run (their own commit messages record having fixed the data) and referenced nowhere else. **`scripts/verify-db.mjs` was NOT deleted** — a closer look found it's one of the `CORE_VERIFIES` gating every production deploy in `scripts/release-prod.mjs`. Deleting it would have broken the release pipeline; the original doc's "safe to delete once slice 4 is closed (like verify-db.mjs)" comment in a *different* file was misread as meaning verify-db.mjs itself was disposable.
4. Not done: the `views_owner_idx` index. Still correct to fold into a migration that's happening for another reason rather than cut one solo for this.

**Takeaway for next time:** three of these four sub-items were wrong on first pass and only held up (or didn't) after checking real usage. Worth the extra few minutes before deleting or merging anything a scan flags as "unused" or "duplicate."

---

## Suggested order (as originally planned — see per-item status above for what actually happened)

1. **Item 5** (warm-up, any session's spare half hour).
2. **Item 2** (mcp/tools.ts split) and **item 3** (items.ts split): one PR each, solo, mechanical.
3. **Item 4** (NavShell) when a session has room for an eyeball pass on mobile.
4. **Item 1** (widget types) as the prerequisite step of whichever widget-engine direction (A/B/C) Tyler picks; COLLAB heads-up first, ADR if the enums merge.

## What's left

Only **item 1** (the widget-type unification) remains, blocked on Tyler's input (posted to `COLLAB.md` 2026-07-01). Everything else on this list is done. Retire this doc's `next_steps.md` pointer once item 1 resolves one way or the other.
