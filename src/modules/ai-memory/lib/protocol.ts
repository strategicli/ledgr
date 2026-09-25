// The AI Memory protocol, served as an MCP resource only while the ai-memory
// module is on (ADR-137; moved out of src/lib/mcp/guide.ts in ADR-272 step 4).
// Pure text. The module's server.ts attaches it as an `mcpResources` entry, and
// the MCP server (src/lib/mcp/server.ts) lists and reads it from there, so core
// never names this module.
// The AI Memory protocol (ADR-137). It is the "how to recall and when to remember"
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

// The AI Memory protocol doc (ADR-137). Model-facing, same voice as the guide:
// the shape, how to recall (the rising-bar graph walk), and when/how to write.
export const MEMORY_PROTOCOL_GUIDE = `# Working with the owner's memory

The owner keeps durable memories in Ledgr so you, and any AI they connect, act
like you know them. This is that contract: what loads on every run, how to reach
the rest, and when to write something new.

## Two axes, often confused

- **\`horizon\` is a truth property.** Does this claim stay true as time passes?
  \`evergreen\` = true indefinitely. \`seasonal\` = true for a season, expected to
  stop being true. \`episodic\` = true of a single moment. **Horizon never decides
  what loads.** Reserve \`evergreen\` for identity, convictions, standing
  preferences, and how-to-work-with-the-owner rules. Anything that carries a
  hostname, URL, port, version number, roster, price, or the current state of an
  install or project is \`seasonal\`, even when it feels permanent: an evergreen
  memory is never flagged STALE, so a misfiled one hides its own decay forever.
- **\`pinned\` is a load property.** Must you have this in front of you on every
  single run? That is the only question pinning answers.

They are independent. A fact can be permanently true and almost never needed
(evergreen, unpinned). A fact can be temporary and needed constantly (seasonal,
pinned).

## Tier 1: pinned, always loaded

\`get_memory_stumps\` returns the pinned set by default, a handful of items.
This is the CLAUDE.md equivalent: standing behavioral rules with **no
entity to search on**, so search can never reach them. Three of the current ones:

- On Windows, hand the owner PowerShell commands, never cmd.exe or bash syntax.
- The owner's tool map: which system holds documents, which holds calendar and
  email, which holds tasks and notes.
- The owner's writing style guide.

What they share: you need them cold, on every run, and no search term would
surface them. Keep the pinned set under 15. If a memory would come back from
searching a person, project, or system by name, it belongs in Tier 2.

## Tier 2: everything else, retrieved on demand

Everything unpinned is found by search, anchored on whatever entity the current
task mentions.

**When you meet an unfamiliar person, project, or system, run \`search_items\`
for it by name with \`type: "memory"\` before assuming you know nothing about
it.** Without the type filter, memories get buried under notes, transcripts, and
commentaries.

\`get_memory_stumps\` with \`includeAll: true\` returns the whole store in the same
compact form when you want the full picture.

## Reading a stump

One compact line per memory: a short id, \`[kind/horizon]\` abbreviations, the
date and relative age from \`updatedAt\`, then the title. A \`seasonal\` or
\`episodic\` memory older than 90 days also renders \`STALE\` in that parenthetical.
A memory that a newer one replaced renders \`SUPERSEDED <date> -><new id>\`
instead: read the new one, not this one. Both markers also appear on memory hits
from \`search_items\`, in the \`age\` field.

A stump is a body-free pointer. \`get_item\` its id for the detail and the people,
projects, and notes it links to. Nothing is ever auto-deleted: "this was true
once" is worth keeping.

## Writing a memory

Call \`remember\` when you learn something durable worth carrying into a later
session: a working preference, a fact about a person or a standing relationship,
or a project decision that is not obvious from the items themselves.

- **Title = a self-contained stump.** Readable without opening anything.
- **Body = the detail,** with a why and a how-to-apply when it helps.
- **Set \`kind\` and \`horizon\`.** kind: user (who they are) | feedback (how to work
  with them) | project (ongoing work) | reference (a pointer). horizon by the
  truth test above, not by how often you expect to need it.
- **Link, don't restate.** Pass the item ids the memory is about in \`about\`
  (\`search_items\` to find a person or project id) rather than repeating what
  Ledgr already holds. The links are what make recall reach further.
- **Pin only for Tier 1.** Needed cold, every run, unreachable by search.

## File new, don't rewrite history

**Never edit an old seasonal memory to keep it accurate.** When the situation
changes, file a NEW dated memory and pass the old one's id as \`supersedes\`.
The old memory stays (nothing is deleted), and from then on its stump and its
search hits render \`SUPERSEDED <date> -><new id>\`, so no reader has to compare
ages to find the current claim. Edit in place only to fix something that was
wrong when it was written, not because the world moved on. To link a pair after
the fact: \`relate_items(oldId, newId, role: "supersedes")\`.

Before filing, check for an existing memory covering the same ground: an
evergreen fact that just needs sharpening is an \`update_item\`, not a second
near-identical stump. \`remember\` helps: its response lists \`possibleOverlap\`
(existing memories with a similar title) and, when you passed no \`about\`,
\`aboutSuggestions\` (people and projects named in the title). Act on both. Add
a missing link with \`relate_items\` rather than restating the connection in
prose.

## What is not a memory

A one-time event ("met for coffee on the 3rd") is an ordinary item with the
person linked, not a memory. Memories are the durable distillations; the item
stream is the record. Don't remember what is already a well-linked item, link to
it instead.

## Routing

This Ledgr is the memory store. When the owner asks you to remember something,
\`remember\` it here, never a local notes file or a provider's own memory. One
store, reachable from every client the owner connects.
`;

