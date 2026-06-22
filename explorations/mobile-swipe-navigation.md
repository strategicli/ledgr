# Exploration: horizontal swipe navigation on mobile

**Status:** parked (Brandon, 2026-06-14). Not intent, not a decision. Raised from real mobile use.

## The idea

On mobile, there's a natural instinct to swipe left/right to move between adjacent nav items (the way iOS tab bars and many apps work). Today, navigation requires tapping a slot in the bottom bar. Brandon keeps reaching for a horizontal swipe to get to the next or previous section.

The question is whether this would feel natural and whether it's feasible given the current nav model.

## What "adjacent" means

The bottom-bar nav slots are ordered (Home → Tasks → Notes → etc.). A swipe-right on the current page would go to the next slot; swipe-left to the previous. This mirrors iOS Safari's back/forward swipe, extended to sibling sections rather than browser history.

## Constraints and complications

- **Conflicts with editor gestures.** Inside the canvas (Tiptap), horizontal swipes are used to select text and may be used for table column resizing or future block-drag. A swipe nav would need a clear hit zone — e.g., only the nav bar itself, or the bottom portion of the screen below the content area, or a velocity/distance threshold that distinguishes nav-swipe from scroll.
- **Conflicts with scrolling.** If the content area is narrow and the list scrolls horizontally (board/table views), a nav swipe would interfere. Need to suppress nav-swipe when the content is itself horizontally scrollable.
- **Discoverability.** Swipe nav is invisible — users don't know it's there without a hint or prior experience (iOS's pager dots, Android's tab ripple).
- **The PWA shell.** The current SW/app shell is conservative. A gesture listener would live in the top-level layout, not the SW, so it's a layout-level JS addition — no SW changes.

## Feasibility

Technically straightforward: a `touchstart`/`touchend` handler in the shell layout that measures horizontal delta, ignores if the touch started in a scrollable horizontal container, and pushes the next/previous slot's path via the router. The tricky part is reliably detecting "am I inside a horizontally-scrollable child?" to suppress the gesture — doable with `closest('[data-scroll-x]')` or checking `scrollWidth > clientWidth` on the target.

## Open questions

- **Which viewport zones should respond?** Full screen, or only the bottom nav area (safer, less conflict)?
- **Does it feel right alongside the bottom bar?** Some apps use both (tap + swipe) cleanly; others feel redundant.
- **Should item-open/close use a vertical swipe (up to open, down to dismiss), matching iOS sheet pattern?** This might address the separate problem of "hard to close items on mobile" more naturally than a button.
- **Breadcrumb / back interaction:** does swipe-left on a canvas mean "close the item" or "go to the previous nav slot"? Needs a clear rule (probably: swipe from canvas → close; swipe from list → change slot).

## Carried forward (Brandon, 2026-06-21; verified 2026-06-22) — mobile as its own surface, deferred

The wider frame this swipe idea sits inside: **mobile should be its own surface, not just a responsive squeeze of the desktop one.** Desktop-first; mobile = its own shapes — quick-add, simplified views, and *not* every desktop tool (no papers/songs editing on a phone), likely its own Build section. Explicitly **deferred** — post-1.0, after the 1.0 sprint converges.

**Known pain now (Brandon, from real phone use):** default fonts too small + low contrast on mobile. Partly addressed already — a configurable **prose text-size setting** shipped (commit `bcbf10d`, "Reduce mobile canvas margins and add prose text size setting") plus mobile kanban long-press drag and assorted mobile-row tweaks. But that's incremental responsive polish, not a dedicated mobile surface.

**Verified state on main (2026-06-22):** there is **no** mobile-specific surface/route/Build section — the app is purely responsive via Tailwind `sm:` breakpoints, with `NavShell` rendering the floating bottom pill on mobile (`sm:hidden`) and the configurable layouts at `sm+`. A `mobileSlots` prop lets the bottom bar hold a different slot set, but it's the same component, not a distinct surface. The swipe-nav idea above is unbuilt (no `touchstart` nav handler).

This is a roadmap/scope stance more than a single feature: when mobile is picked up, decide whether it's a parallel surface (its own nav model, simplified views, mobile-only Build) or continued responsive refinement. Lean: continued refinement through 1.0; a dedicated surface is a post-1.0 effort.
