# Exploration → build brief: unified UI/UX refresh

**Status:** DECIDED, ready to build in slices (Brandon, 2026-07-03). A full-pass UI/UX refresh across the four main surfaces — item view, type lists/lenses, dashboards, and nav — grounded in a live audit of the running app at 1440px and 375px against production data (8,940 items). **Non-core / solo** (UI/UX polish, view definitions, and per-instance chrome — the "move fast solo" side of the collab line), but the **token layer** and the **mobile interaction standard** are cross-cutting conventions, so they earn an ADR + a CLAUDE.md working-convention line when slice 1 lands, plus a courtesy heads-up to Tyler (not a both-agree gate — none of the frozen-core list is touched).

**Interactive mockups (the review surface):** the wireframes for every surface below live in the Agent-Native visual plan — <https://plan.agent-native.com/_agent-native/open?app=plan&view=plan&to=%2Fplans%2Fplan-8f112156fc1e4e09&planId=plan-8f112156fc1e4e09>. This doc is the durable, build-driving spec; the mockups are the picture. (The build itself creates the real components, so no mockup HTML is checked into the repo — it would only rot.)

---

## Objective

One design language across Ledgr's four main surfaces that makes the app **calmer, denser where it counts, and genuinely good on a phone**, without changing the data model or any route. "Done" means:

- A **semantic token layer** in `globals.css` that every refreshed surface styles from, structured so a future light mode is a variable flip, not a rewrite.
- **Desktop lists use the width**: real columns per lens, a right-side peek panel as the default open, and search visible in the nav.
- The **item canvas** loses its dead vertical band; fields read as a chip strip under the title; empty sections collapse.
- A **mobile gesture layer**: swipe row actions, long-press row menus, bottom-sheet item view, thumb-anchored capture, and a fixed icon-only bottom bar with a pull-up launcher.

All UI-only: **no schema changes, no new tables, no route changes.**

## What the audit found (the problems this fixes)

| Surface | Problem today | Fix |
|---|---|---|
| Type lists (desktop) | Centered ~720px column on a 1440px screen; rows show only title + created date | Full-width layout + per-lens default columns (reuses ADR-049 `columns`), peek panel |
| Type lists (mobile) | Visible `Trash` text button on every row eats width + invites mis-taps | Swipe actions + long-press menu; Trash leaves the row into the menu |
| Tasks Today tab | Grouped by priority **and** a P-chip repeated on every row | Group header carries the priority; rows drop the chip |
| Item canvas | Dead band between title and body; floating Rich/Source toggle; long stack of empty all-caps sections | Chip field strip under title; empty sections collapse; toggle → ⋯ menu |
| Home dashboard (mobile) | Stat widgets ~200px tall for one number; a badge reads `8940` | Compact mobile stat rendering; count badges cap at 99+ |
| Bottom bar (mobile) | 12 slots in a horizontally **scrolling** bar — a destination's position depends on scroll, so muscle memory never forms; labels-under-icons cost vertical space | Fixed, icon-only bar that never scrolls (screen-sized, ~5, owner-configurable) + a pull-up launcher grid holding every destination |
| Quick capture (mobile) | Opens at the top from a bottom trigger; popovers can stack | Bottom-sheet capture; one open layer at a time |
| Search | Cmd+K palette exists but has zero visible affordance; unreachable on phone | Search slot in the nav + launcher; palette unchanged |
| Tab strips (mobile) | Tasks tabs overflow with no scroll affordance ("Plann…" clipped) | Scrollable strip with edge fade + swipe-between-tabs |

## Settled decisions (from review, 2026-07-03)

1. **Swipe on task rows:** right = **Complete**, left = **Schedule/snooze** (both non-destructive; Trash lives in the long-press menu, with an undo toast as the safety net regardless).
2. **Desktop lists** open a right-side **peek panel** at ≥1280px of *content* width; center modal below that.
3. **Per-type color:** subtle — type icon + chip tint only, no row/canvas washes.
4. **Light mode:** ship the **mechanism only** this pass (neutral-ramp variables + one dev-flag proof screen); the theme itself is a later slice.
5. **Mobile bottom bar:** fixed, icon-only, screen-sized (~5 slots, owner-configurable) **plus a pull-up launcher grid** holding every destination. The launcher is why nothing is lost: the full set is one swipe up, in a fixed spatial layout that's more memorizable than a scrolling strip. Icon-first (no per-slot labels except the active one) reclaims the vertical space labels were eating.

## 1 · The token layer (light-mode-ready)

Today `globals.css` defines four variables (`--background`, `--foreground`, `--accent`, `--ui-scale`) and everything else is hardcoded Tailwind neutrals — **~2,790 `neutral-*` class usages across 234 component files**. That's the light-mode blocker and the reason surfaces drift apart visually. Two tiers, deliberately cheap:

1. **A semantic layer** for surfaces, lines, and ink, registered in Tailwind's `@theme`, so refreshed components use `bg-surface-1`, `border-line`, `text-ink-muted` instead of raw neutrals. New and refreshed code adopts these; untouched code keeps working.
2. **A ramp inversion path for light mode.** Because Ledgr is dark-only, its neutral usage is directionally consistent (900s are backgrounds, 100–400s are text). Tailwind v4 lets us redefine `--color-neutral-*` as CSS variables, so a future `.light` class flips the ramp once instead of touching 2,790 call sites. This pass ships the *mechanism* and one dev-flag proof screen — not the theme.

The exact `neutral-N → semantic token` mapping table and the dark hex values are pinned in slice S1 so the refactor is mechanical.

Riding the same slice: a disciplined **type scale** (title 24/semibold · section 13/medium/tracked-caps at ~60% ink · row 14 · meta 12), an **8px-grid spacing rhythm** (replacing the mixed `mt-4..mt-10`), one unified **card radius**, borders one tone **quieter** (`--line`) and hover/selection one tone **brighter** (`--surface-2`). That border/surface swap alone removes most of the "wireframe of gray boxes" feel while keeping the calm dark identity. Badge counts cap at `99+`.

## 2 · Desktop: per-surface width

Per-surface, not a global widening:

- **Lists, tables, planner** go full-width (`max-w-none`, 24–32px gutters). The audit showed two-thirds of a 1440px screen empty while titles truncate.
- **The item canvas stays a reading column** (~680px) — prose wants a measure, and the arrangeable grid (ADR-069) already lets any type go wide deliberately. The refresh only tightens its vertical rhythm.
- **Dashboards are already owner-shaped** (react-grid-layout); they inherit the token polish but keep their layout engine untouched.

**Peek panel** (the one structural addition). Row click opens the same `ItemCanvas` in a third variant (`page` / `modal` / `peek`) docked to the **trailing edge of the content region** on list surfaces. The intercepted route still fires (URL updates, back/refresh work); the `@modal` slot branches to the panel instead of the overlay when the content region is wide enough (≥1280px of *content*, measured inside the nav frame). ↑/↓ walk rows with the peek following; Enter / ⌘↵ expands to the full page. When room is tight — a narrow window, or a right-docked/split nav — it falls back to the center modal automatically.

**Search** gets a permanent **nav slot**, rendered wherever the owner has docked the nav, opening the existing `CommandPalette`. No new search machinery.

**Nav-position neutrality (important):** nav position is owner-configurable — top / bottom / left / right / split / combined on desktop; floating bottom bar on mobile. Every affordance here is positioned relative to the nav frame and content region, never a hardcoded edge: the search entry is a nav slot, the peek panel docks to the content region with the modal fallback, and the mobile launcher rides whatever the bottom bar is. The mockups show the default left-rail config as one representative layout.

## 3 · The mobile gesture layer

Still the same responsive app (a dedicated mobile surface stays a post-1.0 fork per `mobile-swipe-navigation.md`), but touch becomes first-class:

- **`SwipeRow`** — a small client wrapper for list rows: horizontal drag past a threshold reveals an action (right = Complete for tasks; left = Schedule, opening a snooze/date picker). Vertical scroll passes through; the gesture is only claimed once `|dx| > 24px` **and** `|dx| > 2·|dy|`, and is suppressed when the touch starts inside a horizontally scrollable container (`closest('[data-scroll-x]')`) — the exact rule `mobile-swipe-navigation.md` called for, applied to rows first where the payoff is highest. No dependency; same `touchstart/move/end` pattern as the shipped kanban long-press drag.
- **Long-press row menu** — one context menu for every list row (mobile long-press, desktop right-click): Complete / Schedule / Move / Focus / Trash. This is what lets the always-visible per-row `Trash` button disappear everywhere.
- **Bottom-sheet item view** — under 640px the intercepted `@modal` route renders as a sheet (grabber, drag-down to dismiss, spring to full height); swipe-right from the sheet's left edge = back/close. Hit zone is the sheet chrome, not the editor, so it doesn't collide with text selection.
- **Swipeable tab strips** — the Tasks tabs and list lenses become one shared scrollable strip with an edge-fade; horizontal swipe on the strip (not the content) moves between tabs.
- **Fixed icon-only bottom bar + pull-up launcher** — the bar stops scrolling and drops per-slot labels (label only under the active slot), fitting ~5 owner-chosen destinations at a comfortable tap size. A grip handle (or swipe up) opens a bottom-sheet **launcher grid** of every destination (Home, Favorites, Inbox, Tasks, Planner, Notes, Meetings, People, Types, Dashboards, plus Search, Build, Settings, Trash). Nothing from the old scrolling bar leaves reach — it moves into a surface that shows it all at once. Generalizes the `⌃` pull-up affordance already on the bar today. The daily 4–5 stay exactly where the thumb expects; the long tail is one swipe up.
- **Capture sheet** — `QuickCapture` moves from a top-of-screen popover to a bottom sheet on mobile, with the parse-derived chips (date, priority, @person, type) rendered as removable pills (the parser already exists, ADR-084/140; this is its UI).

## 4 · Availability: nothing lost, everything reachable

The simplicity moves hide things; every hidden thing needs a ≤2-step path (the defer-by-hiding rule):

- **Row actions:** swipe or long-press (mobile), right-click or hover ⋯ (desktop). Undo toast on every destructive action — soft-delete makes it safe.
- **Everything not in the bottom bar** lives in the pull-up launcher — all previous slots, Search, Build, Settings, Trash.
- **Rich/Source toggle, arrange mode, export** move into the item ⋯ menu — one tap deeper, always labeled (the "scope the UI" rule).
- **Cmd+K palette** unchanged; gains two visible entry points (nav slot, launcher). `q` still quick-captures.
- **Per-view columns** stay owner-editable in the ViewBuilder; the new lens defaults are just defaults.

## 5 · Build order (each slice independently shippable + eyeballed on dev-auth)

Sequenced so the token layer lands first (everything styles from it) and gestures land before the sheet (the sheet reuses the drag machinery). Each slice gets its own one-line acceptance criterion written when it starts.

1. **S1 · Tokens + rhythm** — semantic layer, neutral-ramp variables, type scale, quieter borders, radius/spacing rhythm, badge caps; zero behavior change. `src/app/globals.css`, `src/app/layout.tsx`.
2. **S2 · Desktop lists** — full-width list/table layouts, per-lens default columns, nav-position-aware search slot, richer rows (tags/linked/updated). `src/app/list/[type]/page.tsx`, `src/components/lists/ListLenses.tsx`, `src/components/views/ViewRenderer.tsx`, `src/components/nav/NavShell.tsx`.
3. **S2b · Peek panel (spike first)** — `ItemCanvas` `peek` variant docked to the content region; `@modal` branch on content-width; modal fallback for tight/right/split nav; ↑/↓ walks rows, Expand promotes. Spike the intercepted-route behavior before wiring (ADR-069 precedent). `src/components/canvas/Modal.tsx`, `ItemCanvas.tsx`, `src/app/@modal/(.)items/[id]/page.tsx`.
4. **S3 · Item canvas rhythm** — chip field strip under title, collapsed empty sections, Rich/Source + arrange into ⋯ menu, side-by-side panels ≥1024px. `src/components/canvas/MarkdownCanvas.tsx`, `FieldStrip.tsx`, `ItemActionsMenu.tsx`, `canvas-fields.ts`.
5. **S4 · Row menu + row redesign** — shared `RowMenu` (long-press/right-click), visible Trash removed from all rows, task rows drop redundant chips, relative dates. New `RowMenu.tsx`, list row components, `src/app/tasks/*`.
6. **S5 · SwipeRow** — swipe complete (right) / schedule (left) with undo toast on complete, wired into generic list + tasks + views list layout. New `SwipeRow.tsx`, same call sites as S4.
7. **S6 · Mobile shell** — fixed icon-only bottom bar + pull-up launcher grid, bottom-sheet item view, capture sheet, swipeable tab strips with edge fade. `src/components/nav/NavShell.tsx`, `src/components/canvas/Modal.tsx`, `src/components/today/QuickCapture.tsx`, new `TabStrip.tsx`, new `Launcher.tsx`.
8. **S7 · Dashboard + home polish** — compact mobile stat cards, Recently-Touched cleanup (cap badge, hide completed), widget chrome on tokens. `src/components/dashboards/WidgetFrame.tsx`, `WidgetBody.tsx`, `dashboard-widgets.ts`.

## 6 · Risks (all in named fragile areas — runbook §6a)

- **CSS load-order regressions** — styling/CSS is a named fragile area with the strict `cssChunking` fix (PR #131). S1 touches `globals.css` heavily; re-run the unstyled-flash check after every CSS slice.
- **Gesture conflicts** — swipe-vs-scroll and swipe-vs-editor-selection are the classic failure modes; mitigated by the claim threshold, `[data-scroll-x]` suppression, and never attaching gestures inside the editor. The mobile editor is itself a fragile area; S6 re-runs its checklist.
- **Peek panel vs. intercepted routes** — the `@modal` slot has bitten before (ADR-068's hard-nav fix). The peek variant must reuse the same escape rules; test back/refresh/expand from peek explicitly. This is why S2b spikes first.
- **Favorites popup and lenses** are fragile areas adjacent to S2/S6 — regression pass before merge.
- **Scope creep** — dashboards and the arrangeable canvas are deliberately *not* redesigned (owner-shaped); they only inherit tokens. Light mode is deferred; only the flip mechanism ships.

## 7 · Verification (per slice, on dev-auth against live data)

- 1440px + 375px pass on every touched surface (screenshots in PR).
- No unstyled-flash: hard-reload 5× on `/`, `/tasks`, `/list/note` after each CSS slice (runbook §6a).
- Touch emulation: swipe-complete fires only on deliberate horizontal drags; vertical scroll never triggers it; kanban drag still works.
- Peek panel: click row → URL updates; back closes; refresh lands on full page; Expand works; center modal still used <1280px and under right/split nav.
- Bottom sheet: swipe-down closes; editor selection inside the sheet unaffected; mobile-editor fragile-area checklist re-run.
- Every removed-from-view action reachable in ≤2 steps (Trash, Source view, arrange, search, all previous nav destinations).
- Select mode, bulk bar, favorites popup, and lens switching regression pass.
- `npm run build` clean; `.light` dev-flag flip renders one legible screen (proof, not shipped).

## Core / collaboration

**Non-core / solo** per CLAUDE.md's collab line (UI/UX polish + view definitions + per-instance chrome). The two cross-cutting pieces — the **token layer** (a shared visual vocabulary Tyler's modules inherit) and the **mobile interaction standard** (SwipeRow / RowMenu / launcher) — get an **ADR + a CLAUDE.md working-convention line** when S1/S4–S6 land, and a **🟢 courtesy heads-up** to Tyler now, so he builds on the same language. It is not a both-agree gate: none of the frozen-core list (data model, canonical body format, type/canvas model, module boundary, provider interfaces, cross-cutting invariants, MCP/API contract, the nine principles) is touched.

## Pointers (exact files)

- **Tokens/theme:** `src/app/globals.css` (the 4 current vars + `@theme inline`), `src/app/layout.tsx` (per-owner/per-surface `--ui-scale` + accent injection), `src/lib/settings.ts` (`TEXT_SIZE_PX`, `UI_SCALE`).
- **Lists/lenses:** `src/app/list/[type]/page.tsx`, `src/components/lists/ListLenses.tsx`, `src/lib/list-lenses.ts`, `src/components/views/ViewRenderer.tsx`, `src/lib/views.ts` (the ADR-049 `columns` machinery).
- **Item canvas:** `src/components/canvas/{ItemCanvas,MarkdownCanvas,Modal,FieldStrip,ItemActionsMenu}.tsx`, `src/lib/canvas-fields.ts`, the intercepted routes `src/app/items/[id]/page.tsx` + `src/app/@modal/(.)items/[id]/page.tsx`.
- **Nav:** `src/components/nav/{NavShell,Nav,BuildSidebar}.tsx`, `src/lib/{build-nav,nav-layout,nav-icons}.ts`, `mobileSlots` in `src/lib/settings.ts`, `src/components/search/CommandPalette.tsx`.
- **Capture:** `src/components/today/QuickCapture.tsx`, the shared `src/components/capture/*` (mention typeahead, ADR-140).
- **Dashboards:** `src/components/dashboards/{WidgetFrame,WidgetBody}.tsx`, `src/lib/dashboard-widgets.ts`.
- **Precedent to mirror:** the ADR-069 spike-first approach (`explorations/item-canvas-layout.md`) for S2b; the shipped kanban long-press drag for `SwipeRow`.
