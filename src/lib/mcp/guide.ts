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

// resources/read: return the guide's contents for our one URI, else null so the
// dispatcher can answer an unknown URI with an error (never throwing it out to
// the transport).
export function readGuideResource(
  uri: string
): { uri: string; mimeType: string; text: string } | null {
  if (uri !== GUIDE_URI) return null;
  return { uri: GUIDE_URI, mimeType: "text/markdown", text: WORKSPACE_GUIDE };
}
