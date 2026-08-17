# Project review timeline — the everything-timeline of a record

**Status:** parked idea (Tyler, 2026-08-17). Not intent, not a decision. Module-level UI over existing data — no new tables expected, so likely NOT core, buildable solo when its time comes.

## The idea (Tyler's words, lightly compressed)

A full page that lets you review a whole project by scrolling through time: "a complete vertical timeline of everything — when notes were made, when meetings were had, when key findings came forward, when milestones got completed — with the bigger events (meetings, milestones) standing out among everything (task completions, notes made, links added). The user could scroll down through a whole project to review a project. I see the vertical timeline being a line in the middle of the page with dates popping up on the left and right and the big dates as like h1 or h2's on that page."

## What exists today (the seed)

- **`/items/[id]/timeline`** (2026-08-17): a light chronological page of the record's meetings + milestones, month-grouped, with open undated milestones in an "Uncompleted" tail. The Timeline widget card drills into it. This page is the natural home for the full version — same URL, richer render.
- **The data is already captured.** Every candidate event has a timestamp somewhere: `activity_events` (the record's activity log already records task_added / note_added / milestone_added / status changes with `occurred_at`), `items.created_at` for contained notes/links, `meeting_at` for meetings, `due_date` + the ADR-196 `properties.completed_at` stamp for milestones, and task `updated_at`-at-done (weak — see open questions). A first cut is a UNION over those sources, not new capture.

## Shape

- One vertical spine down the center; entries alternate left/right of it.
- **Two visual tiers:** big events (meetings, milestone completions, maybe status changes) render large — the h1/h2s of the scroll — with everything else (task completions, notes created, links added) as small ticks between them.
- Month/year headers as you scroll (the current page's month groups, promoted).
- Read-only; every entry links to its item. This is a REVIEW surface, not an editor.

## Open questions

- **Task completion times are not stored** — `updated_at` at done-time is an approximation that drifts on any later edit. If task ticks matter, tasks need the same `completed_at` stamp milestones got in ADR-196 (additive, same mechanism), or the timeline reads task events from `activity_events` instead.
- **"Key findings" is not a thing yet.** Closest existing signals: a note contained in the record, a comment, or a manually-pinned entry. May want nothing new: a note IS the finding, and its creation date places it.
- **Volume.** A year-old project could have hundreds of small ticks; the two-tier design plus month collapsing is probably enough, but virtualize if not.
- Whether this replaces the Timeline **widget card** (probably not — the card stays the glanceable preview; this is the drill-down).

## Related

- The dashboards-as-activity-surfaces direction (ADR-171) and the Recent Activity widget — this is the same activity data, project-scoped and rendered as a narrative instead of a feed.
- `explorations/flexible-surfaces.md` — if custom composable pages land, this could be a page template rather than a bespoke route.
