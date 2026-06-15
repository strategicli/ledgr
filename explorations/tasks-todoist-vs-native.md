# Exploration: keep Todoist, or make Ledgr a Todoist replacement?

**Status:** parked, **for joint Brandon + Tyler discussion** at their next sync (Brandon, 2026-06-15). **Core** (the `tasks` provider interface, the notification approach, and a recurrence model are all cross-cutting), so it lands as an ADR with both-agree before anything builds. It would also **reverse a standing PRD decision** (§4.6/§5.2 name Todoist the notification engine "by design"), so it is a real pivot, in the spirit of ADR-037, not a small change.
**Source:** Brandon, 2026-06-15, raised alongside the calendar time-blocking work (`explorations/calendar-time-blocking.md`), which currently leans on Todoist for both reminders and the calendar overlay.

## The fork

Two directions for how tasks, reminders, and offline capture work:

- **(A) Keep Todoist (the current plan).** Ledgr is canonical for content; dated tasks push to Todoist (ADR-026), Todoist owns recurrence, reminders, mobile capture, and a calendar feed. Todoist is the notification engine "by design" (PRD §4.6: "Task reminders remain Todoist's job, it is better at them than any PWA will be").
- **(B) Drop Todoist, make Ledgr the task manager.** Ledgr owns tasks end to end. No external task app. This is the natural endpoint of "Ledgr is where I plan and schedule my work," and it removes the oddity of depending on a third-party app for notifications and for putting my own planned work on my calendar.

## Why this is even a question now

The time-blocking exploration's recommendation (lean on the Todoist feed for reminders and for showing scheduled work on the Outlook calendar) is convenient precisely because Todoist is already wired up. But it makes Todoist **load-bearing for the calendar vision**, which is a tail-wagging-the-dog feeling: if Ledgr is meant to be the place Brandon shapes his time, routing that through Todoist to get it onto a calendar and to get a reminder is a workaround, not the design. Direction (B) asks whether Ledgr should just own it.

## What Todoist provides today that (B) must replace

Naming these honestly is most of the decision, because each is real engineering:

1. **Mobile reminders / push.** The hard one. Ledgr has a web-push sender already (ADR-034, used by the weekly health check ADR-052), but **iOS PWA push is less reliable than a native app**, which is exactly why the PRD handed reminders to Todoist. This is the crux question of (B).
2. **A calendar surface.** Today Todoist's feed shows tasks on Brandon's Outlook/Apple calendar (his screenshot). (B) needs its own: see "the non-Todoist calendar idea" below.
3. **Recurrence.** Todoist owns recurring tasks entirely today (ADR-026 deferred per-occurrence logic to it). (B) needs a Ledgr recurrence engine.
4. **Offline / quick capture.** Todoist inbox pull-in is the offline-capture path (ADR-010/026). (B) leans harder on the PWA share-target + offline queue.
5. **Natural-language dates + a polished mobile app.** Free with Todoist; a quality bar (B) inherits.

## The non-Todoist calendar idea (Brandon, 2026-06-15)

If Todoist is dropped, "show my planned work on my real calendar" needs a Ledgr-native path. The clean candidate: **Ledgr publishes its own calendar feed** that Brandon subscribes to / toggles on in Outlook, the way Todoist's feed works now, but sourced from Ledgr. Two ways to do that:

- **An ICS subscription feed** (a read-only `webcal://` URL of Ledgr's scheduled blocks + due tasks). Cheap, standards-based, no Microsoft write scope, works in Outlook/Apple/Google alike, and naturally **Sunday-proof** (the calendar app caches it). Calendar apps fire their own reminders off subscribed events, which **also answers the notification question without any push infrastructure**. The cost: subscribed feeds refresh on the calendar app's schedule (often slow), so it suits planned blocks better than last-minute reminders.
- **Writing to a real Graph/Google calendar** Ledgr owns (the heavier `Calendars.ReadWrite` path from the time-blocking doc). More immediate, but needs the write scope and per-provider adapters.

The ICS feed is the interesting one: it could deliver both the calendar surface **and** event-based reminders natively, making (B) much more feasible than "build reliable push from scratch."

## The provider-seam angle (why it might not be either/or)

CLAUDE.md's core list already includes a **`tasks` provider interface**. Today its only adapter is Todoist. Framed through the seam, the decision may not be a codebase-wide either/or:

- Ledgr could ship a **native task engine as the default adapter** and keep **Todoist as an optional adapter**, so Brandon runs native while Tyler keeps Todoist (or Google Tasks), the same per-instance freedom as calendar/storage adapters.
- The catch: notifications and recurrence are **engine work that only pays off if actually built**, so "make the seam swappable" does not by itself get Brandon off Todoist. Someone has to build the native reminder + recurrence + capture path.

So the real question for the sync is: **is building Ledgr's native task engine (reminders via ICS feed and/or push, recurrence, capture) worth it, versus the current zero-effort Todoist path?** And if yes, is it a shared default or a per-instance choice behind the seam?

## What to decide together (the agenda)

- **A vs. B**, or a staged path (keep Todoist now, build native behind the seam later).
- If B: **how reminders work** without Todoist (ICS-feed-fires-calendar-reminders vs. Ledgr web push vs. both), and whether iOS reliability is acceptable.
- If B: **the Ledgr-published calendar feed** (ICS subscription vs. writing a real calendar), which is shared with the calendar cluster (`explorations/calendar-time-blocking.md`).
- **Recurrence**: build a Ledgr recurrence engine, or keep that one piece on Todoist even if the rest moves.
- **Per-instance or shared**: does Tyler want the same, given his Google stack?
- This reverses **PRD §4.6/§5.2**: if B wins, the PRD intent log gets an ADR noting the reversal (ADR-037 precedent).

## Constraints to honor whichever way it goes

- **Provider-seam discipline (core):** tasks stay behind the `tasks` interface so Todoist-vs-native-vs-Google is an adapter choice, not a rewrite (Phase 4 packageability, PRD §6.1).
- **Boring stack, few dependencies (Principle 5):** an ICS feed is a string endpoint, no new dependency; a native push path leans on the existing web-push sender, not a new service.
- **Sunday-proof (Principle 4):** reminders for anything preached-adjacent must not depend solely on a flaky push channel; the ICS-feed path is attractive precisely because the calendar app caches it.
- **Fast for the user, cheap on the back end (Principle 8):** a published feed is one cached query; native push reuses existing cron + sender.
- **Everything is an item (Principle 2):** tasks stay rows in `items`; this is about the reminder/recurrence/sync layer around them, not a new task store.

## Relationship to other parked work

- **`explorations/calendar-time-blocking.md`** is the other half of this conversation: its "lean on the Todoist feed" recommendation holds only under direction (A). Under (B), its external-calendar + notification path becomes the ICS-feed idea above. The two docs should be discussed together.
- **`explorations/provider-seam-calendar-email.md`** is the sibling seam (calendar + mail); the `tasks` seam decision is the same shape of question.
