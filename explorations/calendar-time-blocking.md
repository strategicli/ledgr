# Exploration: calendar time-blocking (schedule tasks onto the calendar)

**Status:** parked (Brandon, 2026-06-15). Not intent, not a decision. Largely **core** (touches the data model and the calendar provider seam), so the parts that change `schema.md` or the type model land as an ADR with both-agree before they build. Raised after looking at [Morgen](https://www.morgen.so/).
**Source:** Brandon, inspired by Morgen's task-to-calendar scheduling.

## The idea

Morgen lets you turn intentions into calendar time. Three flavors, which map cleanly onto Ledgr's "deterministic by default, AI on purpose" line (Principle 3):

1. **AI scheduling (on purpose).** "Slot 10 hours of work on this project across the next two weeks," in natural language, and it places the blocks. This is the Claude/MCP layer (Phase 3): the model interprets the request and the constraints, then calls the deterministic placer (below) to find real slots rather than inventing times. AI is the front-end; plain code does the placing.
2. **Manual assignment (deterministic).** Drag a task onto the calendar, or pick a time, to schedule when you will work on it. The common case and the foundation everything else builds on.
3. **Deterministic suggestions/rules (no model).** Plain-code rules that propose where a task could fit, and that reschedule overdue tasks into the next open slot. No AI in this loop (it would be cron-adjacent plumbing, which Principle 3 keeps model-free).

Feature 2 is the primitive; 3 is rules over the primitive; 1 is a natural-language front-end over 3.

## The core distinction: deadline vs. scheduled work

A task already has `due_date` (when it is *due*). Time-blocking adds *when you intend to work on it*, which is a different temporal thing. Morgen separates these, and so should Ledgr:

- **Deadline** = `items.due_date` (exists today; immovable constraint).
- **Scheduled block(s)** = one or more time windows (start + duration) where the work happens.

This also lines up with the integrations already in the stack: Todoist distinguishes a **deadline** (`deadlineDate`) from a **due time + `duration`**, so Ledgr's deadline ↔ Todoist deadline and a scheduled block ↔ Todoist due-with-duration is a clean mapping when Todoist sync grows to carry it.

## Data model options (the core, both-agree part)

Everything stays an item (Principle 2); no parallel `time_blocks` table.

- **Stage A, single block on the task (cheapest).** Add a scheduled start + duration to the task. The common case is one work session. Could ride `properties` first (no migration, no core change) to prove the UX, then graduate to real columns (`scheduled_at timestamptz`, `scheduled_minutes int`) once it earns indexing, since "hot fields are columns" and the calendar view will query them. The column step is the core/ADR step.
- **Stage B, blocks as their own items (for "10 hours over 2 weeks").** Multi-session work needs several blocks per task, so a single field on the task is not enough. A block becomes a lightweight item (an `event`/`block` type, or a reuse of the existing `meeting` placement) related to the task via `relations` (role `scheduled`), placed by a date property the way the calendar/agenda view already places items. Introducing a type is the core/ADR decision; the relations and view plumbing already exist.

Recommendation: ship Stage A behind `properties` to learn the interaction, decide the column/type question as an ADR once the shape is known.

## Where blocks live: Ledgr-only, overlay, or write-back

Calendar sync today is **read-only** (`Calendars.Read`, ADR-022/023): the next 14 days of Outlook events arrive as `meeting` items with `meeting_at`. That is exactly the free/busy signal a placer needs. Three postures:

1. **Ledgr-native layer (start here).** Blocks are Ledgr items shown on Ledgr's calendar view. No new Graph scope. The view *overlays* the already-synced meeting items so scheduling sees real commitments, it just does not write back to Outlook.
2. **Write-back (opt-in extension).** Push blocks to Outlook as real events so they show on Brandon's actual calendar and fire Outlook's own reminders. Needs `Calendars.ReadWrite` (a new scope = a Brandon admin-consent step) and `ms_event_id` dedupe so a written block is not re-ingested as a new meeting. This is a deliberate user action, not background sync, so it does not violate the read-only-plumbing posture, but it is the bigger commitment.

Posture 1 first; 2 as a later toggle if Brandon wants blocks on the real calendar.

## The deterministic placer (Feature 3, the engine 1 and 3 share)

Plain code, no model. Inputs: busy windows (from synced `meeting` items), a per-owner **working-hours + no-go config** (a new shape in `lib/settings.ts`: work hours, days off, protected windows like Sunday morning), the task's duration estimate, and its deadline. Algorithm: earliest-fit / first-fit across the horizon, honoring working hours and skipping busy windows; for overdue tasks, find the next open slot and propose the move. Output is **suggestions the user confirms**, which reuses the existing `suggested`/`confirmed` `match_state` pattern (ADR-024): proposed blocks render provisionally and stay out of trusted queries until confirmed, the same gesture as a calendar match. Feature 1's MCP tool (`schedule_work(item, hours, window, constraints)`) calls this same engine.

## Notifications (Brandon's parenthetical: "maybe this solves it")

Yes, partly. A scheduled block gives a reminder a concrete *when* ("time to work on X"), which the Phase-2 push-notification work otherwise lacks for undated tasks. And if blocks are written back to Outlook (posture 2), Outlook's own reminders fire with no Ledgr push infra at all, which is also more Sunday-proof. So scheduling and notifications reinforce each other.

## What already exists to build on

- **Calendar/agenda view + `ViewRenderer`** (ADR-029) places items by a date property: blocks render here with no new layout engine.
- **Calendar sync → `meeting` items** (ADR-023) is the free/busy source for the placer.
- **`suggested`/`confirmed` relations** (ADR-024) give confirm-first proposed blocks for free.
- **`lib/settings.ts`** is the home for the working-hours/no-go config.
- **MCP layer** (Phase 3) is where Feature 1 lives.
- **`explorations/canvas-drag-and-drop.md`** is the drag mechanic for dragging a task onto the calendar.
- **`explorations/provider-seam-calendar-email.md`** matters because write-back must go through the calendar provider interface, not hard-coded Graph, so Tyler's Google adapter can satisfy the same write contract.

## Constraints to honor if built

- **Deterministic (Principle 3):** the placer, the overdue-reschedule rule, and manual assignment are plain code. AI only interprets the natural-language request and calls the placer; it never picks times in a cron.
- **Everything is an item (Principle 2):** blocks are items related to the task, never a parallel table.
- **Core is frozen behind agreement:** any `schema.md` column, a new `event`/block type, or widening the calendar provider seam to write is both-agree + ADR. The settings shape, the placer engine, and the calendar-view UX are not core (solo-movable).
- **Read-only sync stays the default:** write-back is an explicit opt-in with its own scope, not the baseline.
- **Fast + cheap (Principle 8):** the placer reads already-synced data and a settings row; no extra polling. The calendar view stays body-free.
- **Incremental syncs only:** write-back uses the existing delta + `ms_event_id` dedupe discipline.

## Open questions

- Stage A on `properties` vs. straight to columns/an `event` type. How soon does multi-session ("10 hours over 2 weeks") become real, since that forces Stage B?
- One block type, or reuse `meeting` placement for blocks? (A block is a meeting with no attendees.)
- Write-back to Outlook in v1, or Ledgr-native only? (Decides whether the new Graph scope and `Calendars.ReadWrite` consent step are needed now.)
- Working-hours/no-go config: how rich (per-day hours, recurring protected windows, energy/context tags like "deep work mornings")?
- Does an overdue-reschedule rule run on demand (a button) only, or also as a daily suggestion pass? (Keep it suggestion-only to honor "AI on purpose" culture even though the rule itself is deterministic.)
- Relationship to `explorations/project-items.md`: "10 hours on this project" implies scheduling against a parent/project, with blocks possibly attached to subtasks.
