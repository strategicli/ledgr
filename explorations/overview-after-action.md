# Exploration: Overview as a living after-action report

**Status:** design converged with Tyler (2026-07-01), not yet built. Parts are **core** (milestone model change, MCP contract additions) → need a joint ADR + Brandon before merge; the rest is non-core and shippable now. Supersedes the thin "Overview = the body" framing; builds on PJ1 (activity log), PJ7 (digest), PJ8 (Head/Story weave). See [[project-type-widget-model]], [[deploy-and-shared-main]].

## The idea

The Overview on a project (widget-home) record isn't just the body prose. It's a **living after-action report that accrues while the project runs**: what got done, what meetings happened and how they went, chapter by chapter. Two zones:

- **Top — the human report (Head).** A readable, broad-brush "where this stands / what happened" a person actually wants to read. AI-written (see below), or a deterministic digest as an interim.
- **Bottom — the detailed record.** Everything that happened and when, captured programmatically, so the top can be regenerated at any time and so a human can drill in.

The guiding split: **deterministic code captures the substrate; AI narrates it.** Ledgr never summarizes prose itself and never embeds a model.

## The deterministic substrate (no AI, shippable now)

1. **The activity log already exists** (`activity_events`, PJ1): `task_completed`, `task_added`, `note_added`, `milestone_added`, `status_changed`, `record_created`, `record_related`, each time-stamped with a `payload` jsonb. That IS the bottom zone. Render it as a chronological, period-grouped timeline in the Overview.
2. **Enrich the payloads** so the eventual report has specifics, not counts: task title, meeting title + date, status `from → to`, and a **"minutes recorded on X"** event when a transcript/notes land (so "how did the meeting go" has a pointer).
3. **Handles, not summaries** (the answer to "how do we show what a note said without dumping it"): deterministic code can't understand prose, so surface what the human already marked —
   - **first heading / first non-empty line** of a note/transcript as a one-line teaser (markdown-native, `markdown-it` already in the stack — Principle 5);
   - a **designated section only** (`## Recap`, `## Decisions`, `TL;DR:`) pulled verbatim;
   - **a one-line `recap` field** (`properties.recap`, a single input, not a body) the user fills when it's fresh: "Aligned on Q3 timeline, Sarah owns hiring." This is the highest-leverage, lowest-effort add — structured, deterministic, the human's own words, and premium input for the AI later.
4. **Interim deterministic top:** reuse `composeDigest()` (PJ7) to render a "this period" rollup (done / stale / upcoming) as a readable header before/without AI. Degrades gracefully into the AI version.

## The AI narrative (cron OK, on the subscription, never an API — Tyler, 2026-07-01)

Tyler is fine with AI on a schedule, but it must use **his paid Claude subscription, not a metered API key**. So the schedule and the model live **on the Claude side**; Ledgr only exposes the work over MCP and never holds a key or a model.

- **Cloud (today):** a **Claude-side scheduled automation** (claude.ai / Claude Desktop scheduled task) connects to Ledgr's MCP connector (the ADR-117 OAuth shim already makes Ledgr connectable) and drains the "awaiting summary" queue on a cadence. Subscription-authed, zero credentials in Ledgr.
- **Local (Phase 4):** a local cron runs Claude Code headless on the machine already logged into the subscription — trivial there.
- **Avoid:** GitHub Actions running Claude Code headless needs the subscription token in CI (fussy, possibly against ToS).
- **Ledgr's seam:** an MCP tool that lists pending work (transcripts awaiting minutes, chapters awaiting weave) + the existing `proposeStoryUpdate`/`weaveStory` write-back (PJ8). Additive to the machine/MCP contract, same discipline as ADR-102 (safety in the `parse*` validators). **CORE → ADR.**

## "I'll forget to summarize" — the un-forgettable queue (no AI to nudge)

Separate capture from narration so forgetting is impossible without putting AI in the loop:

- Pasting a transcript flags the meeting **"awaiting summary."** The **"Transcripts awaiting minutes" view** exists (ADR-087); Brandon's **Notification Center** (ADR-129) gives a bell + badge. The nudge is 100% deterministic.
- The AI act is then either a **"Summarize now" button** (covers summarizing ahead of time) or the **scheduled drain** above. You can't forget because Ledgr reminds you; the model only runs on purpose or on your chosen cadence.

## Milestones: dated deadlines AND stampable — both (Tyler, 2026-07-01)

Today a milestone has no real completion signal: `milestonePoints()` treats it "reached" only when its **date has passed**, so an **undated** milestone can never count, and a dated one auto-"completes" when the date passes whether or not the work happened. Tyler wants **both** kinds:

- **Date is optional** and means a **hard deadline / target** when present.
- **Completion is a manual stamp** (`reached_at` timestamp, or a done toggle), not the calendar.
- A dated-but-unstamped milestone past its date shows as **overdue** (honest), not silently complete.
- Progress/timeline read the **stamp**.
- **A stamp doubles as a chapter boundary** for the after-action weave: stamping "Phase 1 complete" queues (or you tap) Claude to narrate everything since the last stamp into the Story.

`milestone` is a shared **system type**, so this is **CORE → joint ADR with Brandon** before merge. Additive and small, but on the frozen list.

## The loop it all creates

1. Paste transcripts as you go → queued, badged, un-forgettable.
2. Activity log accrues deterministically underneath; recap fields + first-lines give cheap handles.
3. Stamp a milestone when a chapter closes → that boundary queues/triggers the chapter summary; Claude writes it (on your subscription) from the activity + notes since the last stamp.

Milestones become the table of contents for the project's story.

## Slices

**Shippable now (non-core):**
- One-line `recap` field on meetings/notes + deterministic render in the Overview.
- Activity-log timeline as the Overview's bottom zone (period-grouped) + richer payloads + a "minutes recorded" event.
- Deterministic digest header (interim top) via `composeDigest`.
- "Awaiting summary" flag + surfacing (view + Notification Center badge).

**Core / needs ADR + Brandon:**
- Milestone model: optional date (deadline) + manual stamp (completion); progress reads the stamp; stamp = chapter boundary.
- MCP tool to list pending summary work + the scheduled-Claude drain (reconcile with ADR-052 scheduled Claude tasks).

## Open questions

- Chapter weave granularity: activity since last stamp, or a fixed window? (Lean: since last stamp, falling back to a window if no milestones.)
- Where the recap field lives in the UI (meeting canvas Notes/Prep card? a field on the item?).
- Does the deterministic digest header stay once the AI Head exists, or collapse into it?
