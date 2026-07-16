# Exploration: work timeline + capture (know where the hours went)

**Status:** exploration, raised 2026-07-16 (Brandon). Two halves that must be designed together: (1) a **timeline surface** in Ledgr, a human-readable, skimmable account of how time was spent and what progress was made; (2) a **capture layer**, tools that record work happening *outside* Ledgr (phone, computer, driving, visits) with near-zero manual effort. Parts are **core** (a new table or a new machine-API surface = both-agree + ADR); the timeline UI and individual capture scripts are solo-movable.
**Source:** Brandon. Two audiences for the output: a supervisor ("here is what I spend my time on") and Brandon himself (strategic analysis of work habits).

## The idea

Brandon's week is only partly visible to any one system. Meetings live on the calendar, tasks in Ledgr/Todoist, sermon prep in Logos and documents, pastoral care happens in hospital rooms and driveways, and a lot of connective work happens in a car. No tool sees all of it, so today the honest answer to "where did the hours go?" requires reconstruction from memory, which means it mostly doesn't happen.

The goal is a timeline where **most hours of a workday are accounted for automatically**, gaps are visible and easy to fill, and the result reads as a narrative a human can skim — not a surveillance log. Two distinct outputs:

- **Supervisor view:** aggregated, curated, weekly-ish. "Meetings 11h, sermon prep 9h, pastoral care 6h, admin 5h, driving 4h" plus highlights of what moved forward. Never raw items (privacy, below).
- **Self-analysis view:** finer-grained. Day-by-day blocks, category trends over weeks, fragmentation (how chopped-up were the mornings?), gaps, drift between intention (scheduled blocks) and reality.

## The alignment contract: one signal shape

The design move that makes the two halves independent: every capture source, present or future, emits the same shape, and the timeline consumes only that shape.

```
signal: { source, started_at, ended_at, kind, label, ref?, confidence }
```

- `source`: `calendar` | `task` | `revision` | `computer` | `phone` | `drive` | `location` | `email` | `manual` | …
- `kind`: the work **category** (meeting, sermon-prep, pastoral-care, admin, drive, build, …) — assigned by deterministic rules (below), correctable by hand.
- `ref`: optional item id (the meeting item, the task, the note edited), so a timeline block can click through to the artifact.
- `confidence`: `confirmed` (calendar event that happened, manual entry) vs `inferred` (app was frontmost, phone was at the hospital). Reuses the trusted/provisional gesture from `match_state` (ADR-024).

New capture sources become "write a small adapter that emits signals"; the timeline never changes. This is the same seam discipline as the provider interfaces.

## What Ledgr already captures (free coverage, zero new tools)

Researched 2026-07-16 against the built code. A surprising share of the day is already in the database:

- **Calendar sync (ADR-023):** every event in the rolling window is already a `meeting` item with start/end and attendees. This is the backbone — scheduled hours come for free.
- **Scheduled blocks (ADR-091):** `properties.scheduledTime` (start + duration) on tasks = *intended* work sessions. Intention vs. reality is one of the self-analysis prizes.
- **Task completions:** status transitions on tasks (native tasks, ADR-073) timestamp "what got finished today."
- **Revisions:** the debounced body snapshots are an edit-activity trace — clusters of revisions on a sermon note *are* a sermon-prep session, derivable with zero new capture.
- **Logos sync:** `logos_note` items carry created timestamps; a cluster of Logos notes on a Tuesday morning is study time, already flowing in.
- **`items.created_at`/`updated_at`:** coarse activity trace across everything else.
- **The machine capture seam (ADR-160):** `/api/machine/capture` + browser-mintable scoped tokens already exist. Every external capture tool below is "a thing that POSTs to an authenticated Ledgr endpoint," and that plumbing is built.

So the capture project is not "build a time tracker"; it's "fill the gaps the database can't see": screen time on which device doing what, driving, and off-device pastoral work.

## Capture candidates (the gap-fillers)

| Source | Covers | Mechanism | Effort/day | Notes |
|---|---|---|---|---|
| **Mac activity** | computer hours, which app/doc | [ActivityWatch](https://activitywatch.net/) (free, local, open-source) + a small uploader script that rolls up its local REST buckets daily and POSTs signals | zero | Not a code dependency — an external app feeding the endpoint. RescueTime is the paid alternative; ActivityWatch fits "boring, free." |
| **Driving** | drive time (a real block of a pastor's week) | (a) iOS Shortcuts automation on **CarPlay/Bluetooth connect/disconnect** → POST drive start/end; (b) Everlance CSV export dropped in OneDrive → nightly import | zero (a) / weekly (b) | Everlance has no public API; its value-add over (a) is mileage + purpose tagging, which matters for reimbursement, not the timeline. Lean (a); import (b) only if the mileage detail earns it. |
| **Location / visits** | hospital visits, home visits, "at the church" vs elsewhere | iOS Shortcuts **arrive/leave geofences** (church, hospital(s), home) → POST enter/exit signals | zero | This is the only automatic window into off-device pastoral work, which is exactly the work that's invisible today. Coarse by design: "at Mercy Hospital 1:10–2:35," not a location history. |
| **Phone usage** | phone-based work (email, calls, texts) | iOS Screen Time has **no export API**. Realistic options: Shortcuts app-open/close automations for 2–3 work apps (Outlook, Teams), or accept the gap | zero | iOS also exposes no call log. Don't over-engineer this: phone work is mostly email/Teams, and the M365 side (below) evidences it. |
| **Email/Teams evidence** | when correspondence happened | Graph query for sent-mail timestamps (metadata only, incremental) | zero | Cheap corroboration for "admin/comms" blocks; not a primary source. |
| **Build/system time** | Ledgr + Claude sessions | git log / session records | zero | Brandon's system-building hours are real work hours; git already timestamps them. |
| **Manual quick capture** | everything else | Siri/Shortcut "log work: 45 min counseling call" → capture endpoint; or quick-add in Ledgr; or tell Claude via MCP | seconds, on demand | The escape hatch. The system's job is to make this rare, not to eliminate it. |

**The coverage strategy:** calendar + Mac activity + drive punches + geofences gets most weekdays to near-full coverage automatically. The timeline then renders **uncaptured gaps explicitly**, so the human contribution collapses to "name the 90-minute gap on Thursday," a 10-second act at review time instead of reconstruction.

## Categorization: deterministic rules, AI on purpose

`kind` assignment is plain code (Principle 3): calendar events inherit from the matcher/template (staff meeting → meeting; "Sermon prep" block → sermon-prep), app→category map for computer signals (Logos/Word-on-sermon-doc → sermon-prep; Outlook → admin), geofence→category (hospital → pastoral-care), CarPlay → drive. Corrections are one-tap and can teach the rule (same pattern as matchers).

AI sits where it belongs, in the human-in-the-loop layer: "summarize my week for the elder board" is an MCP/Claude action that reads the week's signals and drafts the narrative + highlights. It never runs in a cron; the deterministic rollup is always available without it.

## The data model question (core, the both-agree part)

Raw signals are machine telemetry, high-volume and low-meaning (a day of app-switches could be hundreds of rows). Making each one an item would pollute the one big table with non-content — items are for things a human names and revisits. Precedent already exists for machine-side tables (`job_state`, `error_log`, `push_subscriptions`).

Proposed split:

- **`time_signals` table (new, core → ADR):** slim, owner-scoped, append-mostly: the signal shape above + `created_at`. Indexed on `(owner_id, started_at)`. Retention policy TBD (raw signals could purge after N months once rolled up; the rollup is what's kept).
- **Daily rollup → items (deterministic cron):** a nightly job distills signals into per-day summary data — the timeline's render source. Whether the rollup is (a) a `day_log` item per day (fits Principle 2, gets FTS/export/share for free, and the OneDrive markdown export makes the timeline Sunday-proof readable outside the app) or (b) just a query over `time_signals` with no materialization is an open question; (a) is the instinct because the *human-readable narrative* is content, even though the telemetry isn't.
- **Capture ingestion:** extend the machine API with `POST /api/machine/signals` (batch), same token model as ADR-160. Machine-API contract change = core.

## The timeline surface

Work surface, mobile-friendly (this is a glance-and-review thing, not a Build tool):

- **Day view:** a vertical day strip of blocks (like a calendar day, but *actual* not planned), colored by category, gaps rendered honestly as gaps with a one-tap "what was this?" fill. Click-through via `ref` to the meeting/note/task.
- **Week/month view:** category stacked bars per day + the week's completed-tasks/progress highlights. This is the skimmable "how I spend my time" answer and the self-analysis workhorse.
- **Review ritual:** a 2-minute end-of-day (or end-of-week) pass: confirm inferred blocks, fill gaps, correct categories. Confirmed vs inferred rendering reuses the provisional-until-confirmed gesture.
- **Intention overlay:** scheduled blocks (ADR-091) ghosted behind actuals — the drift view.

## Sharing with a supervisor (privacy is the constraint)

ADR-075 declined a confidential tier because nothing left the platform; **a shared timeline is the first surface where pastoral content could leak outward**, so the share must be aggregate-by-construction:

- The supervisor artifact is a **weekly report render**: hours by category, trend vs. prior weeks, selected highlights Brandon opts in ("finished the Advent series plan"). No item titles, no names, no locations in the pastoral-care category — "pastoral care: 6h" is the whole disclosure.
- Delivery reuses **share tokens (slice 31)** for a live link, and/or the export path for a PDF/docx via pandoc. No new sharing machinery.
- The self-analysis views never share; the report is a separate, deliberately lossy render. This should be structural (the report renderer only receives aggregates), not a filter that could be misconfigured.

## Constraints to honor if built

- **Deterministic by default (P3):** capture, categorization rules, and rollups are plain code; AI only drafts narratives on request.
- **Everything is an item (P2) — with eyes open:** the *human-readable* artifacts (day logs, weekly reports) are items; raw telemetry justifies a machine-side table, argued in the ADR alongside `job_state`/`error_log` precedent.
- **Boring stack (P5):** ActivityWatch and Shortcuts are external feeders, not dependencies; the in-repo surface is one table, one endpoint, one view, one cron.
- **Fast + cheap (P8):** batch signal POSTs, daily rollups on the existing cron cadence, timeline reads the rollup not the raw table.
- **Owner-scoped everything; incremental syncs only** (the Everlance/Graph imports, if built, are changed-since).
- **Multi-user-ready:** nothing about the shape is Brandon-specific; Tyler's instance just has different feeders.

## Open questions

- **Rollup materialization:** `day_log` items (FTS/export/Sunday-proof for free) vs. pure query? Leaning items.
- **Granularity floor:** what's the smallest block worth keeping — 10 min? 25? (Below some floor, fragmentation is noise.) Affects both rollup and the honesty of "fragmentation" analysis.
- **Category taxonomy:** fixed small set (8-ish) vs. owner-configurable? Fixed-first is the instinct; the report and trends need stable categories to be comparable across weeks.
- **Retention:** keep raw signals forever, or purge after rollup + N months? (Purge leans against the pack-rat instinct; the rollup is the record.)
- **Everlance:** is mileage/purpose detail wanted in Ledgr at all, or does Everlance stay the reimbursement system of record and CarPlay punches suffice for the timeline?
- **Phone-side ambition:** are Shortcuts app-open automations worth their fiddliness, or is phone time accepted as a known small gap (partially evidenced by sent-mail metadata)?
- **Does the supervisor actually want a live link,** or is a monthly PDF the real deliverable? (Determines whether the share-token render is v1 or later.)

## Suggested shape of a build (if pursued)

1. **Prove it with zero new capture:** timeline view over what the DB already holds (calendar + completions + revision clusters + Logos). If *that* isn't useful to skim, more capture won't save it.
2. **ADR for the core pieces:** `time_signals` + `POST /api/machine/signals` + the rollup/`day_log` decision (one ADR, both-agree).
3. **First two feeders:** Mac/ActivityWatch uploader + CarPlay drive punches (biggest gap-fill per unit effort).
4. **Geofences + review ritual + gap-filling UX.**
5. **Weekly report render + share** (the supervisor deliverable), then the AI narrative drafter via MCP.
