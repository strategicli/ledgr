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

## The north star: calendar planning from inside Ledgr

The real prize, in Brandon's words, is to **see tasks, events, and goals in Ledgr and give them shape on the calendar**, instead of doing that shaping by hand in a separate calendar app. This is a current giant gap in the workflow. It spans two scales:

- **Small one-offs:** "when will I draft this job description?" → pick a slot, done.
- **Large, involved planning:** "I'm preaching twice in August, 20 hours of prep each, so 40 hours of sermon prep to place between now and then." This is a lot of manual work today and is exactly the headline case for AI scheduling (Feature 1) sitting on the deterministic placer (Feature 3).

Everything below serves that goal; the data-model and notification choices are means to it.

## How the calendar is brought in today (the foundation this builds on)

Researched 2026-06-15 against the built code. **Calendar sync already exists** (ADR-023): every event in the next 14 days is pulled in and **a `meeting` item is created for each one**, deduped on `ms_event_id`, with reschedule/cancel handling, and attendees stored structured + FTS-searchable. The matcher (ADR-024) then links the events it recognizes to people/templates. So **calendar events are already items that can be linked** — Brandon's #2 instinct is already half-true in the code.

**The tension (Brandon, 2026-06-15, from the calendar screenshot):** today *every* event becomes a `meeting`, even ones that clearly are not meetings ("Drop Simon off for Camp," "Cancel YouTube TV," "Spiritual Retreat"). The cleaner model Brandon proposes:

> A **calendar event** is the general thing. A **meeting** is an event that happens to have people and prep. A **time-block** is an event that happens to be linked to a task.

So a block is not a new primitive: it is "a calendar event associated with a task," and a meeting is "a calendar event associated with people/prep." This reframes the data-model question below from "invent a block type" to "generalize the existing meeting-from-event ingestion into an `event` concept, with meeting and block as specializations." That generalization is **core** (it touches the type model) and is arguably bigger than time-blocking alone, so it likely wants its own both-agree + ADR discussion (or its own exploration) before this builds on it. Noted as a direction to explore with Tyler, **not** a settled choice.

## Data model options (the core, both-agree part)

Everything stays an item (Principle 2); no parallel `time_blocks` table.

- **Stage A, single block on the task (cheapest).** Add a scheduled start + duration to the task. The common case is one work session. Ride `properties` first (no migration, no core change) to prove the UX, then graduate to real columns (`scheduled_at timestamptz`, `scheduled_minutes int`) once it earns indexing, since "hot fields are columns" and the calendar view will query them. The column step is the core/ADR step. **(Brandon agrees with this `properties`-first → promote-to-column direction, 2026-06-15.)**
- **Stage B, blocks as their own event items (for "40 hours over the summer").** Multi-session work needs several blocks per task, so a single field on the task is not enough. Per the reframe above, a block is a calendar **event** item linked to the task via `relations` (role `scheduled`), placed by a date property the way the calendar/agenda view already places items. **Brandon's point (2026-06-15): since calendar events are *already* ingested as items, Stage B may be the more natural floor than Stage A** — rather than inventing a parallel block field, reuse the event-as-item that calendar sync already produces and just add the task link. This depends on resolving the event/meeting generalization above first.

Recommendation: if the event-model generalization lands, Stage B (block = event item linked to a task) is the cleaner target and Stage A is just the interim if that conversation is not ready. Decide the column/type question as an ADR once the event model is settled.

## Getting blocks onto Brandon's real calendar: Todoist feed, not Graph write-back

> **Contingent on keeping Todoist.** The recommendation below assumes direction (A) of `explorations/tasks-todoist-vs-native.md` (keep Todoist). If Brandon and Tyler decide to drop Todoist and make Ledgr the task manager, this external-calendar + notification path is replaced by the **Ledgr-published ICS calendar feed** described in that doc. The two explorations are one conversation.

Brandon wants scheduled work to show on his actual calendar (the calendar app in the screenshot), and he floated a middle-ground: "maybe Ledgr publishes its own calendar I can toggle on/off in Outlook, like Todoist does now." Research (2026-06-15) shows that path is **already most of the way built**, and it does not need a Microsoft write scope.

The notification/calendar-surfacing options:

1. **Todoist as the surface (recommended, mostly built).** The current plan already names **Todoist as the notification engine, by design** (PRD §4.6/§5.2): dated tasks auto-push to Todoist (ADR-026), Todoist supports a due time + `duration`, and — per Brandon's screenshot — Todoist already appears as a **calendar overlay he can toggle** in his calendar app. So a scheduled block (task + time + duration) pushed to Todoist gets, in one mechanism: the reminder fires *and* the block shows on his calendar feed. This is exactly the "Ledgr's own toggleable calendar in Outlook" idea, achieved for free through the Todoist feed. **No new Graph scope.**
2. **Ledgr-native calendar view only.** Blocks render on Ledgr's own calendar view, overlaying the already-synced events for free/busy. Always built regardless; it is where the planning happens. Does not by itself put blocks on the external calendar (option 1 does that).
3. **Direct Outlook write-back (deprioritized).** Push blocks to Outlook as real events via `Calendars.ReadWrite` (a new scope = a Brandon admin-consent step) + `ms_event_id` dedupe. Given option 1 already delivers "on my calendar + reminder," write-back's main remaining use is the **link-back idea** below, which is low value. So this drops to a nice-to-have, not the plan.

**The meeting-note link-back idea (Brandon, 2026-06-15, with his own skepticism):** Ledgr sees a calendar meeting, Brandon makes a meeting note, Ledgr writes the note's link into the Outlook event's description so it is clickable from the calendar side. Brandon's own read: low payoff, because finding the date on the calendar and finding the same date in Ledgr already gets you there. Recorded, not pursued; it would be the one thing that justifies the write scope, and it does not justify it on its own.

## Notifications (Brandon's parenthetical: "maybe this solves it") — yes

Scheduling solves the notification gap, and the mechanism is option 1 above. Undated tasks have no *when* for a reminder; a scheduled block gives them one. That block pushes to Todoist (the by-design notification engine), which fires the reminder on Brandon's phone. So manual assignment (Feature 2) genuinely does answer the notifications question, via the Todoist path that already exists, with no new push infrastructure and no Microsoft write scope. Ledgr's own web push stays scoped to what it is already planned for (morning-agenda summary, prep-ready notices).

## The deterministic placer (Feature 3, the engine 1 and 3 share)

Plain code, no model. Inputs: busy windows (from synced `meeting` items), a per-owner **working-hours + no-go config** (a new shape in `lib/settings.ts`: work hours, days off, protected windows like Sunday morning), the task's duration estimate, and its deadline. Algorithm: earliest-fit / first-fit across the horizon, honoring working hours and skipping busy windows; for overdue tasks, find the next open slot and propose the move. Output is **suggestions the user confirms**, which reuses the existing `suggested`/`confirmed` `match_state` pattern (ADR-024): proposed blocks render provisionally and stay out of trusted queries until confirmed, the same gesture as a calendar match. Feature 1's MCP tool (`schedule_work(item, hours, window, constraints)`) calls this same engine.

## What already exists to build on

- **Calendar/agenda view + `ViewRenderer`** (ADR-029) places items by a date property: blocks render here with no new layout engine.
- **Calendar sync → event/`meeting` items** (ADR-023) is the free/busy source for the placer, and the ingestion this generalizes for the event-model reframe.
- **Todoist sync** (ADR-026) is the path to the external calendar + reminders: it already pushes dated tasks, Todoist carries time + `duration`, and its calendar feed is the toggleable "Ledgr on my Outlook calendar" surface. This is the notification answer.
- **`suggested`/`confirmed` relations** (ADR-024) give confirm-first proposed blocks for free.
- **`lib/settings.ts`** is the home for the working-hours/no-go config.
- **MCP layer** (Phase 3) is where Feature 1 (the "40 hours of sermon prep" scheduler) lives.
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

- **The event-model reframe (biggest, core).** Generalize the current "every calendar event becomes a `meeting`" into a general **event** item, with meeting (has people/prep) and time-block (linked to a task) as specializations? This is a both-agree + ADR conversation with Tyler and may warrant its own exploration; time-blocking's data model (Stage A vs. B) largely waits on it.
- Working-hours/no-go config: how rich (per-day hours, recurring protected windows, energy/context tags like "deep work mornings")?
- Does an overdue-reschedule rule run on demand (a button) only, or also as a daily suggestion pass? (Keep it suggestion-only to honor "AI on purpose" culture even though the rule itself is deterministic.)
- Relationship to `explorations/project-items.md`: "40 hours on this sermon project" implies scheduling against a parent/project, with blocks possibly attached to subtasks.

## Settled directions (Brandon, 2026-06-15)

- **Storage:** `properties`-first → promote to columns once the shape is proven (Stage A), with Stage B (block = event item linked to a task) the likely real target if the event-model reframe lands.
- **External calendar + notifications:** lean on the **Todoist feed**, not Graph write-back. It already pushes dated tasks, carries duration, fires reminders, and shows as a toggleable calendar overlay. Graph `Calendars.ReadWrite` write-back is deprioritized to a nice-to-have.
- **Meeting-note link-back into the Outlook event:** recorded, not pursued (low payoff).
