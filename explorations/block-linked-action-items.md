# Exploration: action items in the note body, promotable to linked tasks

**Status:** parked (Brandon, 2026-06-13). Not intent, not a decision; a likely Phase 3 feature. Raised while reviewing the meeting canvas.

> **⚠️ Affected by ADR-037 (Markdown epoch).** This exploration assumed BlockNote's stable per-block `id`s in the document JSON. With **markdown** now the canonical body, there are no native block ids, so the "link to *that specific block*" anchor needs a markdown-friendly mechanism instead: a heading/line anchor, a positional offset (fragile across edits), or an injected stable marker (e.g. a hidden `<a id>`/comment the editor maintains). The rest of the idea (promote a line to a task, title-from-text, back-link to the meeting) survives unchanged. Revisit the "Is block-level linking buildable?" section against whichever markdown editor is chosen.

## The idea

Today, action items get promoted to tasks through a separate input box on the meeting canvas (`PromoteTask`, slice 24 / ADR-025). Brandon would rather write action items *inline in the note body* (the BlockNote editor) as a normal sentence or bullet, then convert a line to a task with one click:

- The new task's title is taken from the text on that line/block.
- The task links back to the meeting (already how `promoteActionItem` works).
- The task also links back to **that specific block** in the note, so opening the task can jump to where it was written, and the note line shows it's been promoted.

So the flow is "write naturally, promote selectively" rather than "fill a separate form."

## Is block-level linking buildable?

Yes. BlockNote blocks carry stable `id`s in the document JSON. The pieces:

- **Anchor:** store the block `id` on the task (e.g. `properties.source.blockId` + the meeting/item id). No schema change — it rides `properties`.
- **Jump-to-block:** BlockNote can scroll to / focus a block by id on load (or a `#block-<id>` hash the editor host reads). Deterministic, no model.
- **Promote affordance:** a slash command (`/task`) or an inline gutter button on a block that POSTs the block's text to a "promote this block" endpoint (a thin wrapper over the existing `promoteActionItem` plus the blockId), then marks the block (e.g. a check/inline badge) so it reads as promoted.
- **Back-reference in the note:** render a small "→ task" affordance on a promoted block, resolved from the relation.

## Constraints to honor if built

- Deterministic (rule 3): title-from-text and the link are plain code; no model decides what's an action item.
- Everything is an item (rule 2): the promoted task is a normal `task` row related to the meeting; the block link is `properties`, not a new table.
- Reuse `promoteActionItem` / the relations write path rather than a parallel mechanism.
- BlockNote stays lazy-loaded (rule 8); the jump-to-block logic lives in the editor host, not the server render.

## Open questions

- One block ↔ one task, or allow several? What happens to the link if the block is deleted or edited after promotion?
- Does promoting also strike or badge the source line, or leave it untouched?
- Should the `/items/[id]/print` (Save Offline) render show promoted-task markers, or stay clean?
- Is this the moment the meeting-prep "Agenda" frame becomes an *insertable* template (drop the agenda headings into the body as real blocks), tying #3 and #4 together?
