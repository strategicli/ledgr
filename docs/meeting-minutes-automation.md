# Meeting minutes automation (Claude-over-MCP)

This is the v1a processing step for meeting transcripts (ADR-087). It turns a
meeting's transcript into **draft minutes** (in the meeting body) and
**suggested action items** (tasks in the Inbox), using Claude over the existing
Ledgr MCP server — **not** an in-app LLM call.

Why this shape: Ledgr's own backend stays model-free and deterministic
(Principle 3). The intelligence lives in the Claude layer you already use, fired
manually or on a schedule, and reuses the MCP tools already built (ADR-047/071).
Nothing auto-commits — minutes are a draft you edit, tasks land in the Inbox for
triage. That human-in-the-loop staging is what keeps a *scheduled* automation
consistent with "no AI in Ledgr's own cron."

## How the data is shaped

A meeting's transcript is its **own item** (`type: transcript`), not a region of
the meeting body — so a long transcript never swamps the meeting doc, and a
meeting can carry several. Each transcript is tied to its meeting two ways:

- **`parentId`** = the meeting (containment; travels with it to Trash).
- a confirmed **relations edge**, role `transcript` (association). This is what
  makes the connection first-class to the MCP graph:
  - from a meeting → its transcripts: `get_item(meeting)` returns them in
    `related` (role `transcript`); or `list_items(type=transcript,
    relatedTo=<meeting id>)`.
  - from a transcript → its meeting: the transcript row's `parentId`.

A transcript carries a `minutes` property — `none` (no minutes yet, the work
queue), `draft` (generated, awaiting your review), or `done` (reviewed). The
saved view **"Transcripts awaiting minutes"** lists exactly the `none` ones.

## The prompt

Paste this into Claude with the Ledgr MCP server connected (Build → AI & MCP has
the connection details). It is also what a scheduled run fires verbatim.

> **Process my meeting transcripts awaiting minutes.**
>
> 1. Call `list_views` and find the view named "Transcripts awaiting minutes".
>    Call `run_view` on its id to get the transcripts that still need minutes.
>    If there are none, stop and say so.
> 2. For each transcript returned:
>    a. `get_item` the transcript to read its full text. Note its `parentId` —
>       that is the meeting.
>    b. `get_item` the parent meeting for context (its agenda body, its related
>       people).
>    c. Draft concise **minutes** in markdown: a short summary, decisions made,
>       key discussion points, and an "Action items" list. Attribute to the
>       meeting's people where the transcript makes it clear.
>    d. Write the minutes into the **meeting body**: take the meeting's current
>       body, append a `## Minutes` section (don't delete the agenda), and call
>       `update_item` on the meeting with the combined markdown as `bodyMarkdown`.
>    e. For each action item, call `create_item` with `type: "task"`,
>       `inbox: true`, a clear title, an optional `dueDate`, and
>       `relateTo: [<meeting id>]` (also relate to the responsible person's id
>       when you can identify them). Leave them in the Inbox — do not schedule or
>       complete them.
>    f. Call `update_item` on the transcript with
>       `propertyPatch: { "minutes": "draft" }` so it drops out of the awaiting
>       view and isn't processed again.
> 3. Report what you drafted for each meeting: the minutes summary and the tasks
>    you filed, so I can review and confirm.
>
> Do not mark any transcript `done`, do not edit the agenda, and do not complete
> or schedule any task — I review and confirm everything.

### Run it manually

Right after a meeting, with the transcript pasted in, just tell Claude:
**"process my new transcripts"** (or paste the prompt above). You get minutes and
Inbox tasks immediately.

### Run it on a schedule

Point a scheduled Claude task at the same prompt (e.g. twice a day). It processes
whatever has accumulated in the awaiting view and reports back. Because every
output is staged (draft minutes, Inbox tasks, transcript left `draft`), a
scheduled run never silently changes anything you haven't reviewed.

## After a run

- Open the meeting, review the `## Minutes` section, edit freely.
- Triage the suggested tasks out of the Inbox (schedule, assign, or discard).
- When you're happy with a meeting's minutes, set its transcript's `minutes`
  property to `done` (on the transcript item). It's already out of the awaiting
  view at `draft`; `done` marks it fully reviewed.

## Ad-hoc exploration

The same shape powers open-ended asks, e.g. *"look at my recent meetings, pull
their transcripts, and find every commitment Roger made this month."* Claude
lists recent meetings, follows each meeting's `transcript`-role related items to
the transcripts, reads them, and reasons across them — all through the read-only
MCP tools.
