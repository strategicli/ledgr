# Exploration: linked / synced blocks (transclusion)

**Status:** parked (Brandon, 2026-06-18). Not intent, not a decision; a beyond-1.0 idea raised as a brainstorm. The Notion "synced blocks" / Obsidian "embed a note inside a note" pattern.

> **🧩 Core, and it depends on a mechanism we've already chosen.** This touches the canonical body format and its `{format, text}` contract, the `relations` model, the editor/canvas seam, and the export → MD mapping, so if it ever graduates it is **both-agree + ADR** with Tyler. It also **rides the Obsidian-style `^id` block anchor** already adopted in [[block-linked-action-items]] (Brandon, 2026-06-13): block-granularity embedding needs exactly that anchor, and whole-item embedding needs no anchor at all. Read that doc first; this one extends it from "link to a block" to "render a block (or a whole item) inside another body."

## The idea (as raised)

> "Copy a chunk from one item (or its entire MD canvas) and embed it inside another note's canvas. Then if I make changes in either one, it changes on the other side too. Like Obsidian (view other notes inside notes) or Notion (synced/linked blocks). Feasible? How?"

The important first move is to split the ask into two features that look the same on screen but differ enormously in difficulty:

- **Tier A: transclusion (one source, many live views).** The content lives in exactly **one** place. Everywhere else shows a live, resolved *view* of it. Edit the source, every view updates, because there is nothing to "sync": there is one copy and many reads. The embedded view is read-only where it appears; you click through to the source to edit. **This is Obsidian's model** (`![[note]]`, `![[note#^block]]`).
- **Tier B: synced editable blocks (edit from either side).** The "edit on either side" part of the ask. The same content appears in N places and is **editable in all of them**, an edit anywhere propagates everywhere. **This is Notion's model.**

The key realization: **Tier B is Tier A plus write-back.** Both need the same resolver, the same body directive, the same edge. B only adds "the embedded region is editable, and its edits route to the one canonical copy." So there is no separate architecture to design, just a second phase. That makes the feature safe to ship incrementally: A delivers most of the value with little risk, B layers on later.

## Is it feasible?

**Yes.** And less from-scratch than it looks, because four of the load-bearing pieces already exist or are already decided:

1. **Markdown is the canonical body** (`items.body = {format, text}`, ADR-037). An embed is just a directive *in that markdown*, so it is part of the source of truth and round-trips, rather than a side structure.
2. **Block anchors are already chosen** (`^id` markers, [[block-linked-action-items]]). Block-level embedding addresses a block the same way a deep link does.
3. **Body-owned relation edges already exist** (`role = 'mention'` for `@`-mentions, ADR-015). An embed can carry a parallel edge (`role = 'embeds'`) by the same pattern, no new mechanism.
4. **The export target already supports transclusion natively.** Obsidian reads `![[note]]`, `![[note#heading]]`, and `![[note#^blockid]]`. Ledgr is already adopting Obsidian `^id` anchors and wiki-links (see [[storage-organization]]), so an embed exports to a real, working Obsidian embed instead of a dead snapshot.

## How it would work

### The embed is a body directive + a relations edge

When you embed item B inside item A's canvas, two things get written:

- **In A's markdown body:** an embed directive. Reuse Obsidian's embed syntax so it round-trips: `![[B-uuid]]` for a whole item, `![[B-uuid#^a1b2c3]]` for a single block, `![[B-uuid#Some Heading]]` for a heading-bounded section. (Internally the target resolves to a uuid; the human-readable wiki-link title is a render concern, the same open question [[storage-organization]] already tracks for relations → wiki-links.)
- **A `relations` edge** `A --embeds--> B` (mirroring `role = 'mention'`, ADR-015). The directive is the source of truth for *where on the page* the embed sits; the edge is what makes the embed **discoverable without parsing bodies**: backlinks ("what embeds this?"), the Related panel, cascade-on-delete detection, and the cheap "find every dependent of B" query all fall out of the edge for free, honoring the no-`body`-in-list-queries rule.

### Three granularities (all deterministic)

| Embed | Addressing | Range to pull |
|---|---|---|
| Whole item | `![[B]]` | B's entire `body.text` |
| Heading section | `![[B#Heading]]` | from that heading to the next same-or-higher heading (a deterministic slice of B's markdown) |
| Single block | `![[B#^id]]` | the paragraph/line carrying `^id` (the [[block-linked-action-items]] anchor) |

A **pure resolver** (no model, rule 3) expands a directive into rendered content at the point of render. It runs in two places: the editor host resolves live for the WYSIWYG view, and the server resolves for print / share / export. Whole-item and heading-section need no anchor and are the easy first build; single-block reuses the `^id` work.

### Where the shared content lives (the crux for Tier B)

Tier A is unambiguous: the content lives in B's `body`, A just points at it. The interesting question is Tier B, "true" peer-synced blocks where no copy is privileged. Three models:

- **Model 1, source-item transclusion.** Pick one item as the home; others embed a block-range of it, editably. Write-back splices the edited text into the right `^id` range of the home item. Works, but "one note secretly owns the shared block" is a leaky model, and the splice is the fiddly part (see hard parts).
- **Model 2, block-as-item (recommended for true sync).** Promote the shared block to its **own item** (an empty-title `note`, or the Principle-6 catch-all / `unmarked` type, or a small bespoke `snippet` type). Every appearance, *including the place you first wrote it*, becomes `![[that-item]]`. Now there is exactly one canonical home and no privileged copy; editing any embed edits the item; all embeds re-resolve. This is the clean version, and notably **"everything is an item" (rule 2) is what makes it clean**: the principle that looks like it constrains us (one body per item) actually hands us the synced-block model for free. It is also roughly how Notion models a synced block internally (a first-class block with a source and references).
- **Model 3, a `blocks` table.** A parallel store of shared block content. **Rejected**: violates rule 2 (no parallel content tables) and rule 1. Model 2 is the rule-2-compliant version of the same instinct.

So the spine is: **Tier A = Model-1-read-only over existing items. Tier B = Model 2 (block-as-item) + editable embeds.** A "split this block into a synced block" action is just: create the item, move the text into it, replace the original text with an embed directive.

## Honoring the principles

- **Rule 1 (DB canonical, export one-way):** the embed lives in the DB body + edge; export is still a one-way render. No bidirectional file sync.
- **Rule 2 (everything is an item):** no new content table. Tier A reuses existing items; Tier B promotes blocks to items; both carry a normal `relations` edge.
- **Rule 3 (deterministic by default):** resolution and write-back are plain code. No model decides anything.
- **Rule 4 (Sunday-proof):** print / Save Offline / Pulpit Ready PDF must render **flattened** content (see export below), so the offline artifact is self-contained and never depends on resolving a second item at view time.
- **Rule 5 (boring stack):** no new dependency. Reuses markdown, the `^id` anchor, the relations table, and the editor we already must pick.
- **Rule 8 (fast/cheap):** lists never resolve embeds (they never load `body`); embeds resolve only on open/render. Resolution batches one query for all referenced items rather than N round-trips. The edge makes dependents findable without body scans.

## The hard parts (named honestly)

1. **Cycles.** A embeds B embeds A loops forever. Need cycle detection + a depth cap in the resolver, the same posture as the existing `parent_id` ancestor-cycle guard.
2. **Dangling embeds.** Source item or block deleted, or the `^id` marker removed. Degrade gracefully (a quiet "source removed" placeholder, never a crash), exactly the dangling-link posture already chosen in [[block-linked-action-items]]. The `embeds` edge + soft-delete cascade makes detection cheap.
3. **Block-range write-back (Tier B, Model 1 only).** Splicing edited text back into a precise `^id` block range of the home item is the genuinely fiddly bit. Model 2 (block-as-item) sidesteps it: you edit a whole tiny item, no splice. This is a strong reason to prefer Model 2 for true sync.
4. **FTS and revisions.** Don't double-index: the embedding item's `body_text` should index its *own* directive, not the expanded content (B is already in the index under B). Revisions should snapshot A's literal body (the directive), not the expansion, so snapshots stay small and a restore doesn't freeze stale copies of B.
5. **Concurrency (Tier B).** Two surfaces editing one shared block at once. Single-user (rule 7) makes this low-stakes for a long time (one person, occasionally two tabs); last-write-wins with the revisions safety net is almost certainly enough for v1 of B. Name it, don't over-engineer it.
6. **Editor support.** The WYSIWYG (Tiptap is the current candidate) needs an **embed node** that renders resolved content (read-only for A, editable for B) and serializes back to the `![[...]]` directive. This is the same class of editor-evaluation criterion as the `^id` round-trip risk flagged in [[block-linked-action-items]]; verify with a spike before committing.

## Export & Sunday-proofing

Two render targets, two right answers:

- **Obsidian / local MD export** (see [[local-first-split]], [[storage-organization]]): emit the **native `![[...]]` embed**. It round-trips, stays DRY, and Obsidian resolves it live. Best case, and the reason adopting Obsidian's syntax pays off.
- **Pulpit Ready PDF / Save Offline / public share:** **flatten** the embed to static, self-contained content at export time. This is exactly the approach already chosen for embedded query-view blocks ("export as a static snapshot/placeholder," schema.md), so it is a known, accepted pattern, not a new compromise. A sermon that embeds a passage must print the passage text, not a live pointer.

## Likely direction (not decided)

Ship **Tier A (read-only transclusion) first**, on whole-item and heading-section granularity, then single-block once the `^id` work from [[block-linked-action-items]] lands. That is ~80% of the felt value (drop a meeting's decision into a note, a passage into a sermon, a standard checklist into many items) with a single source of truth and almost no failure surface. Treat **Tier B (editable synced blocks via block-as-item)** as a clearly separate, later phase, justified only if "edit from either side" proves to be a real recurring need rather than a nice-to-have.

## Open questions

- **Motivating use cases first.** What does Brandon actually want to embed? A likely strong one: dropping a **passage** item's verse text into a sermon body (a natural transclusion of the [[scripture-passages-as-entities]] hub, ADR-060). Another: a reusable checklist/boilerplate across many items. Pin the real uses before building, they decide whether Tier B is ever worth it.
- **Granularity to ship:** whole-item only at first, or heading-section too? (Single-block waits on `^id` regardless.)
- **Tier B model:** if B is ever built, block-as-item (Model 2) vs editable block-range (Model 1)? This doc leans Model 2.
- **Where do block-items live** (Model 2)? Reuse the catch-all / `unmarked` type, an empty-title `note`, or a dedicated `snippet` type? Affects the type list, quick capture, and export layout.
- **Human-readable wiki-link rendering** of a uuid target, shared with the relations → wiki-link question [[storage-organization]] already tracks.
- **Does an embed count as a backlink** in the Related panel, or get its own "embedded in" affordance distinct from "mentions"?

## Relationship to other parked work

- **[[block-linked-action-items]]** — provides the `^id` block anchor and the dangling-link posture this depends on; the single hardest editor risk (round-tripping `^id`) is shared. Direct dependency.
- **[[storage-organization]]** — embeds are a transclude-flavored wiki-link, so they fold into that doc's relation → (path | wiki-link) export mapping. Core, both-agree + ADR.
- **[[local-first-split]]** — if local editing ever opens, native `![[...]]` embeds *are* the Obsidian-side interface, so transclusion fidelity is a prerequisite for that path.
- **[[scripture-passages-as-entities]]** — embedding a passage into a sermon is the cleanest motivating use case and a special case of transclusion.
- **[[notes-organization]]** — distinct from sub-pages: nesting (`parent_id`) is *containment*; embedding is *inclusion of content that lives elsewhere*. They compose but are not the same primitive.
- **[[rich-export-and-theming]]** — owns how the flattened embed renders in PDF/Word/print.
