# Exploration: action items in the note body, promotable to linked tasks

**Status:** ✅ **BUILT (2026-06-18, ADR-090).** Shipped as the Obsidian-style trailing `^id` marker + per-line "→ task" promotion on checkbox lines (title from the line, body from de-indented sub-bullets), stored as `properties.source.blockRef`, stripped from share/print. Round 2 (same day) also shipped the read-side promoted-line **badge** (links to the task, suppresses re-promote), the `#^id` **deep link** (scroll + a plugin-managed flash), a **"Copy link to this line"** toolbar button (any line, the "Extension" section below), and a **task → source-line back-link**. Only the **public-share** `#^id` anchor (`/share/<token>#^id`) remains open. Kept for the record. *(Originally: parked, Brandon 2026-06-13 — raised while reviewing the meeting canvas.)*

> **⚠️ Affected by ADR-037 (Markdown epoch).** This exploration assumed BlockNote's stable per-block `id`s in the document JSON. With **markdown** now the canonical body, there are no native block ids, so the anchor needs a markdown-friendly mechanism. **Resolution (Brandon, 2026-06-13): adopt Obsidian's approach.** The rest of the idea (promote a line to a task, title-from-text, back-link to the meeting) survives unchanged.
>
> **Obsidian-style block ids (the chosen direction).** Obsidian links to a specific block by appending a short marker to the end of that line/paragraph in the source markdown — e.g. `This is the action item. ^a1b2c3` — and references it as `[[note#^a1b2c3]]`. The marker is plain text, auto-generated on first link, nearly invisible in reading view, and travels with the file. We mirror it:
> - **Anchor:** on promote, ensure the source line has a `^id` marker (insert a random short id if absent); store that id on the task (`properties.source.blockRef` + the item id). No schema change — rides `properties`, same as before.
> - **Jump-to:** the editor scrolls to / highlights the line carrying `^id` (a `#^id` hash the editor host reads), deterministic, no model.
> - **Resilience:** the marker persists through edits to the line's text; deleting the whole line dangles the link (handle gracefully, same as Obsidian). This replaces the old "BlockNote block id" plumbing below.
> - **Editor requirement:** whichever editor M1 picks should be able to render/preserve a trailing `^id` marker (and ideally hide it in WYSIWYG view) — noted as an M1 evaluation criterion.

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

## Extension: deep links to a specific canvas line (and public sharing of them)

*Added 2026-06-14.* The same `^id` block-anchor mechanism supports a broader use case: **linking directly to a specific line in any item's canvas**, not just as a back-reference from a promoted task.

**In-app deep link:** `ledgr://item/<uuid>#^a1b2c3` (or `/items/<uuid>?block=a1b2c3`) would open the item and scroll the editor to the anchored line. Useful for referencing a specific decision in a long meeting note, a paragraph in a paper, or a line in a sermon draft — from another item's body, from a task, or from an MCP tool response.

**Public share link to a specific line:** extend the share-token system (ADR-035) to include an optional `#^id` anchor. The public share page (`/share/[token]`) already renders the full document; it would additionally scroll to and highlight the anchored block on load. The URL would look like `/share/[token]#^a1b2c3`.

**Constraints to honor:**
- The anchor is only valid if the `^id` marker still exists in the body; a graceful fallback (open the item at the top, no error) handles the dangling case.
- Generating the shareable anchor URL lives on the canvas — a "Copy link to this line" affordance that appears on hover/tap next to a block (similar to GitHub's line-link icon). It ensures the `^id` marker exists before copying the URL.
- Rule 4 (Sunday-proof): the print view and the Pulpit Ready pin don't need to honor anchors — static documents don't scroll.

## Open questions

**Resolved (Brandon, 2026-06-15) — design direction set; build still pending behind dashboards/views + image-paste.**

- **One block ↔ one or many tasks?** → **One line is one task.** Keep the model simple; no fan-out from a single line.
- **Badge or strike the promoted line?** → **Badge it, and the badge links to the task.** Reading the meeting notes, a promoted line shows a small marker; clicking it jumps to the task. (Not a strike — the line still reads as part of the notes.)
- **Show promote markers in the Save Offline / print / share render?** → **No, stay clean.** Promotion is a "me thing," a private workflow aid, not something to publish. The badge is editor-only.
- **Does the agenda frame become an insertable template here?** → still open; revisit when this is built.

**Clean-share constraint (Brandon, 2026-06-15) — note for the build.** The promotion machinery (the `^id` markers and the editor-only badges) must never get in the way of sharing a *clean* version of meeting notes with people who don't use Ledgr, whether via a share link or a PDF/Word export. Two implications already point this way and must hold: (1) the `^id` anchor markers should be invisible in reading view and stripped (or rendered as nothing) in the print/share/export output, not shown as literal `^a1b2c3` text; (2) the promoted-task badges are an editor-only affordance and never render on the shared/printed document (the "stay clean" answer above). Treat "the shared artifact looks like ordinary, clean notes" as an acceptance criterion for this feature.

## Implementation note (the anchor mechanic) — 2026-06-15

The one load-bearing technical risk is that **Tiptap (`@tiptap/markdown`) must round-trip a trailing `^id` marker** through serialize/parse without mangling it (and ideally hide it in WYSIWYG view). Verify this with a small spike before committing to the build. The rest reuses existing paths: `promoteActionItem` + the relations write path (ADR-025), `properties.source.blockRef` for the anchor (no schema change), and the editor host's jump-to-line on a `#^id` hash.
