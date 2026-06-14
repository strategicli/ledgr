# Exploration: storage & organization model (per type, in-app and as exported files)

**Status:** parked, open question for Brandon + Tyler to wrestle together (2026-06-14)
**What this doc is:** a captured fork-in-the-road idea. Not PRD intent, not a decision. If a direction here is chosen, it graduates to an ADR in `decisions.md` (and likely touches `schema.md`, so it's **core** — both-agree + ADR). Distinct from `local-first-split.md`: that note asks *whether the DB stays canonical*; this one assumes it does (rule #1) and asks *how items are organized* — both inside Ledgr and in the one-way export.

## The question as raised

> "Storage/organization is a huge question for Tyler and me to explore together. How do we want each type organized/stored? Notes (sub-pages, folders, tags?). Tasks by project/sub-task? On and on. It matters less in the app, but if we ever want to revert to a local copy of the data (use the OneDrive export to view everything as MD files through something like Obsidian), these questions matter: how should Ledgr organize those files? Will wiki-linking be enough? If we lean on that, all the connections/associations within Ledgr need to map nicely into wiki-links inside the MD files. Maybe we organize differently per type? Notes make sense with folders and/or sub-pages; meetings make less sense. Maybe meetings live in folders by date (year → month) to prevent a GIANT pile of MD files."

## Two states to design for

There are **two distinct states**, and a single organization model has to serve both:

1. **Within Ledgr** — how a user navigates and files content live: sub-pages, folders, tags, archives, by-project nesting for tasks. This is real work to design even ignoring export (notes-in-folders, sub-pages, archive semantics all need answers).
2. **On local files** — if the OneDrive export (PRD §5.4) is ever opened in Obsidian or worked on directly, how is the file tree laid out, and do Ledgr's relations survive as wiki-links?

The point raised: these are **separate concerns that interact**. The in-app model can be richer than flat files; the export has to flatten it into a folder tree + links without losing the connections.

## The core tension: relations vs. a file tree

Everything-is-an-item (rule #2) means structure lives in **`relations`**, not in a folder path. A file tree is a single hierarchy; Ledgr's graph is many-to-many (an item belongs to a project *and* references three people *and* links to a meeting). So the export has to choose, per relation kind:

- **Path** (folder placement) — at most one parent; good for the *primary* home of an item.
- **Wiki-link** (`[[...]]` in the body/frontmatter) — many-to-many, survives flattening; the natural carrier for everything that isn't the one primary parent.

Open sub-questions:
- Does every Ledgr relation map cleanly to a wiki-link, and is that **enough** to reconstruct the graph from files alone? (If we lean on wiki-links, this has to be true — the mapping is the deliverable.)
- What is each item's *one* canonical path (its folder home), given it can have many relations?
- How do backlinks, query views, and entity canvases — which have no file analog — degrade? (Same unsolved edge as `local-first-split.md`'s "relations don't live well in flat files.")

## Per-type organization (the likely answer is "it varies")

The raised intuition is that **organization should differ by type**, which fits bespoke-first (rule #6):

- **Notes** — folders and/or sub-pages (a note can parent another note). Maps to nested directories naturally.
- **Tasks** — by project, with sub-tasks. Project = folder or a relation; sub-task = nesting or a relation.
- **Meetings** — *not* a flat pile. Folder-by-date (`2026/06/`) keeps thousands of meetings navigable on disk. Date is a deterministic, collision-free path with no user filing decision.
- **Songs / Papers / other bespoke types** — each may want its own scheme (songs by collection? papers by status/project?).

If organization is per-type, the **export layout is a per-type concern** too: each type (or its module, per the M6 module boundary) could declare how it lays its items out on disk — the same way a type declares its canvas. That keeps this out of core plumbing and inside each module.

## Implications for AI

Two AI surfaces, both shaped by these decisions:
- **AI within Ledgr** (MCP) — reads via the API; organization shows up as how it filters/navigates (by project, by date, by relation).
- **AI on local files** — if Claude Code ever edits the exported MD directly (`local-first-split.md` option A/B), the folder layout and wiki-link fidelity *are* the interface it works through. A clean, predictable per-type layout makes that path viable; a messy one makes it fragile.

## What to resolve before building

- **In-app first, export second.** The in-app model (sub-pages, folders, tags, archive) is needed regardless and is lower-risk; design it first, let the export layout follow from it.
- **Decide the relation → (path | wiki-link) mapping explicitly.** This is the crux. One primary parent → path; everything else → wiki-link; verify the link set is sufficient to rebuild the graph.
- **Per-type layout lives with the type/module, not in core export plumbing** (M6 boundary), even though the *contract* (how a type declares its layout) is core and needs the both-agree + ADR.
- **Cheap test:** export one item of each type with its relations, open the tree in Obsidian, and check whether the connections are navigable as links. Mirrors the round-trip prototype in `local-first-split.md`.

## Relationship to other parked work

- **`local-first-split.md`** — that's the *source-of-truth* fork (DB vs. files canonical); this is the *organization* question that any export has to answer even while the DB stays canonical. If local editing (its option A/B) ever opens, this note's layout decisions become prerequisites. See [[local-first-split]].
- **`project-items.md`** — tasks-by-project is partly that note's territory; the project model and the task folder/relation layout should be decided together. See [[project-items]].
- **`entity-vs-custom-type.md`** — relations are the thing being mapped to wiki-links; revisit alongside the `relation` property kind. See [[entity-vs-custom-type]].
