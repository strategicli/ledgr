# Tyler's Additions — Architecture Overview

**Status:** Draft v0.1, for discussion
**Builds on:** Ledgr PRD v0.17, schema.md, §3.7 (type tiers), §4.10/§4.14 (Build surface)
**Companion docs:** `FOR-BRANDON-approach-diff.md` (the discussion headline), `module-papers.md`, `module-songs.md`, `module-sermons-lessons.md`, `module-discipleship.md`, `integrations-savor-atlas.md`

This doc establishes the *cross-cutting* additions — the principles and patterns every module depends on. Read this first, then the per-module specs.

---

## 1. The core new pattern: contributed workflow modules

The insight from the interview: **my work follows workflows, but each workflow is very different.** A song, a paper, a sermon, and a discipleship relationship share almost nothing in structure, yet each is a repeatable process I run dozens of times. Ledgr's §3.7 three-tier type system already anticipated this — what it didn't yet name is a way to package a whole workflow as a unit.

A **module** is:

| Piece | What it is | Ledgr mechanism it uses |
|---|---|---|
| **System type(s)** | e.g. `paper`, `song`, `sermon`, plus sub-types like `quote` | A `types` row, `is_system = true` (§3.6) |
| **Canonical body format** | markdown / ChordPro / BlockNote — declared per type | `items.body` jsonb (already format-agnostic) |
| **Custom canvas** | the type's editing UI (chord editor, paper workspace) | **NEW capability** — see §3 below |
| **Stage model** | the workflow's phases | a `select` property + board view (Tier 2, free) |
| **Exporters** | markdown→docx, ChordPro→chart, →PCO, →slides | deterministic code, no model (Principle 7) |
| **Integration** (optional) | Savor pull, PCO push, GitHub scan | provider-seam adapter |

The point: a module is mostly *assembled from machinery Ledgr already has*. The only new platform capability it needs is the **custom canvas** (§3). Everything else — typed items, properties, relations, FTS, export, MCP — comes for free.

This is the formalization of your §4.14 "workflows," moved from user-built-via-templates up to developer-contributed-with-code, for the handful of workflows rich enough to deserve bespoke UI and exporters.

## 2. Markdown-canonical, per type (the file-format principle)

**Decision (proposed):** canonical body format is a property of the *type*, not the platform.

Your reasoning for BlockNote-canonical (sermons need colors markdown can't hold) is correct and stays the default. But for types whose value is *portability and multi-output rendering*, markdown (or a markdown-kin like ChordPro) is canonical and everything else is a derived render:

- **Paper** → markdown canonical → pandoc renders MBTS-formatted **.docx** for upload (styling lives in a reference template, never hand-fixed), or PDF, or web.
- **Song** → ChordPro canonical → renders chord chart, transposed chart, **PCO push**, printable PDF.
- **Slides** (e.g. the AI context-engineering presentation) → markdown canonical → Marp/reveal.js renders the deck.

Why this is right long-term: one source, many styled outputs; the styling is swappable templates, not baked-in formatting; the source stays greppable, diffable, and future-proof. Savor already proves the pattern in production (tiptap → markdown storage → markdown export with YAML frontmatter).

**On "leave it as markdown vs upload the Word doc":** keep markdown canonical, treat the .docx as a disposable artifact regenerated on demand. Never edit the rendered Word doc as a source of truth — that breaks the one-source principle.

Implementation: `items.body` stores `{ "format": "markdown" | "blocknote" | "chordpro", ... }`. List queries still never select `body` (your perf rule holds). The markdown exporter you already built (§4.1, colors→inline-HTML) stays the path for BlockNote types; markdown-canonical types skip the conversion entirely.

## 3. Custom canvas per type (the one real platform change)

Your §4.13 says every item opens to the same full-editor canvas — a deliberate Notion-faithful choice. Modules need an exception: **a system type may declare its own canvas component.**

- A `chord` canvas (song): section/line/chord-attachment grid, transpose control, progression picker.
- A `paper` canvas: markdown editor + quote-bank sidebar + stage tracker.
- Default unchanged: any type *without* a declared canvas gets the standard BlockNote canvas. Custom types (Tier 2) always get the default. This is Tier-3-only, exactly like your other type-specific code.

This is the **co-own-vs-fork hinge** (see discussion doc, decision #2). If accepted, Songs/Papers live in the shared system. If not, they fork to my instance — survivable, since the rest still shares.

## 4. Scripture references as first-class entities

New `entity.kind = passage` (joins your existing `person | org | project | topic | campus`). A passage entity carries `book_slug`, `chapter`, `verses` — the exact shape **Savor already emits** (`passage_items`), so ingestion needs zero parsing.

Payoff: Savor commentary, a song, a sermon outline, a seminary paper, and a quoted source all link *through the text*. "Show me everything I've created or saved on Hebrews 4" is one MCP query — and it's literally how a future sermon series gets assembled from years of Savor journaling.

## 5. The iOS wrapper as a named final phase

A Capacitor/WKWebView App Store wrapper for push, widgets, and meeting-record. **Hard requirement for me.** It is the *last* phase — everything it wraps must exist first — but naming it now forces three earlier decisions to be made wrapper-aware:

- **Service worker / PWA shell** (your §4.16, next in queue): cache the shell so the wrapper has something to load; structure the share target so a native share-sheet handoff works.
- **Auth in a webview:** verify Clerk sessions survive WKWebView early, not at wrapper-build time.
- **Native surfaces lean on existing plumbing:** task widget reads the Today query; meeting-record reuses your §4.15 transcript/suggested-task design; nothing native reaches into internals not built to be reached.

## 6. Integration direction (detail in `integrations-savor-atlas.md`)

- **Savor → Ledgr:** pull (or push-on-save), **read-only mirror.** Savor stays the calm writing surface; Ledgr holds a linked, searchable reflection. Savor's structured `passage_items` feed §4 directly.
- **Atlas → Ledgr:** work tasks/projects surfaced read-only (org data stays in Atlas; clean ownership boundary).
- **GitHub → Ledgr:** scan `next_steps.md` across repos so dev-project state surfaces and tasks can be generated (my dev-portfolio need; not Brandon's).

---

## Module roster & build order

| Order | Module | Why this order | Tier-3 work | Status |
|---|---|---|---|---|
| **1** | **Papers** | 3 due in 2 weeks; MCP+markdown→docx loop is current daily pain | quote-bank capture, paper canvas, pandoc exporter | spec'd, build after current papers |
| 2 | Discipleship | leadership-timing urgency; Brandon wants it too | interaction log, cadence nudge, privacy tier | spec'd, privacy open |
| 3 | Songs | high-value but no active deadline | chord canvas, ChordPro, progressions, PCO export | spec'd |
| 4 | Sermons/Lessons | lighter; benefits from Savor + passage entities maturing first | light shape, transcript attach, series entity | spec'd |
| — | iOS wrapper | everything above must exist first | Capacitor shell | named, last |

**Reality check (from the interview):** Papers is first but will **not** be built before the 3 current papers are due — and shouldn't be. Run the workflow by hand on those three (Claude-assisted on the policy-safe mechanics: quote-bank organization, outline structure, markdown→docx render), and let that real-world walk be the spec. Build the module to fit the path walked three times, not the imagined one.
