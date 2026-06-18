# Exploration: the daily focus layer ("Top 3" / in-focus) — T3 brainstorm

**Status:** open, brainstorm for the Native Tasks chunk (**T3**, ADR-073). **Mostly non-core** (a planning/presentation layer over tasks), but it lightly touches the task model (how "focus" is stored), so worth aligning before building. Pairs with `calendar-time-blocking.md` (focus is the lightweight cousin of time-blocking) and the Tier-4 **planning rhythms** (a morning "set today's focus" ritual).
**Source:** Brandon, 2026-06-17 — "layers like 'in-focus' or 'top 3' (where people choose 3 tasks that are vital for the day)."

**Leaning (Brandon, 2026-06-17):** the **day-stamped marker** (option (b) below) — a dated focus flag that auto-clears overnight, rendered as an ordered Top 3 with a soft cap, fronted by a "Today's Focus" zone on Today.

## The intent

A daily **intention** layer: each day, pick the vital few tasks so the day has a spine that is not just "everything due." It answers *"what am I actually doing today,"* which is distinct from *"what's due today"* (a list that is often long, stale, or empty). This is the well-worn "Most Important Tasks (MITs)" / Ivy Lee / "Top 3" method: name 1-3 things that matter, do those first.

## The core design questions

1. **What is "focus" — a flag, a per-day assignment, or a ranked list?**
   - **(a) A boolean star** ("in focus") on any task. Simplest. *Problem:* it doesn't reset, so yesterday's stars linger and it stops meaning "today."
   - **(b) A per-day assignment** (`focus.date = today`). Focus is naturally scoped to a day and rolls off on its own; a task is focused for today without touching its due date. *Recommended base.*
   - **(c) A ranked Top-N** (1 / 2 / 3) for the day — an explicit ordered short list. Strongest "vital few" discipline; needs an ordering and a cap.
   - **Recommendation:** (b) day-stamped, with an optional `order` so it can render as an ordered "Top 3" without a hard structural cap.

2. **Hard cap (exactly 3) or a soft nudge?** MIT methodology says 1-3. A hard cap enforces discipline but frustrates on heavy days; a soft cap (gentle "that's more than 3" nudge) is friendlier. **Recommend soft.**

3. **Daily reset / carryover.** At day rollover, do unfinished focus tasks carry forward, drop back to the normal list, or prompt a fresh pick? **Recommend:** focus is day-stamped so it auto-clears; a **morning re-pick** (manual now, AI-suggested later via Tier-4 rhythms) optionally pre-fills yesterday's unfinished. No silent carryover.

4. **Relationship to due / scheduled.** Focus is **orthogonal**: a task can be focused today though due Friday (starting early), or due today but not focused (triage later). Focus = intention; `due` = deadline; `scheduled` = plan (see `recurrence-model.md` fork 2).

5. **Relationship to time-blocking.** Focus is the lightweight cousin of time-blocking (`calendar-time-blocking.md`): "Top 3" without putting them on a clock. A focused task is the natural candidate to then drag onto the calendar.

## UX surfaces (the brainstorm)

- **A "Today's Focus" zone at the top of Today** — the first thing you see, the 1-3 picked tasks, checkable inline, above "due today" and "overdue." This is the primary surface.
- **A star/pin affordance on any task row** (list, board, item canvas) to add it to today's focus in one tap.
- **A "Top 3 / Focus" dashboard widget** (reuses the dashboards engine, ADR-064/065) so a focused Home/Today dashboard can feature it.
- **A morning "set your focus" prompt** (Tier-4 planning rhythm; deterministic now, optionally AI-assembled suggestion later — "here are 3 candidates from what's due + overdue + scheduled").
- **Optional later: a "focus mode"** that hides everything but the focused tasks (distraction-free), echoing TaskNotes' Pomodoro/focus framing.

## Recommendation (a starting shape)

- **Store focus as a day-stamped marker** on the task — a `focus` property `{ date: "2026-06-17", order?: n }` — owner data over the existing item, no schema change, naturally day-scoped.
- **Surface:** a "Today's Focus" zone on Today + a star affordance on task rows + a widget.
- **Soft cap at 3** with a gentle nudge; ordered.
- **No automatic carryover;** a morning re-pick (manual now, AI-suggested later).
- **Keep it orthogonal** to due/scheduled.

## What to decide (the forks)

1. **Flag (a) vs day-stamped (b) vs ranked Top-N (c).** Recommend **(b)** with soft ordering.
2. **Hard cap vs soft nudge.** Recommend **soft** (warn past 3).
3. **Carryover behavior.** Recommend day-stamped auto-clear + a morning re-pick.
4. **Prominence on Today** (a dedicated top zone vs only a widget vs both). Recommend top zone + optional widget.
5. **Is "focus mode" (distraction-free) in T3 or later polish?** Recommend later.

## Constraints

- **Everything is an item (Principle 2):** focus is a marker on the task, not a new entity.
- **Fast/cheap (Principle 8):** a `focus.date = today` property + an owner-scoped query; index-light.
- **Reuses existing surfaces:** Today, the views/board engine, the dashboards widget engine, and (later) the Tier-4 planning rhythm — so T3 is mostly wiring over things that exist, not new infrastructure.
