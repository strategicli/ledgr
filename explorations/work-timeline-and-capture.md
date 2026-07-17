# Exploration: work timeline + capture (know where the hours went)

**Status:** exploration, raised 2026-07-16 (Brandon). Two halves that must be designed together: (1) a **timeline** — a human-readable, skimmable account of how time was spent and what progress was made; (2) a **capture layer** that records work happening across all Brandon's tools with near-zero manual effort. **Architecture pivoted 2026-07-16 (see "Where this lives" below): the recommended build is a standalone scheduled Claude agent on Brandon's always-on PC, with Ledgr as an input stream *and* the write-back home — NOT an engine built into Ledgr core.** That pivot makes almost all of this **non-core and solo** (no new table, no machine-API surface, no ADR, no Tyler dependency); the heavier in-Ledgr sections below are kept as the alternative, deprioritized path.
**Source:** Brandon. Two audiences for the output: a supervisor ("here is what I spend my time on") and Brandon himself (strategic analysis of work habits).

## The idea

Brandon's week is only partly visible to any one system. Meetings live on the calendar, tasks in Ledgr/Todoist, sermon prep in Logos and documents, pastoral care happens in hospital rooms and driveways, and a lot of connective work happens in a car. No tool sees all of it, so today the honest answer to "where did the hours go?" requires reconstruction from memory, which means it mostly doesn't happen.

The goal is a timeline where **most hours of a workday are accounted for automatically**, gaps are visible and easy to fill, and the result reads as a narrative a human can skim — not a surveillance log. Two distinct outputs:

- **Supervisor view:** aggregated, curated, weekly-ish. "Meetings 11h, sermon prep 9h, pastoral care 6h, admin 5h, driving 4h" plus highlights of what moved forward. Never raw items (privacy, below).
- **Self-analysis view:** finer-grained. Day-by-day blocks, category trends over weeks, fragmentation (how chopped-up were the mornings?), gaps, drift between intention (scheduled blocks) and reality.

## Where this lives (Brandon, 2026-07-16) — recommended architecture

Brandon's question: *does this benefit from being built IN Ledgr, or should Ledgr just be one input stream? Could it run on a local PC that stays on all the time? It's a Brandon-only thing (maybe not even Tyler). Setting up so many always-on streams feels fragile, lengthy, and a long-term maintenance burden.* The instinct is right. **Recommendation: build it OUTSIDE Ledgr, as a standalone scheduled Claude agent on the always-on PC.** Ledgr is one input among many *and* the archive the agent writes finished summaries back into — but not the engine.

**1. The "so many streams" burden is mostly imaginary here.** The fear pictures N bespoke always-on integrations, each with its own OAuth/webhook/breakage. But the sources are largely **MCP connectors Brandon has already authorized** (M365 mail/calendar/Teams, Todoist, Ledgr, Logos, Notion). A local Claude agent on a nightly schedule just *uses those connectors*. Not building streams — pointing an agent at connectors that already exist. Long-term maintenance becomes **a prompt + a cron**, not N integrations to babysit; a broken connector is the connector's problem, not bespoke code.

**2. Building outside Ledgr erases the Tyler/core problem entirely.** If the agent writes finished day/week summaries back as **ordinary notes via the Ledgr MCP** (`create_item`, `relate_items`, `[@…](ledgr://item/…)` mentions), there is **no new table, no new API, no ADR, no core change** — it's a client creating notes, which the MCP already does. Tyler agrees to nothing, builds nothing, toggles nothing; he just never runs the local tool. This is a cleaner answer to "this is a Brandon thing" than a settings flag on shared core (the toggle question dissolves).

**3. It flips last turn's Principle-3 advice, and that's fine.** P3 ("AI never in a cron") is *Ledgr's* rule for *Ledgr's codebase*. A personal tool on Brandon's PC isn't bound by it. Outside that constraint the calculus flips to exactly the trade Brandon asked for: **pay a bit of token cost to make integration + maintenance work nearly vanish.** He named maintenance as the real worry, so paying tokens to erase it is the right call.

**4. Ledgr gives the "product" parts for free, with zero core work.** Writing back as notes means: **viewing** = a saved view over the day/week notes (Ledgr renders it); **Sunday-proof** = the existing OneDrive Markdown export already makes them readable offline; **supervisor sharing** = the existing share-token render / pandoc PDF. The fancy day-strip/week-pivot UI (mockup) becomes a *nice-later, solo, non-core* addition, not a prerequisite. Because the write-back goes through MCP, the agent still creates **real relations to project/campus items**, so the facet-as-relation model (below) survives intact.

**5. The bonus only this placement unlocks: local machine activity.** No cloud connector can see which app/document was open, but a local agent on the PC can read **git logs, the filesystem, and ActivityWatch's local API** directly. The always-on PC isn't just convenient — it's the only place that can close the "computer work" gap at all.

**Billing (verified 2026-07-16):** run it as a **Claude Desktop scheduled task** (Routines → New routine → Local) on the always-on PC and it draws from Brandon's **subscription usage pool — no separate per-token charge.** The catch is exactly what Brandon already planned for: the app must be open and the machine awake, which an always-on PC satisfies. (The alternative, Claude Code **Cloud Routines**, runs even with the machine off but draws a fixed monthly Agent-SDK credit and then meters overage per-token — so the Desktop-task route Brandon had in mind is the genuinely cheaper one. API-key auth is pure per-token and not what to use here.) The only real cost is that a heavy nightly run competes with interactive subscription usage; a once-nightly summarization is small.

**Other honest trade-offs:** fuzzier than deterministic sync (fine for a skimmable, morning-reviewed timeline — not accounting); the PC must stay on (Brandon proposed exactly that); keep the **morning-confirm** step so nothing untrusted lands in Ledgr.

**What this does to the rest of this doc:** the signal-shape contract, facet model, and UI/UX sketches all still apply — but they describe *the agent's* internal data and *notes it writes*, not new Ledgr core. The **`time_signals` table + `POST /api/machine/signals`** sections become the **heavier in-Ledgr alternative**, only worth it if this graduates from "Brandon's private tool" to "a feature multiple users want." Start standalone; promote into core later if and only if it earns it (the catch-all → bespoke promotion pattern, Principle 6).

## The timeline VIEW — a generic layout, and the part that IS worth building in Ledgr (Brandon, 2026-07-16)

Brandon's second question: *a new "type" in Ledgr to view things in a timeline based on MD — maybe a plugin — could be useful for other users.* Two clarifications, and then a clean split from the agent above.

**It's a view *layout*, not an item *type*.** In Ledgr, item types (note, meeting, task, day_log) are *what a thing is*; **views** are *how a set of items is rendered*, and the shared `ViewRenderer` (ADR-029) already switches across **five layouts — list, table, board, agenda, calendar** — over the same row set, positioning rows by a date property, with a `display` jsonb for per-layout config (ADR-131). A **timeline is the natural sixth layout**: items laid out chronologically (a past-facing narrative), the read-only cousin of the interactive `calendar`/Planner time-grid. So the ask isn't a new type — it's `case "timeline"` in `ViewRenderer` + a layout function, reusing the `display` jsonb the calendar layout already established.

**"Based on MD" fits cleanly:** each entry is an item; its markdown body supplies the content. Keep to the list-query perf rule (no `body` in list queries) — the timeline shows title + date + facet chips + a short metadata line, and the body loads on open, exactly like every other layout. A day_log note the agent writes renders as one entry; so does a meeting, a sermon, a completed task.

**No external plugin or library.** A vertical timeline is essentially CSS — the day-strip in the mockup for this exploration renders with zero dependencies, which is the Principle-5 answer (don't add vis-timeline / react-chrono / TimelineJS for what CSS does). Ledgr's own **module system** is its "plugin" mechanism, but a timeline is as generic as the existing five layouts, so it belongs *alongside* them in the shared renderer, not bolted on as a module.

**This is the genuinely core-worthy, everyone-benefits piece — the clean inverse of the agent.** The capture agent is Brandon-only and lives *outside* Ledgr; the timeline layout is generic and lives *inside* Ledgr, useful for anything date-stamped: a sermon series over the year, a project's history, a person's interaction log, a discipleship journey — not just the work timeline. Tyler plausibly wants it. So its status differs: adding a `layout` enum value + touching the shared `ViewRenderer`/`display` shape is a **small view-engine touch that wants a heads-up + likely a light ADR** (the Planner's `display` jsonb was the one core ADR in that neighborhood), then the layout UI itself is solo. Much lighter than a data-model change, and it's the one part of this whole exploration worth building in core regardless of whether the capture agent ever ships.

**How the two halves meet:** the agent writes day_log / weekly-summary notes into Ledgr → a saved view with the **timeline layout** renders them → export makes them Sunday-proof → a share token gives the supervisor the aggregate. Each half is independently useful: the timeline layout is worth building even if capture stays manual, and the agent is worth running even if the timeline renders as a plain list first.

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

So the capture project is not "build a time tracker"; it's "fill the gaps the database can't see": computer work, driving, and off-device pastoral work.

## Platform reality (Brandon, 2026-07-16): PC + Mac + Android

Correcting the earlier draft's Apple assumptions. Brandon works across **both a PC and a Mac**, and carries an **Android phone, not an iPhone**. This kills the iOS-specific plans (Shortcuts, CarPlay automations, `chat.db`, Continuity call history) but actually simplifies things:

- **Cross-machine, not Mac-only:** the desktop feeder must run on Windows and macOS. [ActivityWatch](https://activitywatch.net/) is cross-platform (Windows/Mac/Linux, free, open-source), so **one** tool covers both; each install just posts to the same endpoint.
- **Android is more open than iOS:** it exposes call logs and app-usage to apps, and **Tasker** is the Android analog of Shortcuts (Bluetooth/geofence/app triggers → HTTP POST). So the phone lane still exists, just via Tasker.
- **Google Voice texts arrive as email** — Brandon's SMS runs through Google Voice, which emails a notification per message/thread. That means texts are captured by *reading mail*, not by touching the phone at all. A deterministic parser on those notification emails yields when + volume. (This is why the phone lane is now optional, below.)

## The nightly "gather" (Brandon's idea) — reframed to honor Principle 3

Brandon: *use Claude (Sonnet) to run a nightly gather that polls all the key places — mail, meetings, Teams, phone, drive, texts (Google Voice via email).* This is the right instinct and mostly collapses the earlier "three lanes" into one scheduled job. **But a Claude-in-a-cron directly contradicts Principle 3** ("AI … never in a cron job"; "metadata extraction and sync" are named as model-free plumbing), so the design has to split the gather into its deterministic and its AI halves:

- **The polling + parsing is deterministic plumbing, and needs no model.** Calendar/Teams/mail are clean Graph APIs (this is just *more sync*, the pattern already built). Google Voice and Everlance send structured notification/report emails a plain parser handles. So the "poll everywhere" step is a nightly deterministic sync that writes `time_signals` — cheap, testable, no tokens, P3-clean. Calling it "Claude" oversells what it needs to be.
- **AI earns its place on top, on the ambiguous parts only:** stitching a cluster of raw signals into "this 2-hour block was sermon prep," suggesting facets for blocks the rules couldn't classify, and **drafting the human narrative**. That is genuine judgment, which is where "AI on purpose" belongs.
- **The P3-clean way to make it feel automatic:** the deterministic sync runs nightly and assembles tomorrow's timeline; the AI interpretation is **produced as provisional/suggested output that Brandon confirms in the morning review** (or on a "draft my summary" tap). The human-in-the-loop is the morning confirm, so AI never *commits* anything unreviewed — exactly the `suggested`/`confirmed` gesture (ADR-024) the rest of the design already leans on.
- **If Brandon genuinely wants an autonomous nightly Claude run** (narrative written while he sleeps, no morning tap), that's a real, coherent choice — but it's a **change to Principle 3** and therefore both-agree + ADR with Tyler. A tightly scoped carve-out would read: *"AI may run in a cron only to produce provisional output that stays untrusted until a human confirms."* Recommend the confirm-in-the-morning version first (less code, no token spend on nights nothing happened, no principle amendment); escalate to the carve-out only if the morning tap proves annoying.

## Capture candidates (the gap-fillers)

| Source | Covers | Mechanism | Lane | Notes |
|---|---|---|---|---|
| **Calendar / meetings** | scheduled hours | Graph delta sync (built, ADR-023) | gather | The backbone; already flowing. |
| **Teams calls** | call time, participants | Graph `callRecords` (`CallRecords.Read.All`, admin consent) — webhook *or* nightly pull | gather | Push webhook is nicer; a nightly pull is simpler and fine for a next-morning timeline. |
| **Email** | comms/admin time | Graph sent/received metadata, incremental (no bodies) | gather | Primary evidence for "admin/comms" blocks. |
| **Texts (Google Voice)** | messaging bursts | parse Google Voice notification emails (when + volume) | gather | Rides the mail lane — no phone needed. Metadata only (sensitivity below). |
| **Driving** | drive time | parse **Everlance** report emails (start/end/duration/mileage) | gather | Everlance stays the mileage system of record; Ledgr reads its emails. No phone automation, Android-friendly. Tasker Bluetooth-trigger is the optional real-time upgrade. |
| **Computer work** | which app/doc, how long | [ActivityWatch](https://activitywatch.net/) on **both PC and Mac** → small uploader POSTs daily rollups | agent | One cross-platform tool; each machine posts. Optional — a lot of computer work is already inferable from mail + revisions + git (see below). |
| **Location / visits** | hospital/home visits, campus presence | **Tasker** geofences (church/hospital/home) → POST enter/exit | phone (Tasker) | The only automatic window into off-device pastoral work. Coarse by design. Optional; the gap-acceptance below covers its absence. |
| **Android call/app usage** | phone-based work | Tasker call-log + foreground-app → POST | phone (Tasker) | Android *does* allow this (unlike iOS). Lowest priority; Google Voice + Teams already cover most. |
| **Build/system time** | Ledgr + Claude sessions | `git log` across repos → signals | agent | Real work hours; git already timestamps them. Can ride the ActivityWatch uploader or the gather if repos are reachable. |
| **Manual quick capture** | everything else | quick-add in Ledgr, or tell Claude via MCP, or a Tasker "log work: 45 min" shortcut | manual | The escape hatch. Make it rare, not zero. |

**Three lanes, collapsed:** (1) **the nightly gather** — one deterministic job pulling every cloud/email source (calendar, Teams, mail, Google Voice texts, Everlance drives); (2) **the desktop agent** — ActivityWatch/git on PC + Mac, generalizing the pattern that already runs in `~/code/logos-sync` (a tiny zero-dep local runner that reads a local source and posts to Ledgr); (3) **the phone** — optional Tasker triggers for visits/drives. All three POST the same signal shape to `POST /api/machine/signals`, using the tokens ADR-160 already mints.

**Coverage + the gaps Brandon accepts:** the gather alone (calendar + Teams + mail + texts + drives) gets most of a weekday to near-full coverage with **nothing installed anywhere**. The desktop agent adds computer-work resolution. Brandon's own read: *the rest is impromptu hallway conversations and the like* — and that's the right posture. The system's job is not 100% capture; it's to make the **remaining gaps small, visible, and one-tap to name** at review time. Hallway conversations, drop-in questions, and thinking-in-the-car are exactly what the honest "what was this?" gap slot is for.

**Sensitivity note for texts/calls:** pastoral texts and calls are the most confidential data in the whole system. Default capture is **when + duration only** — enough for the timeline block ("calls & texts, 40 min, evening") — with counterparty capture off by default and opt-in per the review ritual ("this call was the Hendersons" is a manual enrichment, never automatic). Because Google Voice emails include the sender, the **parser must discard the counterparty by default**, not merely decline to display it — keeping the ADR-075 posture that the sensitive fact never enters the database.

## Categorization: deterministic rules, AI on purpose

`kind` assignment is plain code (Principle 3): calendar events inherit from the matcher/template (staff meeting → meeting; "Sermon prep" block → sermon-prep), app→category map for computer signals (Logos/Word-on-sermon-doc → sermon-prep; Outlook → admin), geofence→category (hospital → pastoral-care), Everlance/Tasker drive event → drive. Corrections are one-tap and can teach the rule (same pattern as matchers).

AI sits where it belongs, in the human-in-the-loop layer: "summarize my week for the elder board" is an MCP/Claude action that reads the week's signals and drafts the narrative + highlights. Per the gather reframe above, the nightly interpretation is produced as *provisional* suggestions confirmed in the morning review; the deterministic rollup is always available without any model.

## The data model question (the HEAVIER in-Ledgr alternative — deprioritized)

> Applies only if this graduates from the standalone-agent design above into a first-class Ledgr feature. In the recommended build, raw signals live in the agent's own local store (a SQLite file on the PC) and only the finished day/week *notes* land in Ledgr — so none of the below is needed to start.

Raw signals are machine telemetry, high-volume and low-meaning (a day of app-switches could be hundreds of rows). Making each one an item would pollute the one big table with non-content — items are for things a human names and revisits. Precedent already exists for machine-side tables (`job_state`, `error_log`, `push_subscriptions`).

Proposed split:

- **`time_signals` table (new, core → ADR):** slim, owner-scoped, append-mostly: the signal shape above + `created_at`. Indexed on `(owner_id, started_at)`. Retention policy TBD (raw signals could purge after N months once rolled up; the rollup is what's kept).
- **Nightly gather (the deterministic half):** a scheduled job that (i) pulls the cloud/email sources into `time_signals` and (ii) distills the day's signals into per-day summary data — the timeline's render source. This is plain code; the AI narrative/facet-suggestion layer sits on top of it as provisional output (see the gather reframe). Whether the rollup materializes as (a) a `day_log` item per day (fits Principle 2, gets FTS/export/share for free, and the OneDrive markdown export makes the timeline Sunday-proof readable outside the app) or (b) just a query over `time_signals` with no materialization is an open question; (a) is the instinct because the *human-readable narrative* is content, even though the telemetry isn't.
- **Capture ingestion:** extend the machine API with `POST /api/machine/signals` (batch), same token model as ADR-160. Machine-API contract change = core.

## Facets: every hour has four answers (Brandon, 2026-07-16)

One block of time answers four different questions, and Brandon named them. These are **orthogonal facets, not one tag soup**:

| Facet | Question | Examples | Where it comes from |
|---|---|---|---|
| **Activity** | *how* was the time spent | email, meeting, call, texting, driving, writing, deep work | = the signal's `kind`; deterministic from the source (calendar → meeting, Everlance → driving, Outlook frontmost → email). Fixed small vocabulary. |
| **Project** | *what* was being advanced | hiring, building Ledgr, Advent series, capital campaign | a **relation to a real project item** (`explorations/project-items.md`), not a string tag |
| **Campus** | *where/for whom* organizationally | WPN, BVD, all-church | a **relation to a campus entity item**; Tasker geofences map to campuses when present |
| **Job category** | *which part of the role* | staff leadership, strategic planning, preaching, pastoral care, admin | small owner-defined taxonomy — this is the supervisor's language and the lens the report renders in |

The model falls out of what's already built: **activity lives on the signal; the other three are relations on the distilled block** (the rollup artifact), through the existing `relations` system — so "everything related to the hiring project" naturally includes time blocks alongside notes and tasks, with no new tagging machinery. Job category is the one genuinely new vocabulary, and it should be a *small, stable* list because week-over-week comparability is what makes the supervisor report meaningful.

**Auto-association is deterministic rules, corrections teach (the matcher pattern, ADR-024):** a calendar event matched to the hiring template → project=hiring, category=staff-leadership; a Tasker geofence at BVD → campus=BVD; ActivityWatch says Word on `advent-week-2.docx` → project=Advent series, category=preaching; the weekly staff meeting inherits from its template. When Brandon corrects a block's facet, offer "always file this like that" — the same suggested/confirmed gesture the calendar matcher uses. AI never assigns facets in the background; at most, "help me facet this week" is an on-demand MCP action whose output is suggestions to confirm.

## UI/UX: what the data looks like

Work surface, mobile-friendly (this is a glance-and-review thing, not a Build tool). Three renders of the same data, in increasing distance from the raw hours:

**1. Day view (Brandon, daily/reviewing).** A vertical day strip like a calendar day, but *actual* rather than planned: blocks colored by **activity**, with tiny facet chips (project/campus) on blocks that have them. Gaps render honestly as hatched "unaccounted" slots with a one-tap "what was this?" fill. Inferred blocks render provisional (dashed) until confirmed — same trust gesture as calendar matches. Scheduled blocks (ADR-091) ghost behind actuals as the intention-vs-reality overlay.

**2. Drill-in (click any block).** A block opens a detail panel (the existing item-modal gesture): the **evidence** (the raw signals that composed it: "Everlance drive 8:12–8:41", "Word on advent-week-2.docx, 94 min", the Graph call record), the **linked artifact** via `ref` (the meeting item with its notes, the task completed, the note edited — one click from "what was this hour" to the actual work product), and the **four facet chips, editable in place**, with corrections offering to become rules. If the rollup materializes as `day_log` items, the drill-in is just… opening an item, with everything items already do.

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
- **Boring stack (P5):** ActivityWatch and Tasker are external feeders, not dependencies; the in-repo surface is one table, one endpoint, one view, one gather cron.
- **Fast + cheap (P8):** batch signal POSTs, daily rollups on the existing cron cadence, timeline reads the rollup not the raw table.
- **Owner-scoped everything; incremental syncs only** (the Everlance/Graph imports, if built, are changed-since).
- **Multi-user-ready:** nothing about the shape is Brandon-specific; Tyler's instance just has different feeders.

## Open questions

- **Rollup materialization:** `day_log` items (FTS/export/Sunday-proof for free) vs. pure query? Leaning items.
- **Granularity floor:** what's the smallest block worth keeping — 10 min? 25? (Below some floor, fragmentation is noise.) Affects both rollup and the honesty of "fragmentation" analysis.
- **Category taxonomy:** the activity vocabulary is fixed-small; the **job-category** list is owner-defined but should be stable — who arbitrates changes to it mid-year, since renaming breaks week-over-week trend comparability? (Probably: additive only, merge on report render.)
- **Campus/project as items:** campuses presumably already exist as entities; project blocks depend on `explorations/project-items.md` landing. Does the facet model wait for it, or start with campus + category only?
- **Principle 3 decision (the big one):** confirm-in-the-morning provisional AI (no P3 change, recommended) vs. an autonomous nightly Claude run (a scoped P3 amendment = both-agree + ADR with Tyler)? Everything about the gather's shape waits on this.
- **Which mailbox catches Google Voice + Everlance emails** — the M365 inbox the gather can already read via Graph, or a Gmail account that needs its own read path? (If Gmail, that's a second mail source, cheap but worth naming.)
- **Retention:** keep raw signals forever, or purge after rollup + N months? (Purge leans against the pack-rat instinct; the rollup is the record.)
- **Everlance:** parse its report emails for the timeline, or is drive time close enough to infer from calendar (offsite meeting ⇒ a drive on either side)? The email parser is cheap; the infer-from-calendar path is cheaper and needs no Everlance at all.
- **Desktop agent — is it worth it, or is computer work inferable?** A lot of Brandon's screen time is already visible (mail via Graph, sermon writing via document/revision clusters, Ledgr building via git). Start without ActivityWatch and see if the inferred resolution is good enough before installing anything on two machines.
- **Does the supervisor actually want a live link,** or is a monthly PDF the real deliverable? (Determines whether the share-token render is v1 or later.)

## Suggested shape of a build (standalone-agent path, recommended)

1. **Smallest real test — a scheduled Claude agent that reads and writes back.** On the always-on PC: a nightly Claude Code / Agent SDK run that reads yesterday via the *already-authorized* connectors (M365 calendar + mail + Teams, Todoist, Ledgr's own activity, Logos) and writes **one `day_log` note back into Ledgr via MCP**, with @-mention relations to any project/campus items it recognizes. No table, no endpoint, no ADR. If that one note isn't useful to skim, nothing heavier will be.
2. **Add the local-only sources the connectors can't see:** git across repos, and (if resolution is short) ActivityWatch's local API — read directly by the same local agent.
3. **Weekly rollup note + the supervisor render** (share-token page or pandoc PDF over the week's notes — both already exist in Ledgr).
4. **Morning-confirm loop:** the agent writes provisional; a light review marks it confirmed. Keep raw signals in the agent's local SQLite; only summaries sync.
5. **Google Voice texts + Everlance drives** via whichever mailbox catches them (open question), parsed by the agent.
6. **Optional Tasker phone triggers** (visits/drives) — last, only if the gaps bother him.
7. **Promote into Ledgr core only if it earns it** — if the timeline becomes something multiple users want, *then* do the `time_signals` + machine-API ADR (the heavier alternative above). Not before.
