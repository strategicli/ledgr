# Canvas tabs — PRD / design (draft)

**Status:** draft / design intent, no code yet. Raised by Tyler 2026-06-20 (Google-Docs-style "tabs," but across the top of the canvas). **Core-adjacent — needs Brandon-agree + an ADR before it merges to shared `main`** (see §5). Tyler can prototype on a branch in parallel.

## 1. Purpose

Let a user split one item's canvas into named **tabs**, each a separate section of the *same* item, switchable from a strip across the top of the canvas. A way to keep related-but-distinct content apart without spawning separate items.

Tyler's driving case: writing a song, he keeps 5–6 lyric versions plus notes and ideas on the one note that goes with the song, each separated by a tab. (Google Docs puts tabs down the left; across the top reads better here and fits the existing canvas chrome.)

## 2. UX

- A **subtle "+ Add tab" button** at the top of the canvas (above the editor toolbar in the [Test note] mock). Clicking it adds a new tab and focuses its title.
- A **tab strip** across the top: one chip per tab, the active one highlighted. Clicking a chip switches the editor to that tab's content.
- A **tab title** shown above the editor for the active tab (inline-editable), so you always know which section you're in.
- Per-tab actions (low-friction): **rename**, **reorder** (drag, reuse the no-dep DnD stance), **delete** (with confirm — `ConfirmButton`; deleting a tab removes its section).
- A single-tab (or zero-tab) item looks exactly like today — the strip only appears once there's more than one tab, so nothing changes for items that don't use it.
- Switching tabs swaps which section the editor shows; the toolbar/editor are otherwise unchanged.

## 3. How tabs map to the markdown body (the crux)

**Invariant to preserve:** the item body stays one `{format:"markdown", text}` document (the canonical-body contract, ADR-037/040). Tabs are **named sections within that one body**, not separate items and not a new column. The full text (all tabs, in order) is what every existing reader sees — so **FTS, export, share, print, mentions, clone, MCP all keep working on the whole document** with no per-reader change, *provided the delimiter is render-safe*. The canvas is the only surface that knows about tabs: it splits the body on the delimiter, shows one section at a time, and reassembles on save.

**Encoding fork (for the ADR to settle):**
- **(A) Explicit tab marker** — each tab opens with an invisible delimiter, e.g. an HTML comment `<!-- tab: Title -->` (or a fenced directive). *Pros:* unambiguous parse, zero collision with the user's in-content headings, the title is captured exactly. *Cons:* a custom convention every renderer must strip (markdown-it passes HTML comments through; the strip is one shared helper, like `stripBlockAnchors` for `^id` anchors, ADR-090).
- **(B) `# H1` heading = tab boundary** — each top-level `#` heading starts a tab; its text is the tab title; in-content headings use `##`+. *Pros:* plain standard markdown, human-readable raw, and an uploaded `.md` (e.g. an old Word doc, or the Sermons-PRD upload goal) auto-splits into tabs for free. *Cons:* conflates "heading" with "tab," reserves `#` so the canvas H1 button changes meaning, and a stray `#` in pasted content makes an accidental tab.

**Recommendation:** lean **(A)** for storage robustness (no collision, exact titles), and offer **"split on H1"** purely as an *import* convenience for uploaded `.md` files — which decouples the durable storage convention from the upload nicety and gives the best of both. Confirm in the ADR.

**No schema change expected:** tabs live in the body; tab order = document order; titles = the delimiters. The only extra state is *which tab is active*, which can be UI-ephemeral (default to the first) or a tiny `properties.activeTab` if persistence is wanted. So likely **no migration** — which keeps the blast radius small.

## 4. Capability model (where it's available)

Rides the **bespoke-tool catalog capability seam** (ADR-051, `ModuleCapability` in `src/lib/modules.ts`): "tabs" is a capability bundle (its own `canvasId` = a tabbed wrapper around the default canvas) that a type can attach.
- **Auto-on for `note`** — the note type ships with tabs (Tyler's primary case; notes are the catch-all-ish surface where this matters most).
- **Opt-in for any other type** via the Build → bespoke-tool catalog (a `types.capability` attach, ADR-051) — so a song's note, a project, a paper, etc. can each turn it on without it being forced everywhere.
- Implementation is a **tabbed wrapper canvas** that composes the existing `MarkdownCanvas`/`ItemEditor` (it slices the body to the active tab, renders the strip + title, reassembles on save) rather than a from-scratch editor — same compose-pattern as `LinkCanvas` over the default.

## 5. Core assessment — what needs Brandon-agree + an ADR

Three of the touched things are on CLAUDE.md's frozen core list, so this is **both-agree + ADR** before it merges to shared `main`:
1. **The canonical body format** — a tab-section delimiter convention means every body reader (`markdown-render`, `search`/FTS, `share`, `print-html`, `mentions`, `clone`, `mcp/tools`, export) must treat a tabbed body correctly. If the delimiter is render-safe (recommendation A with a shared strip helper, or B which is just headings), they keep working unchanged — but it's still a contract addition to ratify.
2. **The type/canvas model** — the default canvas gains a tab mode, and `note` (a core type) gets it by default: a core-type behavior change.
3. **The module boundary** — a new `tabs` capability on `coreModule`.

None of it likely needs a migration (§3), which lowers the risk. **Path:** this PRD → Brandon agrees on the encoding fork + the note-default → ADR → build (Tyler can prototype on a branch meanwhile; don't merge to `main` pre-agreement).

## 6. Open questions

- Encoding A vs B (§3) — the main fork.
- Active-tab: ephemeral vs `properties.activeTab`?
- Should bespoke module canvases (Chord/Paper) be tab-able, or default-canvas-only at first? (Lean default-only first; modules opt in later, like Feature B.)
- Interaction with **Feature B** (the arrangeable per-type canvas grid, ADR-069): are tabs a layer above the grid (each tab its own grid) or just a body-section switcher inside the default markdown block? (Lean the latter for v1: tabs section the *body*, the grid arranges *fields*; revisit combining them.)
- Empty/last-tab rules: deleting the last tab reverts to the plain single-body canvas.

## 7. Build precedent / pointers

- **Capability seam:** `src/lib/modules.ts` (`ModuleCapability`, `capabilityById`, the capability-aware `canvasIdForType`), `types.capability` (ADR-051), the Build bespoke-tool catalog.
- **Canvas compose-pattern:** `LinkCanvas` over the default (ADR-041); wrap `MarkdownCanvas`/`ItemEditor` (`slot` prop already exists, ADR-069).
- **Render-safe body markers precedent:** block anchors `^id` (`src/lib/editor/block-anchor.ts`, `stripBlockAnchors`, ADR-090) — the model for a "strip this convention from share/print/export/FTS" helper.
- **Body readers to audit:** `src/lib/{markdown-render,search,share,print-html,mentions,clone,body,body-text}.ts`, `src/lib/mcp/tools.ts`.
- **Upload-fills-UI tie-in:** the Sermons-PRD markdown-upload goal (`explorations/sermons-module-prd.md`) and "split on H1" (§3 option B as the import path).
