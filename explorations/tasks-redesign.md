# Tasks redesign (Todoist-style) — PRD / design (draft)

**Status:** draft, building. Raised by Tyler 2026-06-21: replace the generic `/list/[type]` surface (starting with Tasks) with a bespoke, Todoist-like Tasks page. Decisions below are settled (Tyler, 2026-06-21). **Sequenced build:** (1) the `project` type, (2) the P1–P6 priority core change, (3) the four-tab Tasks page.

> Bigger arc: `/list/tasks`, `/list/notes`, etc. are a weak generic UI; each important type should get a bespoke surface. Tasks is first.

## Decisions (Tyler, 2026-06-21)

1. **Priority = P1–P6, replacing the 4-level `urgency`.** 1 highest … 6 lowest. Colors: **P1 red · P2 gold · P3 purple · P4 blue · P5 green · P6 white/none**. CORE (a task data-model change) → Brandon-agree + ADR; the existing p1–p4 quick-add (ADR-084) maps in.
2. **Subtask → auto P5 (green).** When a task gains its first subtask, bump it to P5/green automatically. (Green was the color Tyler named; the "priority 2" in the original ask was a slip.)
3. **Build the `project` type first**, then the Tasks page (so the Projects tab is real on day one).

## Reconciliation with Brandon's Events chunk (ADR-094, landed 2026-06-21)

Brandon shipped Events (E1–E4) mid-build; it overlaps this redesign, so:
- **"Labels" = Brandon's built-in `tags` field (E2), NOT a new field.** Tagging is a `relations` edge (role `tags`) to a `tag` item via the ADR-067 chip box + create-on-miss. The Labels chip / rail row here *is* that `tags` field. Don't build a separate labels field.
- **`meeting` is now `event` (E1).** Everywhere this PRD says "meeting" (the task rail, the project hub, capture), read **event**. (Brandon kept internal names: `meeting_at`, `src/lib/meetings/`, `MeetingPrep`.)
- **Project ↔ task-pull (Tyler, 2026-06-21): an event must pull "tasks for Project X."** A task relates to a project via a `relations` edge (role `project`). Brandon's E4 event task-pull (`properties.taskPull`) **already accepts any item id as a seed** and queries tasks `relatedTo` each seed — so adding a project as a seed pulls its tasks for free. The only requirements: (a) project↔task is a *confirmed* edge (which the `relatedTo` query counts), and (b) the `TaskPullControl` typeahead can pick a project. No new pull mechanism.
- **Calendar feed (E3)** stays as-is (pull-from-calendar list; matched events auto-promote).
- **Migrations** are at 0029 on main; the priority migration is **0030**.

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
- **Title**, with an optional muted description line.
- **A metadata line directly below the title** (small SVG icons, colored), showing whichever apply (Images #9/#10):
  - a **subtask-count indicator** — a small branch/subtask SVG + **`done/total`** (e.g. `0/3`) when the task has children;
  - the **relative date** (calendar icon, accent-colored — "Wednesday"/"Saturday", per the relative-date rule below);
  - a **recurring ↻ icon** when the task repeats;
  - the **priority flag** (P-colored);
  - the **assignee** (avatar);
  - **label chip(s)** (tag icon, colored).
- A right-aligned **project chip** (the "# Project" context) — or the project can sit on the metadata line; one consistent placement decided at build.
- **Subtask roll-down:** the subtask-count indicator **expands inline** to reveal the subtasks, or the task is **clicked to open its detail modal**. Subtasks can themselves have subtasks (nesting), so the count indicator appears on subtasks too.
- An **"Add task" button** below each list (and below a task's subtasks) for fast entry.

## Task detail canvas (opening a task) — Tyler, 2026-06-21

Tasks get their **own bespoke canvas** (not the default markdown canvas) — a focused, Todoist-style two-pane view (Images #7/#8), via the per-type canvas seam (ADR-041). Composes existing pieces (Subtasks panel, the field controls) rather than a new editor.

- **Main pane (left):**
  - Checkbox + **title** at the top.
  - A **lightweight Description.** Clicking in opens a **clean, minimal editing box** — just text, no toolbar (Image #12), since most descriptions are short. **A small "canvas" SVG icon in the box's top-right summons the full markdown options** (color, bold/italic, headings, tables, the whole canvas) on demand, so it stays simple by default but goes rich on one click. (A "minimal" mode of the existing markdown editor: toolbar hidden until summoned.)
  - **Subtasks are central** — a collapsible **"Sub-tasks N/M"** section (chevron + done/total count), each subtask showing its own relative date, with a prominent **"+ Add sub-task"** right under the description. Subtasks can themselves nest (a child with children shows the same count indicator).
  - **Parent breadcrumb (up-navigation):** when a subtask is opened, a **smaller clickable chip of its parent task sits above the title** — the parent's checkbox + title + the parent's own subtask count + a `›` — breadcrumb-style; click it to navigate up the tree (works at any depth). (Image #11.)
  - **Comments — DEFERRED (Tyler, 2026-06-21): not building yet.** (Todoist shows a Comment box here; we'll leave it out for now. When revisited: a lightweight timestamped list, likely `properties.comments` or related sub-items.) Leave room in the layout but don't build it.
- **Right rail (details):** a column of property rows, each showing a value or a **"+"** to set — **Project · Date · Deadline · Priority · Labels · Reminders · Location · Assignee.** Same action vocabulary as the capture-card chips and the Quick Add config (one shared set: Date→scheduled, Deadline→due, Priority→P1–P6, etc.). (Todoist's lock/Pro badges on Deadline/Location are theirs; in Ledgr Deadline = the existing due date, Location is deferred.)
- **Core note:** this gives the core `task` type a bespoke canvas (uses the ADR-041 seam, doesn't change it). Mostly UI; flag to Brandon if any of it reaches the core type model (the priority change is already the core flag).

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
- Action ↔ field map: Date→scheduled, Deadline→due, Priority→P1–P6, Reminders→`properties.reminder`, Attachment→R2 upload, Labels→Brandon's built-in `tags` field (E2, edges role `tags`), Assignee→below, Location→new (likely defer).

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
- **CORE → Brandon-agree + ADR (ADR-096).** Flagged in COLLAB.

## The `project` type (step 1 — built first)

> **⚠️ Needs its own deeper-dive design session (Tyler, 2026-06-21).** The vision is bigger than a task bucket: a project is a **hub where events, notes, tasks, people, and the actual work come together in a way that's genuinely helpful** — open a project and see its people, its events, its notes, its tasks/progress, and the work in one coherent place. The scope below is the minimum to power the Tasks → Projects tab; the full hub UX (how all of it composes on the canvas) is the deep dive. Don't over-build the hub before that conversation.

The hub type from the v1.0 queue, brought forward because the Projects tab needs it:
- A bespoke `project` item: properties like **status, repo URL, live URL, stack** (dev-app variant) — but general (any tracked project).
- **Status (Tyler, 2026-06-21): seed from my Todoist project buckets, but user-changeable** (rides the configurable category-statuses, ADR-082, so the type's status editor can change them): **Ongoing · Waiting for Others · Paused · Future · Done** (categories: Ongoing→in_progress, Waiting/Paused/Future→not_started, Done→done).
- **Canvas = a hub:** a board/list of its **related tasks** + the attached **notes / events / files / people** + progress — all the threads of the work in one place (the full composition is the deeper-dive above).
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
