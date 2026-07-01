# AI Memory — connecting your assistant to your Ledgr memory

Ledgr can hold the durable memories an AI assistant uses to act like it knows you,
so that memory lives in **your** system (portable across AI vendors) instead of a
provider's private store. This is the setup + operating guide. Feature background
is in ADR-137.

## What it is

- **Memories** are a hidden `memory` item type. Each is a short *stump* (the title)
  plus optional detail (the body), filed under a `kind` and a `horizon`, and
  **linked** to the people / projects / notes it's about. The links are the point:
  a memory about a person is a doorway into everything related to that person.
- **Two layers.** The assistant loads a compact **stump index** at the start of a
  session (`get_memory_stumps`) so it knows *what exists*, then pulls a memory's
  body + follows its links only when relevant.
- **Two MCP tools** (`get_memory_stumps`, `remember`) + one resource
  (`ledgr://guide/memory-protocol`, the recall + write rules), all exposed **only
  when you turn AI Memory on**.

## Turn it on

User Settings → **AI Memory** → "Use Ledgr to manage AI memory". Off by default:
until then a connected AI sees no memory tools and behaves exactly as before. Once
on, manage memories at **Build → AI Memory** (browse the stumps, open/edit, add),
and see the connection details at **Build → AI & MCP**.

## Tell each AI to use it

Ledgr exposes the tools, but a client only *carries the stumps every session* if
its own instructions say so. MCP is pull, not push — so add this short stanza to
each AI surface's persistent-instructions slot. The store is one and the same
(your Ledgr, over MCP); only this note is repeated per surface.

- **Claude Code, all projects:** `~/.claude/CLAUDE.md` (user-level).
- **claude.ai web / iOS / Android:** the personal preferences / custom-instructions box.
- **Any other provider:** its system-prompt / custom-instructions field.

The stanza (paste as-is):

```
## Ledgr memory
I keep my durable memories in Ledgr, reachable through its MCP server.
- At the start of a session, call `get_memory_stumps` and read the
  `ledgr://guide/memory-protocol` resource. The stumps tell you what I've asked
  you to remember; a stump is a pointer — pull the memory (and follow its links)
  only when it's relevant to what we're doing.
- When you learn something durable and worth carrying forward — a working
  preference, a fact about a person, a project decision — file it with `remember`
  (a self-contained title, detail in the body, set kind + horizon, link the
  people/projects it's about). Save memories to Ledgr, not to a local file or
  your own memory.
```

That's the only per-surface step; everything else (the recall discipline, the
write conventions) lives in the `memory-protocol` resource the assistant reads.

## Facets that shape the always-on set

- **`kind`** — what a memory is about: `user` (who you are) · `feedback` (how to
  work with you) · `project` (ongoing work) · `reference` (a pointer/resource).
- **`horizon`** — how long it stays true: `evergreen` (always) · `seasonal` (a
  while) · `episodic` (a moment). Evergreen (and pinned) memories always load;
  seasonal/episodic age out of the always-on index after ~45 days but stay
  searchable and pullable.
- **`pinned`** — force a stump always-on regardless of horizon/age. Use sparingly.

You can add your own properties to the `memory` type in Build → Types; the stump
index ignores unknown properties (they still show on the item).

## Portability

The memories are ordinary Ledgr items: they ride the OneDrive export and the
weekly backup, and any AI that speaks MCP (or reads the database) can use them. If
you ever move off a given AI vendor, you re-paste the stanza above into the new
client — the memory itself never moved.
