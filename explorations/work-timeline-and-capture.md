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
| **Teams calls** | call time, participants | Graph `callRecords` webhook (admin-consent app permission) | zero | Push-based: the call ends, Graph notifies Ledgr. See "three lanes" below. |
| **Texts (iMessage/SMS)** | messaging bursts | Mac agent reads `chat.db` metadata (when/volume only) | zero | Metadata only by default — see the sensitivity note below. |
| **Cellular calls** | real phone-call time | Mac agent reads the Continuity call-history store | zero | The one path to iPhone call logs; needs a verification spike. |
| **Build/system time** | Ledgr + Claude sessions | git log / session records | zero | Brandon's system-building hours are real work hours; git already timestamps them. |
| **Manual quick capture** | everything else | Siri/Shortcut "log work: 45 min counseling call" → capture endpoint; or quick-add in Ledgr; or tell Claude via MCP | seconds, on demand | The escape hatch. The system's job is to make this rare, not to eliminate it. |

**The coverage strategy:** calendar + Mac activity + drive punches + geofences gets most weekdays to near-full coverage automatically. The timeline then renders **uncaptured gaps explicitly**, so the human contribution collapses to "name the 90-minute gap on Thursday," a 10-second act at review time instead of reconstruction.

## Getting the data in: three lanes, no export/import (Brandon, 2026-07-16)

The standing requirement: **data flows continuously to where it belongs; no manual export/import cycles.** Every source lands in one of three lanes, all of which already have working precedent in this system:

1. **Cloud pull (Ledgr-side, Graph):** things Microsoft already knows. Calendar/appointments (built, ADR-023, delta sync), sent/received mail metadata (same delta discipline), and **Teams calls via the Graph `callRecords` API** — an application permission (`CallRecords.Read.All`, admin consent, which Brandon can grant) with **webhook subscriptions**, so a finished Teams call pushes its start/end/participants to Ledgr on its own. No polling, no export.
2. **Phone push (Shortcuts → the machine API):** things only the phone witnesses. CarPlay/Bluetooth connect/disconnect (drives), arrive/leave geofences (visits, campus presence). A Shortcut is just an authenticated `POST` to the signals endpoint — the token minting for exactly this kind of client shipped in ADR-160. Fire-and-forget, zero taps.
3. **Home-base agent push (a self-run Mac collector):** things only Brandon's Mac can see. **The pattern already exists and runs: `~/code/logos-sync`** — a small local runner, zero deps, that reads a local app database and posts to Ledgr. This exploration generalizes that into one collector agent (launchd, runs every N minutes) with small readers per source:
   - **ActivityWatch** local REST → app/document time buckets.
   - **iMessage/SMS metadata** from the Mac's Messages store (`chat.db`) — when/duration-of-thread only (sensitivity below).
   - **Cellular call history** — with Continuity, iPhone call logs sync into the Mac's CallHistory store; a reader gets when/duration for real phone calls, the thing iOS itself will never expose. (Worth a verification spike; if it holds, it closes the biggest "phone work" gap.)
   - **git activity** across `~/code` for build time.

   One agent, many readers, one batched `POST /api/machine/signals` — not N cron jobs. It's the "self-run app" Brandon named, and it stays a feeder (no Ledgr code depends on it existing; a day without the Mac online is just a day with more gaps).

**Sensitivity note for texts/calls:** pastoral texts and calls are the most confidential data in the whole system. Default capture is **when + duration only** — enough for the timeline block ("calls/texts, 40 min, evening") — with counterparty capture off by default and opt-in per the review ritual ("this call was the Hendersons" is a manual enrichment, never automatic). This keeps the ADR-075 posture intact: the sensitive fact never enters the database, rather than entering and being filtered.

## Categorization: deterministic rules, AI on purpose

`kind` assignment is plain code (Principle 3): calendar events inherit from the matcher/template (staff meeting → meeting; "Sermon prep" block → sermon-prep), app→category map for computer signals (Logos/Word-on-sermon-doc → sermon-prep; Outlook → admin), geofence→category (hospital → pastoral-care), CarPlay → drive. Corrections are one-tap and can teach the rule (same pattern as matchers).

AI sits where it belongs, in the human-in-the-loop layer: "summarize my week for the elder board" is an MCP/Claude action that reads the week's signals and drafts the narrative + highlights. It never runs in a cron; the deterministic rollup is always available without it.

## The data model question (core, the both-agree part)

Raw signals are machine telemetry, high-volume and low-meaning (a day of app-switches could be hundreds of rows). Making each one an item would pollute the one big table with non-content — items are for things a human names and revisits. Precedent already exists for machine-side tables (`job_state`, `error_log`, `push_subscriptions`).

Proposed split:

- **`time_signals` table (new, core → ADR):** slim, owner-scoped, append-mostly: the signal shape above + `created_at`. Indexed on `(owner_id, started_at)`. Retention policy TBD (raw signals could purge after N months once rolled up; the rollup is what's kept).
- **Daily rollup → items (deterministic cron):** a nightly job distills signals into per-day summary data — the timeline's render source. Whether the rollup is (a) a `day_log` item per day (fits Principle 2, gets FTS/export/share for free, and the OneDrive markdown export makes the timeline Sunday-proof readable outside the app) or (b) just a query over `time_signals` with no materialization is an open question; (a) is the instinct because the *human-readable narrative* is content, even though the telemetry isn't.
- **Capture ingestion:** extend the machine API with `POST /api/machine/signals` (batch), same token model as ADR-160. Machine-API contract change = core.

## Facets: every hour has four answers (Brandon, 2026-07-16)

One block of time answers four different questions, and Brandon named them. These are **orthogonal facets, not one tag soup**:

| Facet | Question | Examples | Where it comes from |
|---|---|---|---|
| **Activity** | *how* was the time spent | email, meeting, call, texting, driving, writing, deep work | = the signal's `kind`; deterministic from the source (calendar → meeting, CarPlay → driving, Outlook frontmost → email). Fixed small vocabulary. |
| **Project** | *what* was being advanced | hiring, building Ledgr, Advent series, capital campaign | a **relation to a real project item** (`explorations/project-items.md`), not a string tag |
| **Campus** | *where/for whom* organizationally | WPN, BVD, all-church | a **relation to a campus entity item**; geofences map to campuses for free |
| **Job category** | *which part of the role* | staff leadership, strategic planning, preaching, pastoral care, admin | small owner-defined taxonomy — this is the supervisor's language and the lens the report renders in |

The model falls out of what's already built: **activity lives on the signal; the other three are relations on the distilled block** (the rollup artifact), through the existing `relations` system — so "everything related to the hiring project" naturally includes time blocks alongside notes and tasks, with no new tagging machinery. Job category is the one genuinely new vocabulary, and it should be a *small, stable* list because week-over-week comparability is what makes the supervisor report meaningful.

**Auto-association is deterministic rules, corrections teach (the matcher pattern, ADR-024):** a calendar event matched to the hiring template → project=hiring, category=staff-leadership; a geofence at BVD → campus=BVD; ActivityWatch says Word on `advent-week-2.docx` → project=Advent series, category=preaching; the weekly staff meeting inherits from its template. When Brandon corrects a block's facet, offer "always file this like that" — the same suggested/confirmed gesture the calendar matcher uses. AI never assigns facets in the background; at most, "help me facet this week" is an on-demand MCP action whose output is suggestions to confirm.

## UI/UX: what the data looks like

Work surface, mobile-friendly (this is a glance-and-review thing, not a Build tool). Three renders of the same data, in increasing distance from the raw hours:

**1. Day view (Brandon, daily/reviewing).** A vertical day strip like a calendar day, but *actual* rather than planned: blocks colored by **activity**, with tiny facet chips (project/campus) on blocks that have them. Gaps render honestly as hatched "unaccounted" slots with a one-tap "what was this?" fill. Inferred blocks render provisional (dashed) until confirmed — same trust gesture as calendar matches. Scheduled blocks (ADR-091) ghost behind actuals as the intention-vs-reality overlay.

**2. Drill-in (click any block).** A block opens a detail panel (the existing item-modal gesture): the **evidence** (the raw signals that composed it: "CarPlay 8:12–8:41", "Word on advent-week-2.docx, 94 min", the Graph call record), the **linked artifact** via `ref` (the meeting item with its notes, the task completed, the note edited — one click from "what was this hour" to the actual work product), and the **four facet chips, editable in place**, with corrections offering to become rules. If the rollup materializes as `day_log` items, the drill-in is just… opening an item, with everything items already do.

**3. Week/month view (Brandon, strategic).** Stacked bars per day, and — the payoff of orthogonal facets — a **pivot control: view the same week by activity, by project, by campus, or by job category.** "How much of me did BVD get this month?" and "how fragmented are my mornings?" and "preaching hours trend across the fall" are the same query with a different group-by. Plus the week's completed-tasks/progress highlights and a fragmentation read (block count vs. hours).

**4. Supervisor report (weekly/monthly).** Rendered in the **job-category lens** (their language, not app names): hours by category with trend vs. prior weeks, a campus split line, and opt-in highlights. Aggregate-by-construction — no item titles, no names, no drill-in. Delivered as a share-token page or a pandoc PDF. The self-views and the report are different renderers over the same rollup, and only the report renderer is shareable.

**Review ritual:** a 2-minute end-of-day (or end-of-week) pass: confirm inferred blocks, fill gaps, correct facets. The system's success metric is this staying under 2 minutes.

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
- **Category taxonomy:** the activity vocabulary is fixed-small; the **job-category** list is owner-defined but should be stable — who arbitrates changes to it mid-year, since renaming breaks week-over-week trend comparability? (Probably: additive only, merge on report render.)
- **Campus/project as items:** campuses presumably already exist as entities; project blocks depend on `explorations/project-items.md` landing. Does the facet model wait for it, or start with campus + category only?
- **Mac-agent verification spikes:** does Continuity call history actually sync and stay readable on Brandon's Mac? Does `chat.db` access survive macOS privacy prompts under launchd? (Both are cheap afternoon tests before anything is designed around them.)
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
