// The workspace-shaping orientation guide, served as an MCP *resource* (ADR-102).
// It is the stable, human-written picture of how a Ledgr workspace is structured
// and how to shape it correctly — the same orientation a person gets from the
// Build sidebar, written down once so the model gets it too. This is the
// counterpart to the per-owner, per-call `describe_workspace` tool: the guide is
// the unchanging "how it works," describe_workspace is the live "what you have."
//
// Pure (no DB, no Next, no env): a constant doc + its resource descriptor + a
// reader. server.ts wires it into resources/list and resources/read, the same
// split protocol.ts/server.ts/tools.ts keep elsewhere. Keep it client-agnostic
// (any MCP-speaking AI may read it) and free of church-specific jargon, like the
// rest of the tool surface.

// A stable, opaque URI for the one guide resource. `ledgr://` keeps it clearly
// ours; the path names the topic so a future second guide is an additive sibling.
export const GUIDE_URI = "ledgr://guide/workspace-shaping";

// The resource descriptor returned by resources/list (and echoed in
// resources/read). Shape matches the MCP spec's Resource: uri + name (+ optional
// title/description/mimeType). The description doubles as the model-facing hint
// for *when* to read it.
export const GUIDE_RESOURCE = {
  uri: GUIDE_URI,
  name: "workspace-shaping-guide",
  title: "Shaping the Ledgr workspace",
  description:
    "How a Ledgr workspace is structured — types & properties, views, " +
    "dashboards & widgets, and the navigation — and how to shape it correctly " +
    "over MCP. Read this before using describe_workspace and the create_type/" +
    "update_type, create_view/update_view, create_dashboard/add_widget, and " +
    "update_nav tools.",
  mimeType: "text/markdown",
} as const;

// The AI Memory protocol (ADR-137), a second resource served only when the owner
// has AI Memory on (server.ts gates resources/list + resources/read on
// settings.aiMemoryEnabled). It is the "how to recall and when to remember"
// counterpart to the get_memory_stumps/remember tools — the rising-bar recall
// rule and the write conventions, written once so any connected AI follows them.
export const MEMORY_PROTOCOL_URI = "ledgr://guide/memory-protocol";

export const MEMORY_PROTOCOL_RESOURCE = {
  uri: MEMORY_PROTOCOL_URI,
  name: "memory-protocol",
  title: "Working with the owner's memory",
  description:
    "How to use the owner's AI memory: call get_memory_stumps at the start of a " +
    "session, recall by following a memory's links with a bar that rises each " +
    "hop, and use `remember` to file durable facts well. Read this whenever AI " +
    "Memory is enabled.",
  mimeType: "text/markdown",
} as const;

// The guide body. Written as the orientation a builder would give a teammate:
// the mental model first, the read-before-write rule, then one section per
// shapeable surface naming the exact tool + the drill-down read for detail.
export const WORKSPACE_GUIDE = `# Shaping a Ledgr workspace

This guide is for an AI assistant helping the owner *shape* their Ledgr: creating
and editing types, views, dashboards, and navigation so they don't have to learn
the Build screens themselves. The owner speaks naturally ("set up my main
toolbar", "make me a place to track sermons") and you make the Ledgr-correct
moves.

## The mental model

Ledgr stores everything the owner cares about as **typed items** (one \`items\`
table): tasks, events, notes, links, people, and any custom type are all rows.
The app has **two surfaces**:

- **Work** — *using* the system day to day. Glanceable, mobile-friendly. Its
  navigation (the bottom bar / side rail) is owner-configurable.
- **Build** — *building and maintaining* the system: the data model (types),
  the interfaces (views, dashboards, navigation), and maintenance tools.

Shaping the workspace means building on the Build side, and wiring it into Work
so the owner can reach it. The separation is the default, not a wall: a Work nav
slot may point at a Build tool if the owner wants it.

## The one rule: read before you write, and confirm

1. **Call \`describe_workspace\` first.** It returns a compact snapshot of the
   current types, views, dashboards, and navigation, plus the catalog of Build
   tools a nav slot can point at. It is your orientation — never shape blind.
2. **Drill down only as needed.** The snapshot is summaries. For a type's full
   property schema call \`list_types\`; for a view's full filter/sort call
   \`list_views\`. Pull detail for the one thing you're about to change, not
   everything.
3. **Confirm before committing.** Config changes (a new type, a nav rearrange)
   have no automatic undo. State the concrete change you're about to make and get
   the owner's go-ahead before calling a create/update tool. Nothing here
   auto-commits — you decide to call a tool, deliberately, on the owner's behalf.
4. **These tools create and update only.** There is no delete tool. Removing a
   type/view/dashboard stays in the Build UI on purpose. (Editing a type to hide
   a property, or rebuilding a view, is fine and reversible by re-editing.)

## Types & properties (\`create_type\`, \`update_type\`)

A type is a kind of item with its own set of **custom properties**. Property
kinds: \`text\`, \`number\`, \`date\`, \`checkbox\`, \`url\`, \`select\` and
\`multi_select\` (each needs an \`options\` list), and \`relation\` (a typed link
to other items — carries a \`targetType\` and \`cardinality\` of \`single\` or
\`many\`).

- The five **system types** — task, event, note, link, person — can be *edited*
  (e.g. add a property) but never deleted.
- A type's \`key\` is a lowercase slug, immutable once created (it is the stable
  identifier behind every item and relation). The \`label\` is the display name
  and can change freely.
- \`update_type\` replaces the type's editable fields wholesale. To add one
  property, read the current schema (\`list_types\`), then resend the **full**
  \`propertySchema\` with your addition appended — otherwise you drop the rest.
- Prefer one well-shaped bespoke type over many tiny ones. "Make me a place to
  track sermons" = a \`sermon\` type with the few properties that matter
  (e.g. a \`series\` select, a \`date\`, a \`passage\` relation), not a pile of
  loose tags.

## Views (\`create_view\`, \`update_view\`)

A view is a saved, filtered, sorted list the owner reaches by name ("This week's
tasks", a workflow board). Each has a **layout**: \`list\`, \`table\`, \`board\`
(kanban, grouped), \`calendar\`, or \`agenda\`. The **filter** can scope by type,
status, a due/scheduled/meeting date window, a related item, or a custom
\`select\`/\`multi_select\` property.

- \`create_view\` needs a \`name\` and \`layout\`; the filter/sort/grouping are
  optional and default sensibly.
- \`update_view\` is a full replace (read it via \`list_views\` first); **system
  views can't be edited.**
- Use \`run_view\` to see what a view currently returns before or after editing.

## Dashboards & widgets (\`create_dashboard\`, \`add_widget\`)

A dashboard is a named grid of **widgets**. Widget kinds:

- \`view\` — a live list/board/etc. from a saved view (needs a real \`viewId\`).
- \`stat\` — a single count from a view's filter (needs a real \`viewId\`).
- \`action\` — a button: quick-capture, new-from-template, or a link.
- \`text\` — a heading/note for grouping the grid.

Because view/stat widgets reference a saved view, **create the view first**, then
add the widget pointing at its id. Widgets auto-place on the grid when you don't
specify a layout. Create the dashboard (optionally with widgets inline), then
\`add_widget\` to append more.

## Navigation (\`update_nav\`)

The Work nav has three zones: a locked **Home** (always first), the configurable
**middle slots**, then locked **New** and **More** (added automatically). You
shape the middle slots. A slot is either:

- a **destination** — one route: a built-in page, a saved view
  (\`/views/<id>\`), a type's list (\`/list/<key>\`), a dashboard, or a Build
  tool; or
- a **tools group** — a labelled button opening a small popover of destinations.

\`describe_workspace\` reports the current slots, the nav layout (position
top/bottom/left/right, rail size, density, anchor), and the Build-tool catalog.
\`update_nav\` sets the slots and/or those layout knobs. Keep slot counts modest
(≈4–5) — the bottom bar and floating pill are tight.

Worked example — "set up my main toolbar": call \`describe_workspace\`, see the
current slots and that the nav can be a side rail or a bottom/floating bar, ask
the owner which surface they mean and what they want one-tap access to, propose a
short slot list, then \`update_nav\`.

## Language

Use plain, conventional product language for anything that will render on screen
(labels, view names, slot labels) — write as if for a general audience, not
insider shorthand. The owner is one person, but the workspace should read like a
clean, portable product.
`;

// The AI Memory protocol doc (ADR-137). Model-facing, same voice as the guide:
// the shape, how to recall (the rising-bar graph walk), and when/how to write.
export const MEMORY_PROTOCOL_GUIDE = `# Working with the owner's memory

The owner keeps durable memories in Ledgr so you — and any AI they connect — act
like you know them. This is that contract: how to recall what's stored, and when
and how to store something new. It's deterministic plumbing: you decide what
matters, Ledgr just holds it.

## The shape

A **memory** is a small item: a one-line *stump* (its title) plus optional detail
in its body, filed under a \`kind\` and a \`horizon\`, and *linked* to the people,
projects, and notes it's about. The links are the point — a memory about a person
is a doorway into everything related to that person.

Two layers:
- **Stumps (always-on):** call \`get_memory_stumps\` at the start of a session. It
  returns a compact, body-free index (titles + links, no detail). Cheap to carry.
  It exists so you *know what exists*, not so you act on all of it.
- **Bodies + graph (on demand):** when a stump is relevant, \`get_item\` it for the
  detail, and follow its \`linked\` items into the wider graph.

## Recall: follow the graph, with a rising bar

When something in the conversation matches a stump, pull it. Then decide how far
to walk:

- Follow a link only when the linked item looks likely to **change what you'd say
  or do** about the current objective.
- That bar **rises with each hop** out from the first memory: hop one is cheap,
  hop two needs a clearer reason, hop three a strong one.
- **Relevance outranks distance:** a dead-on item two hops away beats an off-topic
  neighbour one hop away.
- **Stop at diminishing returns** — when the next item repeats or drifts, not at a
  fixed count. A rich thread may be worth five pulls; a thin one, none.

Loading a stump is not a reason to use it. If the owner mentions someone about a
budget, a "they enjoy cycling" stump stays unused. Awareness is cheap; the pull
is a judgment.

## Remember: when and how

Call \`remember\` whenever you learn something durable worth carrying into a later
session: a working preference ("always put the logo on Word exports"), a fact
about a person or a standing relationship, or a project decision that isn't
obvious from the items themselves.

Do it well:
- **Title = a self-contained stump.** It loads always-on and often stands alone;
  make it readable without opening anything.
- **Body = the detail,** with a *why* and a *how to apply* when it helps.
- **Set \`kind\` and \`horizon\`.** kind: user (who they are) | feedback (how to work
  with them) | project (ongoing work) | reference (a pointer). horizon: evergreen
  (always true) | seasonal (true for a while) | episodic (a moment). Seasonal and
  episodic age out of the always-on set; evergreen stays.
- **Link, don't restate.** Pass the item ids the memory is about in \`about\`
  (search_items to find a person/project id) rather than repeating what Ledgr
  already holds. The links are what make recall serendipitous.
- **Pin sparingly.** \`pinned\` forces a stump always-on regardless of horizon —
  reserve it for the few facts that must never be missed.

## Maintain the store: revise, don't pile up

A memory store is only useful while it stays clean. Before you \`remember\`
something, check the stumps you already loaded: if one covers the same ground,
**update it instead of filing a near-duplicate**. Updating is ordinary item
work — the memory is a normal item.

- **Update over duplicate.** Found an existing memory on this topic? \`update_item\`
  its title/body rather than creating a second one that says almost the same
  thing. Two stumps on one subject is worse than one good stump.
- **Enrich links as you learn.** When a memory turns out to be about a person or
  project it isn't yet linked to, add the link (\`relate_items\`) rather than
  restating the connection in prose.
- **Keep a confirmed seasonal memory alive.** If a seasonal/episodic memory is
  still true when it comes up, \`update_item\` it (even a no-op touch) so it stays
  in the always-on set; let one that's genuinely gone quiet age out on its own.
- **Correct what's wrong; flag what's stale.** If a memory is now inaccurate,
  fix it in place. If a memory should be **removed** entirely, say so to the
  owner and let them delete it — don't silently drop durable facts.
- **Prefer few, dense memories.** One well-linked stump that captures a standing
  relationship beats five thin ones. When you notice overlap, merge into the
  strongest memory and update the rest away.

## What is *not* a memory

A one-time event ("met for coffee on the 3rd") is usually better as an ordinary
item (a note or event with the person linked), not a memory. Memories are the
durable distillations; the item stream is the record. File the event and let the
relation graph resurface it. Don't remember what's already a well-linked item —
link to it instead.

## Routing

This Ledgr is the memory store. When the owner asks you to remember something,
\`remember\` it here — don't fall back to a local notes file or a provider's own
memory. One store, reachable from every client the owner connects.
`;

// resources/read: return the contents for a known guide URI, else null so the
// dispatcher can answer an unknown URI with an error (never throwing it out to
// the transport). The memory protocol is additionally gated by the caller
// (server.ts) on aiMemoryEnabled before this is reached.
export function readGuideResource(
  uri: string
): { uri: string; mimeType: string; text: string } | null {
  if (uri === GUIDE_URI) {
    return { uri: GUIDE_URI, mimeType: "text/markdown", text: WORKSPACE_GUIDE };
  }
  if (uri === MEMORY_PROTOCOL_URI) {
    return { uri: MEMORY_PROTOCOL_URI, mimeType: "text/markdown", text: MEMORY_PROTOCOL_GUIDE };
  }
  return null;
}
