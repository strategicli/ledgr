# Exploration: richer notes organization

**Status:** parked (Brandon, 2026-06-14). Not intent, not a decision. Raised from real mobile use — notes currently feel flat.

## The problem

Notes right now are a flat list, filterable by text search. That's fine for a small count, but as notes grow it becomes hard to find things. Brandon wants Evernote-level organizational power: hierarchy, grouping, and multiple ways to browse.

## Organizational primitives to consider

**Hierarchy / nesting:**
- **Sub-pages.** A note can contain other notes as children (parent/child via the existing `parent_id` on `items`). Already structurally possible; what's missing is the UX: a "New sub-page" affordance, an indented tree view, and breadcrumb navigation.
- **Folders / notebooks.** A named container that groups notes without making them structurally children of a single item. Could be a lightweight entity kind ("Notebook"), or a dedicated `folder` relation type. Notion's approach: pages nested under pages (sub-pages). Evernote's approach: flat notebooks + stacks. Ledgr already has entities; a "Notebook" entity with notes related to it is a natural fit and doesn't require a new primitive.

**Tagging and categorization:**
- **Tags.** A many-to-many label, lower overhead than a folder (a note can be in multiple tags). Could ride the existing `properties.tags` multi-select field on the `note` type, or use an actual entity/relation. The type builder already supports `multi_select` properties; a `tags` multi-select on `note` is the minimal version.
- **Categories.** A single-select grouping (closer to Evernote notebooks — one category per note). Simpler than tags; could be a `category` select property on the `note` type.

**Views and browsing:**
- **Tree view.** A hierarchical sidebar list (like Notion's sidebar or Obsidian's file explorer) for notes that have parent/child structure.
- **Tag cloud / filter by tag.** A tag sidebar or filter chip row so you can one-tap filter to a tag.
- **Recently modified.** A distinct sort in the notes list.
- **Pinned notes.** Surface important notes at the top of the list regardless of recency.

## What Ledgr already supports

- `parent_id` for hierarchy (sub-pages are structurally possible).
- `items` related to entities via `relations` (a "Notebook" entity → relate notes to it).
- Custom properties on types (a `tags` multi-select on `note` is a few clicks in the type builder today).
- View builder with filters/sorts (a "tag = X" view is already buildable).

So most of this is **a UX layer on top of existing infrastructure**, not new primitives.

## Constraints

- **Everything is an item (rule 2).** Folders and notebooks must be items (entities with a kind, or a `note` with children), not a parallel table.
- **Owner-scoped (rule 7).** All queries stay owner-scoped.
- **Body-free lists (working convention).** Any tree or folder view still excludes `body` from list queries.

## Likely direction (not decided)

The cheapest useful step: add `tags` (multi-select) and `category` (select) as built-in properties on the `note` type (rather than requiring manual type-builder setup), and improve the notes list with filter chips for those properties. Sub-page nesting via `parent_id` is already wired; exposing it as a "New sub-page" button on the note canvas is the second step. A full Evernote-style notebook sidebar is a later slice.

## Open questions

- Tags vs categories: both, or pick one? Evernote has both (stacks + notebooks + tags); Notion has neither (just nesting). Tags are more flexible; categories are simpler. Brandon's preference TBD.
- How should a "Notebook" entity differ from an ordinary entity? (Probably just kind = "Notebook" and the canvas shows its related notes in an embedded view — no new type needed.)
- Does the notes tree live in the sidebar, in the notes list page, or both?
- How do pinned notes interact with the dashboard widget system (a "pinned notes" widget)?
