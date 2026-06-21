# Tasks redesign (Todoist-style) — PRD / design (draft)

**Status:** draft, building. Raised by Tyler 2026-06-21: replace the generic `/list/[type]` surface (starting with Tasks) with a bespoke, Todoist-like Tasks page. Decisions below are settled (Tyler, 2026-06-21). **Sequenced build:** (1) the `project` type, (2) the P1–P6 priority core change, (3) the four-tab Tasks page.

> Bigger arc: `/list/tasks`, `/list/notes`, etc. are a weak generic UI; each important type should get a bespoke surface. Tasks is first.

## Decisions (Tyler, 2026-06-21)

1. **Priority = P1–P6, replacing the 4-level `urgency`.** 1 highest … 6 lowest. Colors: **P1 red · P2 gold · P3 purple · P4 blue · P5 green · P6 white/none**. CORE (a task data-model change) → Brandon-agree + ADR; the existing p1–p4 quick-add (ADR-084) maps in.
2. **Subtask → auto P5 (green).** When a task gains its first subtask, bump it to P5/green automatically. (Green was the color Tyler named; the "priority 2" in the original ask was a slip.)
3. **Build the `project` type first**, then the Tasks page (so the Projects tab is real on day one).

## The four tabs (under the "Tasks" title)

Order: **Today (1st) · Inbox (2nd) · Upcoming (3rd) · Projects (last).** A tab strip below the page title (reuse the canvas-tabs visual language where it fits).

### Today (default tab)
Tasks due today, **grouped by priority** (P1→P6, color-headed). The global "+" capture and a per-list "Add task" both add here as needed (but a bare "+" capture defaults to **Inbox** — see below).

### Inbox (quick collection bucket)
Tasks not yet categorized. **The global "+" add-task lands here by default unless a destination is specified.** This is the triage bucket (pairs with the existing `inbox` flag / `unmarked` capture).

### Upcoming
Day-grouped list, Todoist-style: day headers (`Jun 22 · Tomorrow · Monday`), tasks under each, a **per-day "Add task"** (keep this — adds a task due that day). Plus:
- **Day-of-week chips overtop** — clicking a day scroll-jumps the list to that day's section.
- **Week shift:** the chips show a week window; arrows step the window. Default label **"Current"** (this week); **→** advances to +1 week, +2 weeks, … ; **←** steps back toward Current (Upcoming is future-facing, so it doesn't go before this week).

### Projects (last)
Project **cards**, each with its **subtasks/related tasks below**. Depends on the `project` type (built first). A project card shows the project + its open tasks; expandable.

## Task row (the list item)

- A **priority-colored circle checkbox** on the left (P1 red … P5 green, P6 plain) — check to complete.
- Title; optional secondary description line (muted).
- A right-aligned **context label** (project / area) with a small icon (the Todoist "# Project" chip).
- A **small SVG subtask indicator** when the task has children, with a **roll-down** (expand/collapse) to reveal the subtasks inline.
- An **"Add task" button** below each list (and below a task's subtasks) for fast entry.

## Add-task capture card (Tyler, 2026-06-21)

The redesigned capture UI, used by **both** the global "+" and the per-list "Add task" everywhere in the Tasks module (Image #4). NL parsing already works (`parseTaskTitle`, ADR-084); this is the UI on top.

- **Inline token highlighting in the title input.** As the user types, recognized phrases — priority (`p3`), dates (`thursday`), recurrence (`every week`) — get a **highlight background in the user's accent/highlight color**, live (Image #3). *Implementation:* a plain `<input>` can't style spans of its own text, so render a **highlighted backdrop div behind a transparent input** (the text mirrored with `<mark>`-style spans on the detected ranges), or a contenteditable. **No dependency** (Principle 5); reuse the `parseTaskTitle` detections' ranges to place the highlights.
- **Card layout:** title line (with highlights) → a muted **Description** line → a **chip row** → a footer.
  - **Chip row** (SVG icons, replacing the current emoji/text icons): a **date chip** (calendar icon, shows the relative/absolute label, × to clear), **Attachment** (paperclip), a **priority chip** (flag icon, P-colored, × to clear), **Reminders** (alarm), and a **"…" kebab** (Image #6). Chips reflect what the parser detected and are individually editable/clearable. **The "…" kebab opens everything the user demoted to "More actions"** (the hidden pool from the Quick Add settings) so it's still reachable on demand, and is the **extensible home for future actions** the user sets up — anything not pinned as a visible chip lives behind the kebab.
  - **Footer:** a **destination picker** bottom-left (**"Inbox ▾"** — defaults to Inbox, dropdown to pick a project/area/today), and **Cancel** + **Add task** (accent) bottom-right.
- **SVG icon set:** replace the current icons (the calendar/flag/alarm/paperclip/inbox) with clean inline SVGs (no icon-font/dependency).

### Configurable Quick Add (User Settings, Tyler 2026-06-21)

A **"Quick Add"** panel in User Settings (Todoist-style, Image #5) lets the user choose **which action chips appear on the capture card and in what order**:
- **"Show task actions"** — the visible chips, **drag-to-reorder**, each with a − to demote to More. Defaults: **Date · Assignee · Attachment · Priority · Reminders**.
- **"More actions"** — the hidden pool, each with a + to promote to shown. Defaults: **Labels · Deadline · Location**.
- **"Show action labels"** toggle (On/Off) with a live example row (chips with vs. without text labels).
- **Storage:** additive jsonb on `users.settings` (`quickAddActions: {shown: [...], showLabels: bool}`), tolerant parse — the `navSlots`/`highlightGradient` pattern (ADR-056). Non-core. The capture card reads this config to render its chip row; an unconfigured user gets the defaults.
- Action ↔ field map: Date→scheduled, Deadline→due, Priority→P1–P6, Reminders→`properties.reminder`, Attachment→R2 upload, Labels→the built-in labels field (the COLLAB proposal), Assignee→below, Location→new (likely defer).

### Assignee

Tasks get an **assignee** (a relation to a `person`, role `assignee`). Single-user today (multi-user-ready, not multi-user — Principle 7), so it mostly serves delegation tracking (pairs with the project "Waiting for Others" status). A capture-card chip + a row affordance; surfaced via the Quick Add config above.

## Relative date labels

Wherever a task's date shows (rows, the date chip, Today/Upcoming), show a **relative label when it's near** — "Today", "Tomorrow", or the weekday name ("Thursday") within the coming week — and **switch to an absolute date** once it's farther out (e.g. > 6–7 days). One shared formatter so rows, chips, and group headers agree.

## Status: add a "Defer" option

Tasks need a **"Defer"** status. (Open: is "defer" a status label under not-started, or the existing "future scheduled date → off Today until then" behavior, ADR-077, surfaced as a one-click status? Lean: a real status that also sets/asks a defer-until date. Confirm when built.) Rides the configurable category-statuses (ADR-082).

## Priority field (P1–P6) — the core change (step 2)

- Replace `items.urgency` (enum critical/high/normal/low) with a **P1–P6 priority**. Likely: widen the enum / store 1–6; keep `urgency`'s column or rename to `priority` (decide in the ADR — leaning rename for clarity, with a migration mapping critical→P1, high→P2, normal→P4, low→P6, or similar).
- **Colors** live in one place (a `priority.ts` vocab: number → {label, color}) so the checkbox, the Today grouping headers, the board, and the NL quick-add all share it.
- NL quick-add (`parseTaskTitle`, ADR-084) already pulls `p1..p4`; extend to `p1..p6`.
- **CORE → Brandon-agree + ADR (forthcoming, ~ADR-095).** Flagged in COLLAB.

## The `project` type (step 1 — built first)

The hub type from the v1.0 queue, brought forward because the Projects tab needs it:
- A bespoke `project` item: properties like **status, repo URL, live URL, stack** (dev-app variant) — but general (any tracked project).
- **Status (Tyler, 2026-06-21): seed from my Todoist project buckets, but user-changeable** (rides the configurable category-statuses, ADR-082, so the type's status editor can change them): **Ongoing · Waiting for Others · Paused · Future · Done** (categories: Ongoing→in_progress, Waiting/Paused/Future→not_started, Done→done).
- **Canvas = a hub:** a board/list of its **related tasks** + the attached **notes / files / meetings**, and progress.
- Tasks belong to a project via a **relation** (role `project`, ADR-067) — so "this task's project" is an edge, and the Projects tab lists projects + their related tasks. (The Todoist "# Project" chip on a task row = its project relation.)
- Mostly Tyler's lane (a bespoke type/canvas = module internals, solo) unless the canvas reuses core seams.

## Build slices (each its own verify; ADR/COLLAB where core)

1. **`project` type** — seed + module registration + the hub canvas + task↔project relation. (Tyler's lane.)
2. **Priority P1–P6 (CORE)** — the `priority.ts` vocab + the field change + migration + quick-add extension + colored checkbox everywhere. ADR + Brandon.
3. **Tasks page scaffold** — the bespoke `/tasks` (or a new route) with the tab strip (Today/Inbox/Upcoming/Projects), replacing the generic list surface for tasks.
4. **Today tab** — due-today grouped by priority, colored.
5. **Inbox tab** — uncategorized bucket; "+" defaults here.
6. **Upcoming tab** — day-grouped + per-day add + day-jump chips + week-shift arrows (Current/+1/+2…).
7. **Projects tab** — project cards + roll-down subtasks.
8. **Row polish** — subtask SVG indicator + roll-down, per-list "Add task", context chip.

## Open / to-confirm

- Priority field: rename `urgency` → `priority` vs keep the name (ADR call).
- Migration mapping of the 4 old urgency values onto P1–P6.
- Does the global capture "+" always default to Inbox, or remember a last-used destination?
- Auto-P5-on-subtask: applies only on the *first* subtask, and does it ever auto-revert? (Lean: set once on first subtask, never auto-revert.)

## Precedent / pointers

- Existing task surfaces: `/tasks`, the view engine (`src/lib/views.ts`, `view-grouping.ts`), `BoardDnd`, `Subtasks`, `FocusStar`, native-tasks libs (recurrence/scheduling/focus, ADR-076–086).
- Relations for task↔project (ADR-067 typed relations). Projects PRD context: `explorations/project-items.md`.
- Tab visual language: the canvas-tabs work (ADR-094).
