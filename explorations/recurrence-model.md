# Exploration: the recurrence model for native tasks

**Status:** open, brainstorm for the Native Tasks chunk (**T1**, ADR-073). **Core-ish** — it shapes the task data model and the native `tasks` engine, so the chosen model lands in an ADR (both-agree with Tyler) before T1 builds. Pairs with `tasks-todoist-vs-native.md` (the decision to go native, which un-defers recurrence from Todoist) and `calendar-time-blocking.md` (the `scheduled`-vs-`due` question and the calendar surface).
**Source:** Brandon, 2026-06-17, pointing at the Obsidian **TaskNotes** plugin's recurring-tasks design as a reference (https://tasknotes.dev/features/recurring-tasks/).

**Leaning so far (Brandon, 2026-06-17; the core bits still get Tyler's ratify per ADR-073):** model **(C)** the per-date completion log; **add a first-class `scheduled` date** separate from `due`; and **support an opt-in per-task "separate note per occurrence" mode** (the materialized mode below) so recurring things that need distinct, non-overwriting notes per instance keep them.

## The question

Going native (ADR-073) means Ledgr owns recurrence, which Todoist owned entirely before (ADR-026 deferred per-occurrence logic to it). The model we pick drives everything downstream: how completion behaves, what shows up on Today and in the focus layer (T3), what the ICS feed emits (T4), and whether missed work piles up. Brandon's specific questions:

- Does checking a recurring task off **trigger the next one**?
- Can you **schedule a future occurrence**?
- What about **overdue** occurrences, do they **stack up**?

## The three ways to model recurrence

- **(A) Spawn-on-complete (a new row per occurrence).** Completing the task creates the next item. Each occurrence is a real row with its own body/properties. *Cons:* the list fills with clones; a daily task missed for a week leaves seven overdue rows (stacking); history is N rows to scan. *Pro:* each occurrence can carry distinct notes for free.
- **(B) Advance-the-due-date (one row, the date moves forward).** Todoist's model: one task, completing it rolls `due` to the next date. *Cons:* no per-occurrence history (you can't see "did I do this last Tuesday"); a long-missed task shows as a single stale overdue. *Pro:* dead simple, one row.
- **(C) One task + a per-date completion log (TaskNotes' model).** One item carries the recurrence rule plus a `complete_instances` (and `skipped_instances`) set of dates; a `scheduled` field points at the next uncompleted occurrence and **auto-advances** on completion. Occurrences are "virtual" (computed from the rule) until a specific date needs its own content, at which point you **materialize** it as a child item. *Pro:* no spawning, no stacking, full per-date history, one row in the common case. *Con:* the completion-log + virtual-occurrence logic is more to build than (B).

## How TaskNotes does it (the reference)

Pulled from the docs, the model is (C):

- **Rule storage:** RFC-5545 **RRULE strings with `DTSTART`**, e.g. `DTSTART:20250804T090000Z;FREQ=WEEKLY;BYDAY=MO,WE,FR`. Built via presets or a custom date/time-picker modal.
- **Completion advances, never spawns:** the `scheduled` field "advances when occurrences are completed" to the next uncompleted occurrence; the rule itself is unchanged.
- **Per-date completion log:** `complete_instances: ["2025-08-04", "2025-08-06", ...]`, plus a separate `skipped_instances`. "Each occurrence can be completed independently (task cards, calendar menus, task edit modal completion calendar)."
- **No accumulation:** a single `scheduled` date represents the next uncompleted instance; missed occurrences are simply dates not in the log. "Only the next undone date drives planning."
- **`scheduled` vs `due` are separate:** `scheduled` = the concrete next commitment date; `due` = the deadline. By default `due` does not advance with recurrence, but a "**Maintain due date offset**" toggle preserves the gap (advance scheduled Jan 1 → Jan 8 and due shifts Jan 3 → Jan 10).
- **Virtual vs materialized occurrences:** pattern-generated occurrences are "virtual" (no note); a date that needs its own work is **materialized** into a note via a right-click / action palette, with policies like "create manually" or "create next after completion."
- **UI:** a completion calendar inside the task modal for per-date marking; calendar views render pattern instances with dashed borders and the next occurrence with a solid border.

## Answering Brandon's questions under model (C)

- **Does checking off trigger the next one?** No new row. Completing stamps today's date into `complete_instances` and `scheduled` advances to the next rule date, which is the *same item* reappearing. (Spawning is the (A) behavior, which we would avoid.)
- **Scheduling a future occurrence?** Two senses, both supported: (1) the series' next date is `scheduled` and advances automatically; (2) a one-off future occurrence that needs its own content (say, one week's sermon-prep block with distinct notes) is a **materialized child item** created on demand, parented to the series.
- **Overdue, do they stack?** No. One item; missed dates are just absent from the log. We pick a **display policy**: show only the next uncompleted occurrence (no pile-up), optionally with an "N missed" indicator. Contrast (A), which would litter the list with overdue clones.

## Per-occurrence notes: the materialized mode (Brandon's ask, 2026-06-17)

Brandon wants some recurring tasks to **create a distinct item for each occurrence**, so he can take notes on each one without overwriting the last (a weekly 1:1 where each week has its own agenda; a recurring sermon-prep block; a monthly site visit with its own checklist). This is TaskNotes' **materialized** occurrence, and the elegant part is it is **not a different model** — it rides on top of (C).

**How TaskNotes does it (the reference):**
- Default stays **virtual**: the parent holds `complete_instances`/`skipped_instances` and renders each instance from the rule. Materialized notes are for *"heavier instances where the date-specific work needs its own note."*
- A materialized occurrence is **a separate task note with its own content, frontmatter, and history**, linked to the series by two fields — `recurrence_parent` and `occurrence_date`. It does **not** copy the rule or the logs; **the parent stays authoritative** for the rule + series history.
- **Three policies** decide when an occurrence note is created: **Create manually** (only by explicit action), **Create next after completion** (completing one materializes the next, idempotently; a sub-toggle: on completion only, or on completion-or-skip), and **Rolling window** (spec'd, not yet automated in the plugin).
- **Completing a materialized occurrence** completes that note *and* updates the parent — adds the date to `complete_instances`, clears it from `skipped_instances`, advances the parent's `scheduled`. So virtual and materialized share one completion history.
- Triggered by a right-click "Open or create occurrence note," an action palette, the HTTP API, or an MCP tool. Dragging a materialized note on the calendar reschedules *that* occurrence without touching the parent rule.
- TaskNotes' own "when to use" list: *"a weekly review where each week needs a separate agenda and notes / a maintenance task where each visit needs photos, links, or a checklist / a recurring meeting where every occurrence should have its own time entries and completion state."*

**How it maps to Ledgr (everything is an item):**
- A recurring task is the **series item** (holds the rule + `completeInstances`/`skippedInstances` + `scheduled`). A materialized occurrence is a **child item** (`parent_id` = the series — the existing subtask/tree mechanic), carrying `occurrenceDate` in its properties plus its own body/notes/completion. No new table.
- **A per-task mode setting** (`recurrence.occurrenceMode`): **virtual** (default — one shared body + the log) or **materialized** (each occurrence is its own child item). Plus an ad-hoc **"materialize this one"** action for an otherwise-virtual task when a single date happens to need notes.
- **Create-timing for materialized mode:** recommend **create-next-after-completion** (TaskNotes' policy) — exactly one live occurrence child exists at a time, completed ones persist as history, so **materialized mode also avoids overdue stacking** (the worry with naive spawn-on-complete). "Create manually" and a rolling window can come later.
- **Symmetry worth noting:** Ledgr already creates a distinct `meeting` item per calendar occurrence (calendar sync, ADR-023). A materialized recurring task is that same "series → per-occurrence items" pattern generalized; long-term, recurring meetings could be expressed as a materialized recurring series rather than a parallel mechanism. (Not a v1 ask, just a consistency note.)

**Open questions for materialized mode:**
- Where you mostly interact: the current occurrence child, with the series item as a quiet parent/definition? (Likely yes.)
- History: past occurrences stay as completed child items (with their notes) under the series — good for "what did I decide in last month's 1:1." Confirm that's the desired history surface.
- Switching virtual → materialized later: backfill past dates as items, or only materialize going forward? (Recommend going-forward only.)
- Reminders/ICS (T4): emit from the live occurrence child in materialized mode vs from the series in virtual mode (the feed branches on the mode).

## Templates + what each occurrence inherits (Brandon, 2026-06-17)

Brandon's ask: a recurring task often *is* a template — subtasks, tags, properties, written body content — and each new occurrence must get **fresh copies** of all of it. If this week's subtasks are checked and the task is completed, next week's occurrence starts with a fresh, unchecked set.

**Scope (Brandon, 2026-06-17): this applies only to the materialized type — the kind where there's a copy per occurrence.** Virtual recurrence is one item + a completion log, with no per-occurrence copy, so there is nothing to clone or reset; template replication is inherently a materialized-mode feature. Put plainly: if a recurring task needs fresh subtasks/content each cycle, that *is* the materialized type by definition (which is why subtasks/rich content essentially select materialized mode).

**The prototype concept.** The recurring task carries a **prototype**: the canonical definition of one occurrence (body, subtasks, properties, tags, relations). Each occurrence is generated **from the prototype, never copied from the just-completed (mutated) occurrence** — that's the crux, otherwise checked subtasks and stale notes bleed forward.

**Where the prototype lives (recommendation): the series item.** The series item holds the rule + log (model C) *and* the canonical subtasks/body/properties; it is never "completed," it is the definition. This makes **materialized mode the natural fit for recurring-tasks-with-subtasks**: each occurrence child is a **deep clone of the series prototype**, reset, while the series stays pristine. (Virtual mode — one shared item — is best for the simple checkbox case. **Rule of thumb: subtasks or per-occurrence notes ⇒ materialized**; Ledgr can even auto-pick materialized when a recurring task has subtasks.)

**What carries vs resets when a materialized occurrence is cloned:**

| Element | Behavior |
|---|---|
| Subtasks (child items) | **Cloned fresh, all unchecked/open** (the core ask) |
| Body (markdown) | **Cloned fresh from the prototype** — last occurrence's notes stay on that occurrence; the new one is pristine |
| Properties | Cloned from the prototype; `status`/completion **reset to open** |
| Tags / relations | **Carried** from the prototype (a 1:1 stays linked to the person); ad-hoc links made during one occurrence stay local to it |
| `scheduled` / `due` | **From the rule**, not copied |
| Attachments | Not copied (occurrence-specific); template attachments TBD |
| Time entries (if added later) | Reset per occurrence |

**One shared primitive with the templates system.** "Clone an item with its subtree, applying reset rules" is exactly what both (a) materializing a recurring occurrence and (b) a richer item template need. Today's templates (ADR-045/050) seed body + property/relation defaults but **not subtasks**; extending them to capture a **subtree** is the same capability the recurring prototype needs. Recommend building **one `cloneItemSubtree(resetRules)` primitive** and using it for both — and letting a recurring task be *created from* a template, with the series item then serving as the prototype the engine clones each cycle.

## Recommendation

**Model (C), TaskNotes-style, adapted to "everything is an item" (Principle 2):**

- **One `items` row per recurring task** (the series). In the default **virtual** mode that one row is the whole task. A per-task **`occurrenceMode`** can switch to **materialized**, where each occurrence is its own **child item** (parent = the series) with its own non-overwriting notes — see *Per-occurrence notes* above. Either way, no parallel table.
- **Store the rule + logs in `items.properties`** under a `recurrence` key: `rrule`, `completeInstances: string[]`, `skippedInstances: string[]`. No schema-shape change beyond fields; computation is deterministic (Principle 3).
- **Completing on a date** updates the log and advances `scheduled`.
- **RRULE engine:** weigh the `rrule` npm package against a hand-rolled constrained subset (daily / weekly+BYDAY / monthly / weekday). Recurrence correctness (DST, month-end, BYDAY) is genuinely fiddly, which is the strongest case for the library; Principle 5 says justify the dep explicitly in the ADR.

## What to decide (the forks)

1. **The model: (A) / (B) / (C).** Recommend **(C)**.
2. **Add a first-class `scheduled` date, separate from `due`?** TaskNotes splits "when I plan to do it" (scheduled) from "the deadline" (due). Ledgr has only `due` today. A `scheduled` field is also what time-blocking wants (`calendar-time-blocking.md`), so this is a shared decision. Recommend **yes** (add `scheduled`), with an optional "maintain due offset" behavior.
3. **RRULE library vs hand-rolled subset.** Recommend deciding in the ADR; lean library for correctness.
4. **Overdue display policy.** Next-only (recommend), next + a "missed" badge, or a catch-up prompt.
5. **Occurrence mode + when to materialize.** Per-task **virtual** (default) vs **materialized** (a note per occurrence — Brandon's ask). For materialized, recommend the **create-next-after-completion** policy (one live occurrence at a time, no stacking); "create manually" / rolling-window later. Plus ad-hoc "materialize this one" for a virtual task. (See *Per-occurrence notes*.)
6. **Edit a series vs an occurrence.** Editing the rule (whole series) vs editing one materialized occurrence; and what "this and future" means.
7. **The occurrence prototype + clone rules.** Series item as the prototype; deep-clone-with-reset per occurrence (subtasks fresh, body fresh, properties/relations carried, completion reset); build it as one "clone item + subtree" primitive and extend the templates system (ADR-045) to capture subtasks. (See *Templates + what each occurrence inherits*.)
8. **Fixed-schedule vs completion-based recurrence.** Recommend supporting both, per task.
9. **Skip + end conditions.** A first-class skip; end-after-N / end-by-date / forever.

## Other factors worth deciding (Brandon: "explore other factors if I've missed any")

- **Fixed-schedule vs completion-based recurrence (the big one).** "Every 2 weeks" can mean *fixed* (the 1st and 15th no matter when you finish) or *relative to completion* ("2 weeks after I last did it" — water the plants 3 days after the last watering, not a fixed calendar). Todoist splits these (`every` vs `every!`); a pure RRULE is fixed. **Recommend supporting both, per task:** a fixed RRULE, or a "repeat N units after completion" mode where the next `scheduled` is computed from the completion date. Matters a lot for chores/maintenance.
- **Skip an occurrence.** Skip this week without completing (TaskNotes' `skipped_instances`) — distinct from done and from missed. Worth a first-class skip.
- **End conditions.** Until a date / after N occurrences (RRULE `UNTIL`/`COUNT`), or forever. Cheap via the rule.
- **Parent ↔ subtask ↔ trigger interaction.** Completing the parent completes the occurrence and triggers the next, however reached (Ledgr already rolls up "all subtasks done → parent done"). Decide whether the last subtask auto-completes-and-recurs, or only rolls up and you still tap the parent.
- **Pause / resume a series** (suspend without deleting) — minor, nice for seasonal tasks.

## Constraints to honor

- **Everything is an item (Principle 2):** one row per series; occurrences materialize as child items only when needed.
- **Deterministic (Principle 3):** next-date computation + advance is plain code, no model.
- **Boring stack (Principle 5):** justify `rrule` in the ADR or use a constrained native subset.
- **Fast/cheap (Principle 8):** the completion log is a small jsonb array; "next occurrence" is computed, not stored as N rows.
- **Plays with T4 + T3:** the ICS feed (T4) emits the next occurrence (or a bounded window of virtual occurrences); Today and the focus layer (T3) show the next occurrence, not the backlog of missed dates.

## Beyond recurrence: other TaskNotes ideas worth a look (Brandon: "explore other features too")

From the TaskNotes feature list, mapped to our plan:

- **Relative reminders** ("3 days before due", or absolute) → fits **T4** (per-task reminder lead time).
- **NLP capture** (date/priority/context extraction in fast capture) → fits **T2** (natural-language dates).
- **Inline checkbox → task conversion** (a body checkbox becomes a full task without leaving the note) → this is our `block-linked-action-items.md`.
- **Materialized vs virtual occurrences** → adopted in the recommendation above.
- **Time tracking + Pomodoro** (work-session logs, estimate-vs-actual analytics) → **net-new**; a future bespoke task capability, parking-lot (could pair with time-blocking).
- **Effort estimates** (an `estimate` field, workload trends) → **net-new**; a small `estimate` property + later analytics. Parking-lot.
- **Automatic archival** of completed tasks → a small Today/list-hygiene nicety.
- **Bidirectional calendar sync (OAuth)** → we chose ICS *publish* (T4); their two-way Graph/Google sync is the heavier path we deferred with the provider-seam decision (ADR-074).
