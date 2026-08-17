// "Using Ledgr" — the owner-facing user guide, held once and served three ways.
//
// This is the answer to a real problem: a second builder kept asking for
// features he already had, because nothing in the system tells you what the
// system can do. CLAUDE.md says how it is built, ledgr-prd.md says what was
// intended, runbook.md says how to operate it — none of them say "here is what
// you can do, and where." This file does.
//
// ONE SOURCE, THREE DOORWAYS. The markdown below is the only copy:
//   1. MCP resource `ledgr://guide/using-ledgr` — any connected AI can read it.
//   2. /build/guide — the same markdown rendered in-app (Build → MAINTAIN).
//   3. The Work "More" menu and the command palette both link at that route.
// A `.ts` wrapper around a template literal rather than a `.md` file read at
// runtime, matching guide.ts: no bundler config, no fs, no tracing rules, and it
// works identically in the serverless MCP route and a server component.
//
// INSTANCE-AGNOSTIC. Both deploys (Brandon's and Tyler's) serve this same text,
// so it describes capabilities that exist in the code and never one owner's
// actual types, views, or data. For "what do *I* have," the guide points a
// reading AI at describe_workspace / list_types, which are per-owner and live.
//
// KEEPING IT CURRENT is a process rule, not automation (ADR-189): a slice that
// changes what the owner can do updates this file in the same PR. The /ship
// pre-merge gate asks. Nothing generates this from code — a generated index
// would be worse prose than a maintained one, and the reminder sits in the two
// places every slice already passes through.
//
// Pure (no DB, no Next, no env), like guide.ts. guide.ts's readGuideResource
// serves it; server.ts lists it.

// Stable, opaque URI. Sibling of ledgr://guide/workspace-shaping and
// ledgr://guide/memory-protocol — additive, per the ADR-183 carve-out.
export const USER_GUIDE_URI = "ledgr://guide/using-ledgr";

// The route the in-app copy renders at, exported so the Build sidebar, the
// command palette, and the guide text itself all name it from one place.
export const USER_GUIDE_ROUTE = "/build/guide";

// The resources/list descriptor. The description doubles as the model-facing
// hint for *when* to read it: this is the "what can the owner do" guide, as
// distinct from workspace-shaping's "how do I change the workspace."
export const USER_GUIDE_RESOURCE = {
  uri: USER_GUIDE_URI,
  name: "using-ledgr",
  title: "Using Ledgr: what it does and where to find it",
  description:
    "A complete index of what the owner can do in Ledgr and where each " +
    "feature lives — capturing and writing, organizing, finding, getting " +
    "data in and out, and the AI surface. Read this when the owner asks " +
    "what Ledgr can do, how to do something in the app, or where a feature " +
    "is. For what THIS owner actually has (their types, views, dashboards), " +
    "call describe_workspace instead.",
  mimeType: "text/markdown",
} as const;

// The guide body. Written for the owner, in plain language: short sentences,
// one idea per bullet, and a route on every feature so the reader can go there.
//
// ONLY TWO HEADING LEVELS, and no document title — both are deliberate.
// markdownToHtml shifts headings down one so the page's own <h1> stands (`#` →
// h2, `##` → h3), and `.ledgr-prose` styles h1–h3 only, because the editor never
// offers H4. A third level here would render as unstyled body text and the index
// would stop being scannable. Keep it flat; if a section outgrows two levels,
// split the section. The title is omitted because both readers already have one:
// the page prints "User Guide" above this, and the MCP descriptor carries
// USER_GUIDE_RESOURCE.title.
export const USING_LEDGR_GUIDE = `What Ledgr can do, and where each thing lives. This is an index, not a tutorial:
scan for the feature, go to the route.

It describes the app itself, not your copy of it. For your actual types, views,
dashboards and navigation, an AI assistant should call \`describe_workspace\` and
\`list_types\`.

# Start here

## Two surfaces: Work and Build

**Work is for using the system. Build is for building it.**

- **Work** is your daily surface. It is glanceable and works on a phone. Its
  navigation bar is yours to configure.
- **Build** is where you shape the system: types, views, dashboards, navigation,
  and the maintenance tools. It is desktop-first, with a fixed left sidebar.

Switch between them with **Ctrl/⌘+Shift+B**, the **Build** button in the Work
"More" menu, or "Back to Work" at the bottom of the Build sidebar.

The split is a default, not a wall. Any Build tool can be pulled into your Work
navigation if you use it daily.

## Everything is an item

Tasks, events, notes, links, people, and every type you invent are all rows in
one table. That is why anything can link to anything, one search covers
everything, and a note can become a meeting without being retyped.

Five types are built in and cannot be deleted: **task**, **event**, **note**,
**link**, **person**. You can still edit them, add properties, and hide the ones
you do not use.

## Three ways to reach anything

- **Command palette:** **Ctrl/⌘+K** anywhere. Searches your items, pages, saved
  views, types, Build sections and settings at once.
- **Quick capture:** press **q** anywhere, or the **+ New** button in the nav.
- **The nav bar:** yours to arrange, at \`/build/navigation\`.

# Capturing things

## Quick capture

Press **q** or **+ New**. A capture card opens with a type picker.

- **It defaults to "Unsorted",** not Task. Capture the thought now, decide what
  it is later.
- **Everything lands in the Inbox** (\`/inbox\`) until you triage it.
- **Type the details into the title.** "Call Bob tomorrow p1 every week" pulls
  out the date, the priority and the repeat rule, shows them as chips, and
  leaves the title clean. It understands "every other Tuesday", "first Sunday of
  the month" and "the 3rd of the month".
- **Type \`@\` to link something** while capturing. \`@/person bob\` narrows the
  picker to one type. Picking an item adds a removable "Linked" chip.
- **Offline captures queue up** and send themselves when you reconnect. A pill
  shows how many are waiting.

## The Inbox

\`/inbox\` is where untriaged things collect. Assign a type, dates, priority and
people inline, or open a row for a deeper pass. The nav badge counts what is
waiting, and clears only when you actually triage.

**Triage mode** (\`/inbox/triage\`) deals with a backlog one card at a time:
**→** triaged, **←** trash, **↓** or **Space** skip, **Backspace** undo.

## Capturing from outside the app

- **From your phone's share sheet:** share a URL, some text, or a text file into
  Ledgr. A URL becomes a link item with the page's readable text; a text file
  becomes a transcript and asks which meeting it belongs to.
- **From your desktop browser:** the web clipper bookmarklet saves the page's
  article text into your Inbox as a link item. Set it up in **User Settings →
  Save from the web**. It is text only; images are stripped.
- **By email:** put a message in the **"Ledgr Import"** folder in Outlook and it
  becomes a note in your Inbox. Start the subject with **\`task:\`** and it becomes
  a task instead. Attachments are linked back to the original mail, not copied.
- **From an AI assistant:** any connected client can create items over MCP.
- **From your own app:** mint a token at \`/build/api\` and post to the HTTP API.

## Templates

A template is a real item you author normally, prototype and all: body,
subtasks, properties, relations. Applying one clones the whole thing.

- **Manage them** at \`/build/templates\`.
- **Set a default per type** and it drives that type's "+ New" button. The rest
  appear in a chooser.
- **Variables resolve on apply:** \`{{today}}\`, \`{{ask:Label}}\` (which prompts you
  for a value), and date-offset rules.
- **Apply to an existing item** to fill in its blanks or overwrite them.

# Writing

The body of every item is Markdown. What you see is formatted text, and what is
stored is portable Markdown you could read in any text editor.

## Three ways to view a body

A segmented pill above the body switches between them.

- **Rich text** — the formatted editor. The normal way to write.
- **Markdown source** — the raw text. This is the mode that stays fast on a very
  large note.
- **Preview** — read-only rendered output. **The only view where live tokens show
  their values.**

A very large note opens in Preview on purpose, with "Edit as text" as the way in.

## Formatting

Everything below has a toolbar button. Hover any button and its tooltip names it
and shows its shortcut for the keyboard you're on (⌘/⌥ on a Mac, Ctrl/Alt on
Windows). Every button can be hidden individually in **User Settings → Editor
toolbar**.

| What | Type this | Or press |
|---|---|---|
| Bold | \`**text**\` | Ctrl/⌘+B |
| Italic | \`*text*\` | Ctrl/⌘+I |
| Underline | — | Ctrl/⌘+U |
| Strikethrough | \`~~text~~\` | Ctrl/⌘+Shift+S |
| Inline code | \`\` \`code\` \`\` | Ctrl/⌘+E |
| Heading | \`#\`, \`##\`, \`###\` then a space | Ctrl/⌘+Alt+1…6 |
| Bulleted list | \`-\` then a space | Ctrl/⌘+Shift+8 |
| Numbered list | \`1.\` then a space | Ctrl/⌘+Shift+7 |
| Checklist | \`[]\` then a space | Ctrl/⌘+Shift+9 |
| Quote | \`>\` then a space | Ctrl/⌘+Shift+B |
| Divider | \`---\` | — |

Underline is the one exception to "type it and it works": typing \`++text++\` does
not convert as you go. Use the button or Ctrl/⌘+U.

**Tab** nests a list item and **Shift+Tab** un-nests it. On a phone, the indent
and outdent buttons do that job. **Backspace** at the start of a bullet merges it
into the line above.

## The "/" menu

Type **/** at the start of a line for an insert menu: Heading 1–3, Bulleted
list, Numbered list, Checklist, Quote, Code block, Table, Divider, Toggle, and
"Turn into toggle".

## Colour, and marking text for other purposes

Four separate channels, so they can all sit on the same words at once.

- **Text colour** — nine colours, from the "A" button.
- **Highlight** — nine translucent washes, from the marker button.
- **Slide mark** — "put this on the screen". Shows as a blue rule bracketing the
  span, and drives the presentation export.
- **Comment** — a private note to yourself, anchored to the selected text.

## Comments

Select some text and press the comment button. Your note shows as a card in the
margin, or as a tappable speech bubble on a narrow screen. Hovering either one
lights up both.

- **Notes are Markdown** — bold, links, and \`@\` mentions all work inside one.
- **A comment can span several paragraphs** and stays one comment.
- **Comments never reach a reader.** Print, share and Word exports strip them.
  They stay in your own read view and in search, because searching them is the
  point.
- **They survive export**, because they are stored in the Markdown itself.

## Linking to other items

Type **@** anywhere in a body. The picker searches every type as you keep
typing, spaces and all.

- **Narrow it with a type:** \`@/person bob\`. Typing \`@/person\` alone browses
  recent people.
- **Create as you write:** if nothing matches, a **Create** row makes the item
  and links it, without leaving the page.
- **Link a Bible passage** with \`@/ref John 3:16\`. The chip links to a page
  showing everything in Ledgr that cites an overlapping passage.
- **The chip stays live.** It shows the target's current icon, and a mention of a
  task carries a working checkbox you can tick from here.
- **Saving creates the relation** automatically, so mentions show up in the
  linked item's "Linked here" list too.

## Live tokens

Type **{{** for a menu of tokens that resolve from the item's current state
every time the page renders.

- **About this item:** \`{{item.title}}\`, \`{{item.status}}\`, \`{{item.due:long}}\`,
  \`{{item.props.<key>}}\`.
- **Today's date, always current:** \`{{now}}\`, \`{{now.tomorrow}}\`,
  \`{{now.today+7d}}\`, \`{{now.sunday}}\`.
- **Related items:** \`{{item.children}}\`, \`{{item.related.person}}\`,
  \`{{attendees}}\`, \`{{absentees}}\`.
- **The parent item:** \`{{parent.title}}\`, \`{{parent.due:long}}\`.

Date suffixes: \`:long\`, \`:short\`, \`:iso\`, \`:us\`, \`:day\`. Offsets: \`+7d\`, \`-1w\`,
\`+1m\`. Add \`:ul\` or \`:ol\` to a list token, alone on its own line, to get a real
list. Put a backslash in front to keep a token literal.

**Tokens show as plain text while you write, and resolve in Preview.**

## Blocks and structure

- **Toggle** — a collapsible block with a chevron. From the toolbar or \`/toggle\`.
  It stays a real disclosure on print, share and export.
- **Collapsible headings** — fold a heading to hide its section. View only;
  nothing is written into the body.
- **Table** — a real Markdown table, with drag-resizable columns.
- **Canvas tabs** — split one body into named tabs. Everyone else reading the
  item sees the whole document as titled sections.
- **Outline** — an automatic table of contents built from your headings, at the
  right edge. It can be pinned open as a resizable sidebar, remembered per item,
  and it lists your comments too.

## Images

Paste an image, drop one on the editor, or use the toolbar button. It uploads
and embeds where you dropped it. **Images only** — there is no in-editor path
for attaching other file types yet.

## Linking to one line

The "copy a link to this line" button stamps a hidden marker on the current line
and copies a URL straight to it. Opening that link scrolls to the line and
flashes it. The marker never appears on a printed or shared copy.

## Turning a note into tasks

On a meeting's notes, hover any checkbox line for a **→ task** button. It creates
a task pre-filled with that line and its sub-bullets, linked back to the meeting
and to that exact line. The line then shows a **✓ task** badge that opens it.

# Organizing

## Types and properties

Build your own kinds of item at \`/build/types\`.

- **Properties** can be text, number, date, checkbox, URL, phone, email, select,
  multi-select, or a relation to another type.
- **Phone and email fields are tappable.** Pick the Phone or Email kind and the
  value becomes a tap-to-call or tap-to-mail link, on the record and in a table
  view, with the right keyboard on a phone. Type the number however you like —
  it is stored exactly as you enter it, extension and all.
- **Statuses are yours per type.** Name your own stages and colours. Or choose no
  status at all, or a plain done/undone checkbox.
- **Hide a type you do not use.** It disappears from capture, "+ New", tabs and
  pickers without deleting anything.
- **Deleting a type is undoable.** It goes to Trash as a restorable unit, and can
  take its items with it.
- **Change an item's type** from its ⋯ menu, with a preview of what carries over.
  Properties the new type does not have are kept in the body rather than lost.
- **Bespoke tools** at \`/build/tools\` attach a ready-made capability — chord
  chart, paper workspace, tabs, longform document, widget homepage — to a type
  you name yourself.
- **Workflows and wikis** at \`/build/new\` ask a few questions and generate a
  type, its properties, and starter views in one go.

## Relations

- **Every item shows what links to it,** both directions, grouped by type.
- **Typed relation fields** ("Author", "Attendees", "Tags") live under
  Properties. Everything else shows under **Linked here**.
- **Create as you link.** Typing a name that does not exist makes it.
- **Tags are just a type.** A tag's page shows everything tagged with it.
- **Groups** have a member roster. An event can be *for* a group.
- **Discover** suggests items you probably should link but have not, ranked by
  shared text, shared neighbours, shared attributes and timing. One click links
  them.
- **Related Explorer** turns that into a map you can walk, re-anchoring as you
  go, with a breadcrumb trail.
- **Loose Ends** (\`/build/loose-ends\`) inverts it across everything: your
  least-connected items with their best suggestions inline.

## Tasks

Ledgr is its own task manager. Nothing else needs to be running.

- **Two dates, on purpose.** *Scheduled* is when you plan to do it; *due* is the
  deadline. Most of the app sorts by the plan date and falls back to the
  deadline.
- **Six priorities,** P1 to P6, colour-coded. They drive the checkbox colour, row
  chips and grouping.
- **Subtasks nest,** with an "n of m done" rollup and a breadcrumb.
- **Reschedule fast:** Today / Tomorrow / +1wk chips, or type "in 3 days" or
  "next Tuesday".
- **Roll overdue tasks forward** in one click from Today. It moves the plan and
  leaves the missed deadline alone.
- **Defer** a task by scheduling it ahead. It stays off Today until then.
- **Star three things** as Today's Focus. It sits at the top of Today and clears
  overnight.
- **Give a task a start time and duration** and it becomes a real timed block in
  your calendar feed.

## Repeating tasks

A repeating task is **one item** holding the rule plus a log of which dates are
done. Nothing stacks up when you miss a week.

- **Set a rule** in plain words, or with the controls: daily, weekly, monthly,
  yearly, intervals, weekdays, "first Sunday of the month", ending after N times
  or on a date.
- **Completing it advances it** to the next date rather than closing it.
- **A month grid** on the task lets you tick or untick any date, in any order.
- **Carve out one date** with "edit next occurrence" when that one is different.
  The series skips past it.
- **Editing the rule keeps the history** of what you already did.
- **Subtask dates follow the parent.** Pick a date and it is stored as an offset,
  recalculated whenever the parent moves.

## Projects and records

A project is a hub page composed of widget sections: the things that live in it,
an activity log, a next action, progress, milestones, a timeline, a mindmap.

Choose which sections show, and in what order, on the type's edit page under
**Record sections** — or per record, from the record itself. The **Overview**
reads directly under the title, editable in place (the toolbar appears when you
click into it). Each collection card's hover gear sets how many rows it
previews (3–50, or **All**); the Tasks card lists open tasks only — completed
ones move off the card and stay on its full collection page.

**Milestones complete three ways**, decided by what you give one when you add
it (the "+ Milestone" box takes a title, an optional date, optional points, and
an optional completing task):

- **Linked to a task** (pick an existing task or create one right there): the
  milestone completes when that task does. Its circle checks the task off — one
  gesture for both. A date on it is a target, not a trigger.
- **Dated, no task**: it counts as passed once the date arrives — no checkbox,
  it happens whether you act or not.
- **Undated, no task**: a work milestone you check off yourself.

Set **Points (% of project)** to make a milestone worth that share of the
project's progress bar, however many tasks it has; milestones without points
share the bar's remainder with the tasks and meetings.

**The Timeline card** previews the meetings and milestones nearest today, with
open undated milestones in an **Uncompleted** tail — completing one moves it
onto the axis at the day it finished. Its "Showing N of M" opens the record's
full month-by-month timeline page.

# Finding and seeing

## Search

- **Command palette (Ctrl/⌘+K)** — the fast one. Items, pages, views, types,
  Build sections and settings. A leading \`/type\` scopes it, as in \`/task budget\`.
- **Advanced search** (\`/search\`) — full text over titles and bodies with
  phrases, \`OR\`, and \`-exclusions\`, plus filters.
- **Tune** — for when you half-remember something. Stack up what you recall
  (words, a rough date, a type, a person, a tag) and set **how sure you are about
  each piece separately**. Results rank by the total instead of filtering down to
  nothing. A date never hard-filters, however sure you are.
- **Your own synonyms.** Teach it that "teaching" also means "preaching" in
  **User Settings → Search dictionary**.
- **One Search icon.** What it opens — the popup or the full page — is your choice
  at \`/build/navigation\`. Ctrl/⌘+K always opens the popup.

## Lists

Every type has a list page, reachable from \`/list\`.

- **Tabs (lenses)** across the top: Recent, Newest, A→Z, Most linked, each
  reversible. Add your own — a field, a property, or a whole saved view as a tab.
  Configure them on the type's edit page.
- **Select mode** is a toggle above the list. It reveals checkboxes (shift-click
  for a range) and a floating bar: delete to Trash, set a status, property or
  date, or move items under a parent.
- **Row menu** — right-click, or long-press on touch: Complete, Focus today,
  Schedule, Move to Trash.
- **Swipe** on a phone: right completes, left opens the schedule picker. Trash is
  never a swipe.
- **Undo** appears as a toast after anything destructive, and survives a refresh.

## Saved views

A view is a saved filter, sort and layout you reach by name. Build them at
\`/build/views\`, run them at \`/views\`.

- **Five layouts:** list, table, board, calendar, agenda.
- **Filter on anything,** including your own properties, with operators that fit
  the property kind.
- **Write simple rules:** "tagged A OR tagged B", combined with the view's other
  filters.
- **Sort by anything,** including priority and custom properties.
- **Pick your columns** for list, table and agenda layouts.
- **Boards drag,** including on a phone with a long press.

## Dashboards

Any number of named dashboards, each a grid you drag and resize. Manage them at
\`/dashboards\`; assign one as your Home or Today.

Widget kinds: a **view** (live list, compact or laid out faithfully), a **stat**
(one count), an **action** button, a **text** heading, a **tree** (parents with
their children), an **embed** (another item, editable right there), a
**container** (tabs or sections), and an **image**.

Each widget has a gear for its own settings: item limit, sort, title, header and
border, background colour. The dashboard itself can carry a full-bleed colour,
gradient or image background with an adjustable scrim.

**Dashboards are for doing, not just reading.** Rows have the row menu, list
widgets have an inline add, board widgets drag, and removals are undoable.

## Planner

\`/planner\` is a calendar you drag tasks onto to decide when you will do them.

- **Month and Timeline views.** Timeline is a zoomable horizontal axis, from
  hours out to five years.
- **Anything with a date shows up,** not only tasks. What is writable can be
  dragged; what has a start and an end can be resized.
- **Show your real calendar behind it** with the calendar toggle. Those events
  are read-only, there to plan around.
- **The unscheduled rail** holds what has no date. Drag onto the grid to schedule
  it, or off the grid to clear it.

## The Desk

\`/desk\` is a desktop workspace for working across several items at once:
resizable, tabbed panels holding items, saved views and dashboards. Every panel
is a live editor, so clicking between them is seamless. Save named workspaces;
the arrangement survives closing the app.

Send things there from any row menu or mention chip with "Open in Desk" or "Open
beside".

## Item pages

- **Opening from a list** docks a peek panel beside it on a wide screen, a modal
  on a narrower one, and a bottom sheet on a phone.
- **Each type gets a canvas that fits it** — a document layout for prose, a
  compact rail for tasks, a two-pane notes-plus-details layout for meetings.
- **Rearrange it yourself** by adding \`?arrange=1\` to the URL: every field and
  section becomes a resizable card, saved per type and per screen size.
- **Lock an item** from its ⋯ menu to make it read-only.
- **Version history** snapshots the body as you write, and restores.
- **A cross-device guard** stops a stale tab from overwriting a newer edit. If
  you have no unsaved work, it just reloads quietly.

# Getting data in and out

## Save Offline

The **Save Offline** button, under "Export & sharing" on any item, does three
things in one press:

1. **Exports to OneDrive** immediately.
2. **Pins a self-contained copy into your browser,** images and all, so the item
  opens with no network. It checks the pin actually landed before it says saved.
3. **Makes that copy print-ready**, so your browser's print-to-PDF is the PDF.

**Opening the app with no connection lists what you saved.** You get a page of
everything pinned on that device, newest first, with the date you saved each one,
so you can find Sunday's sermon without remembering its address. Tap a row and it
opens from the saved copy. The same page is at \`/offline.html\` when you *do* have
a connection, which is how you check on Saturday night that your pins landed.

This is the fallback path. Nothing you need on a Sunday should depend on the app
being up.

## OneDrive export

Every item is written out as a Markdown file, nightly and on demand, to
\`/Export/{type}/{year}/\`. Attachments are copied alongside. Deleted items move to
an \`_archive\` folder rather than vanishing.

**It is one-way.** Ledgr writes the files and never reads them back, so editing
an exported file changes nothing here.

## Sharing one item

The **Share link** control mints an unguessable, read-only link to a single item.
No sign-in for whoever you send it to. You can revoke it, and each press makes a
fresh one, so a leaked link can be killed on its own. Comments are never
included.

## Presentation export

For a talk or a sermon. Mark the spans you want on screen with the **slide mark**,
then one press gives you two documents:

1. **A stripped manuscript** with colours flattened, private notes removed, and a
  **[SLIDE N]** cue at every marked span.
2. **A slides document** listing each marked passage, numbered to match.

The slides document is rewritten each time rather than piling up. The old version
stays in the item's history.

## Your tasks in your calendar app

**User Settings → Task calendar feed (ICS)** publishes a subscribe URL that
Outlook, Apple Calendar or Google can follow. Your open dated tasks appear as
entries, so **your calendar app fires the reminders**. Timed tasks show as real
blocks; repeating tasks repeat properly. Set a per-task reminder lead time from
the task itself.

The URL is the password. Rotate it from the same place if it leaks.

## Other exports

- **Word (.docx)** for papers, rendered fresh from the Markdown each time.
- **Chord charts** for songs, including a Planning Center Lyrics & Chords format.

## Attachments

Attach any file type. Images embed in the body; anything else becomes a download
link. Files go from your browser straight to storage.

Limits: about **10 GB** in total, **100 MB** per file, and **2 GB** for an audio
or video file.

## Your calendar and email

- **Calendar** — Ledgr keeps a private copy of the next four weeks of your Outlook
  calendar. Events it recognizes become real items automatically, with the right
  people attached. The rest wait in the **Calendar** lens on the event list with
  an **Add** button. A promoted event tracks reality: if the meeting moves, the
  item moves.
- **Teaching it to recognize a meeting:** confirm the people on an event, then
  **pin it as a rule**. Future matching meetings get the same treatment.
- **Meeting prep** assembles itself when you open a meeting: the people's open
  tasks, your last few meetings with them, and the agenda. It is never written
  into the body.
- **Which tasks a meeting pulls in** is a per-event rule: by the people on it, by
  a tag, by a group, or a combination.

## Meeting transcripts

Paste a transcript into a meeting's transcript panel and it becomes a linked
child item marked "needs minutes", collected in a saved view. Uploading audio
transcribes it with speaker labels, if your instance has a transcription
provider configured. Audio is purged 30 days after its transcript exists.

## Giving another app access

\`/build/api\` mints a token for an outside app. It can read and write items, link
them, upload files, and capture a URL into your Inbox. It acts as you.

**Worth knowing:** tokens cannot be revoked one at a time. Rotating the secret
kills every app token at once.

# Working with an AI

Ledgr speaks MCP, so Claude — or any MCP client — can read and change your data
with your permission. Set it up at \`/build/claude\`.

- **Claude Code and similar:** generate a token there and run the \`claude mcp add\`
  command it gives you.
- **claude.ai, desktop and phone:** add a custom connector using the endpoint URL
  and sign in. That covers all three at once.

## What an assistant can do

- **Find and read** — search your items, list them by type, status, date window
  or what they relate to, and read one in full.
- **Create and change** — file tasks and notes, update fields, convert an item to
  another type, and make one exact edit to a note you are writing.
- **Work with tasks** — break one into subtasks, set a repeat rule in plain
  words, tick a single date of a repeating task.
- **Handle files** — attach by URL or upload, then embed in the body.
- **Link things** — relate and unrelate items, and confirm suggested links.
- **Build the workspace** — create and edit types, views and dashboards, add
  widgets, arrange a record's sections, and rearrange your nav. It reads
  \`describe_workspace\` first and should confirm with you before committing.

## Two features that are off until you turn them on

Both are in **User Settings**.

- **AI Memory** lets an assistant keep durable facts about you in Ledgr, linked
  into your relation graph, instead of forgetting between sessions. It adds
  \`/build/memory\`, where you can see exactly what is stored.
- **Live editing context** lets an assistant see which note you have open and
  what you have highlighted, so "rework this sentence" works. Nothing is tracked
  while it is off.

## Guides an assistant can read

Three, all plain Markdown over MCP:

- **\`ledgr://guide/using-ledgr\`** — this document.
- **\`ledgr://guide/workspace-shaping\`** — how to build types, views, dashboards
  and navigation correctly.
- **\`ledgr://guide/memory-protocol\`** — how to recall and when to remember. Only
  served when AI Memory is on.

# Settings

**User Settings** is on the Work "More" menu and in the Build sidebar.

| Area | What you can change |
|---|---|
| You | Display name, timezone |
| Appearance | Accent colour, interface density (desktop and mobile separately), text size, section style |
| Navigation | Position (top, bottom, left, right), spacing |
| Editor | Which toolbar buttons show; collapsible headings; toggle blocks |
| Capture | Which actions appear on the task capture card |
| Data | Trash retention, in days |
| Search | Your own synonym dictionary |
| Feeds | The task calendar (ICS) feed; the web clipper |
| AI | AI Memory; live editing context |

Some settings live where you use them: nav slots and what the Search icon opens
at \`/build/navigation\`, Home and Today at \`/dashboards\`, type visibility at
\`/build/types\`, and per-type tabs, statuses and sections on a type's edit page.

# Safety nets

- **Nothing is deleted immediately.** Deletes go to Trash for 30 days by default,
  and a parent restores with its children.
- **Bodies are versioned** as you write, and can be restored.
- **Undo** appears after destructive actions and survives a refresh.
- **The database is backed up** weekly, with daily snapshots.
- **\`/health\`** reports whether everything is running.

# Staying up to date

**Updates** (\`/build/updates\`) answers whether this instance is running the
latest Ledgr, and whether its database has caught up with the version it is
running. Those are two separate things, and the page reports them separately.

- **Ledgr version.** Ledgr is one shared codebase running as a separate instance
  per person. If yours is set up as its own copy, new versions wait until you
  take them, and the page lists what changed and offers **Update now**. Pressing
  it pulls the latest version and rebuilds, which takes a minute or two. If your
  instance instead runs directly from the shared codebase, it already receives
  every change automatically and the page tells you so.
- **Database.** Some updates change the database structure. When the code has
  moved ahead of the database, the page names the changes still to apply. That
  gap is the usual reason pages start failing right after an update.

Whether the Update button appears at all is a setting on the instance, because
an update that changes the database needs the database migrated as part of
applying it. When it is not available, the page says why.

The **Changelog** (\`/changelog\`) has the full history behind each version.

# Not here yet

Listed so you do not go looking.

- **Notifications and push are paused.** The notification centre, the bell, and
  the morning and meeting-prep pushes are all switched off. Reminders come from
  the task calendar (ICS) feed instead, fired by your own calendar app.
- **Data Hygiene** (\`/build/hygiene\`) and **Import & Migration**
  (\`/build/import\`) are placeholders. The pages describe the plan; there are no
  actions on them.
- **Light mode** is not shipped. The mechanism exists; the theme does not.
- **Todoist sync is off** and is not the normal setup. Ledgr is its own task
  manager. Todoist remains an option your instance can be configured to use.
- **Footnotes, superscripts and citations** are not in the shared editor.
  Footnotes work only inside the Papers module, which uses a plain text area.
- **Attaching non-image files from the editor** is not wired. Images only.
- **Nested toggles** are a known limitation.
`;
