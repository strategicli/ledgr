# Sermons module — PRD (draft)

**Status:** draft / design intent, no code yet. Tyler's lane (a bespoke module = "move fast, solo" per CLAUDE.md; an ADR only if it reaches into core). Captures the 2026-06-20 design conversation so the build has a target. A **v1.0 item for Tyler** ("be my creative workspace": write sermons in Ledgr, and bring my existing ones in).

> Sermons are still a markdown document. Everything below is a structured **view over one `markdown` body** (Principle: markdown is the source of truth, ADR-037). The fancy three-tab UI is how you author and read that document; a plain `.md` upload reconstructs the whole UI from the file. Nothing is stored as a second source.

---

## 1. Purpose

A bespoke `sermon` type for studying, drafting, structuring, and (optionally) capturing the delivered transcript of a sermon, in one place. It replaces the "Word file + scattered notes" workflow: study notes pile up, an outline takes shape from them, and the finished message is a clean structured document that can be preached from, exported, and archived.

The model to beat is the existing **Papers module** (`src/lib/papers/`, `src/components/paper-editor/`), which already does the analogous thing for academic papers: a tabbed canvas of **Quote Bank · Outline · Draft** over one markdown body, with a deterministic outline parser (`outline.ts`/`outline-html.ts`). Sermons is the same shape, tuned for preaching.

## 2. The type and where it fits

- A `sermon` is an **item** (`items.type = "sermon"`), markdown-canonical (`body.format = "markdown"`). One row, one body, like every other item (Principle 2).
- Registered as a **module** (`ModuleManifest` in `src/lib/modules/`) with its own **canvas** (`canvasId: "sermon"`, wired in `src/lib/module-wiring.tsx`), an exporter (markdown → `.docx`/PDF, reusing the papers `.docx` route pattern), and the type seeded in `scripts/seed.mjs`. Core is untouched: an unregistered `sermon` row would just fall back to the default markdown canvas, so the module only adds behavior.
- **Properties** (on the type's `property_schema`): `passage` (relation to `passage`, ADR-060), `series` (text or relation), `preached_on` (date), `venue` (text), `status` (select: studying / outlining / ready / preached / archived), `scripture_refs` (could derive from `passage` relations). Songs/people/meetings relate in via the generic relations panel.

## 3. The canvas: three tabs

The canvas is tabbed (like the paper canvas). Tabs:

### Tab 1 — Drafting Notes
A single freeform pile. Pasted commentary quotes, random ideas, stray thoughts, applications, illustrations, cross-references: whatever surfaces while studying. No structure imposed. This is the raw material the outline is built from.

- Just the markdown editor (the default Tiptap surface), nothing special.
- This is the input to the future "auto-draft an outline" action (Section 7).

### Tab 2 — Working Outline
The heart of the type. Three stacked zones, top to bottom:

1. **Sticky statement** (top zone). The one memorable, repeatable sentence: the "take-home truth" / homiletical idea the whole sermon hangs on. Short. Its own field at the very top.
2. **Introduction** (separate zone, below the sticky statement). The opening: hook, tension, orientation to the text. A short prose block, distinct from the sticky statement and from the outline points.
3. **The outline** (middle/main zone). The structured body of the sermon, points and subpoints, built from the Drafting Notes.

#### The outline structure and behavior
- **Points and subpoints**, nested. A point can have subpoints; subpoints can nest further.
- **Drag-and-drop reordering** with subtree semantics: grab a **point** and the *entire* point moves (its subpoints and any content under it travel with it). Grab a **subpoint** and everything beneath that subpoint moves with it. (Move-the-node-moves-its-descendants. This is exactly how reordering a markdown heading moves its whole section, which is the natural implementation: outline nodes are headings, DnD reorders heading-rooted blocks.)
- **Collapsible** points and subpoints, for navigation. Collapse a finished point to get it out of the way and start the next one. Collapse/expand state is a UI affordance (not necessarily persisted to the body; persist per-item if it proves useful).
- **Easy to add** sections and subsections: a clear "+ point" / "+ subpoint" affordance at every level, low-friction (no menu digging).
- **Transition statements** (optional, between points). A short statement or paragraph that bridges one point to the next. It is **not** a point: it gets no point number and does not nest, but it still needs a place to live and be edited. Rendered between points as a visually distinct, un-numbered block. (Markdown representation: a marked block, e.g. a `> [!transition]` callout or an HTML-comment-delimited region, so it round-trips without polluting the point numbering.)

### Tab 3 — Transcript (optional)
The delivered transcript of the sermon, if the user wants it. **Optional per the module options** (Section 5): some preachers keep a transcript, many do not. When disabled, this tab does not appear. When enabled, it is a plain markdown area (and a natural target for the existing transcription seam, ADR-088, if audio gets attached: a sermon could reuse the meeting-recording pipeline to fill this from audio later).

## 4. Markdown is the source of truth (upload fills the UI)

Because the whole sermon is one markdown body, two things must hold:

1. **Round-trip.** The three tabs and the outline tree serialize to one markdown document and parse back losslessly. Editing in the UI writes markdown; the markdown is canonical.
2. **MD upload reconstructs the UI.** A user can take an old Word-file sermon, save it as markdown (with the convention below), upload it, and get the full Drafting-Notes / Outline / Transcript UI automatically. No separate import format: the `.md` *is* the sermon.

**Proposed markdown convention** (to firm up at build; mirror the papers outline parser):
- Recognized top-level sections by heading, e.g. `# Drafting Notes`, `# Sermon` (containing the sticky statement, intro, and outline), `# Transcript`.
- **Sticky statement**: a recognized field at the top of the sermon section (a frontmatter key like `sticky:` or a `> ` blockquote immediately under the title). TBD which reads cleanest for a hand-authored file.
- **Introduction**: a recognized `## Introduction` heading (or the prose before the first numbered point).
- **Outline points**: markdown headings (`##`, `###`, …) under the sermon section. Heading depth = outline depth, which is why DnD = heading-section moves.
- **Transition statements**: a marked block between points (callout or comment region) so they are not parsed as points.
- Anything under `# Drafting Notes` stays a freeform pile; anything under `# Transcript` populates that tab (and is dropped if the transcript option is off).

This convention is the contract for both directions (author-in-UI and upload-from-file). Keep it forgiving: a plain markdown file with just headings should still produce a sane outline, the way the papers parser tolerates loose input.

## 5. Module options (set when the user adds/enables the module)

When the user adds the Sermons bespoke module, present an **options panel**:

1. **Include the Transcript tab?** (on/off). Default off. Toggles Tab 3.
2. **Sermon template / shape.** "Generally, what shape do your sermons take?" The user picks a starting shape (or "Blank"); we offer suggestions (Section 6). The chosen shape pre-seeds a new sermon's outline scaffold (the points/zones), so "+ New sermon" starts from the user's preferred structure rather than an empty page. The user can override per sermon and can define their own shapes (Brandon and Tyler will each add theirs).
   - This rides the **Templates redesign (ADR-093)**: a sermon shape is naturally a sermon-type template (a prototype item with the zones/points pre-built). The "per-type default + chooser" from TPL4 is exactly the "default shape + pick another" UX here, so the shape library can ship as seeded sermon templates rather than a separate mechanism.

## 6. Sermon shape library (starter suggestions)

Filled in from classic homiletics so Tyler/Brandon have a starting set; both will add their own. Each is a scaffold of zones + points, not prescriptive content.

**Basic forms (the three classic types):**
- **Expository (verse-by-verse).** Points and subpoints taken directly from a single passage, in reading order; explain then apply as you move through the text. ([Three Preaching Methods](https://www.jacobabshire.com/teaching/commentary/three-preaching-methods-expository-textual-topical/))
- **Textual.** A short text supplies the main divisions (the points come from the text's own structure); developmental subpoints can draw from other texts. ([Sermon Structure and Outlining, Akin](https://www.danielakin.com/wp-content/uploads/old%5CResource_438%5CClass%20Notes%20Biblical%20Preaching%204020%20Book%202%20Sec.%2019%20Sermon%20Structure%20and%20Outlining.pdf))
- **Topical.** Organized around a theme; may start from a principal verse but ranges across multiple passages rather than one. ([Sermon Information: types of sermons](https://www.sermoninfo.com/what-are-the-different-types-of-sermons.html))

**Classic outline scaffolds:**
- **Three-point sermon.** Introduction → Point 1 → Point 2 → Point 3 → Conclusion. The traditional "plain style" deductive shape (roots in Puritan and earlier university preaching). ([Determining the Form, Homiletic](https://homiletic.net/index.php/homiletic/article/view/3335/1562))
- **Big Idea / one-point (Haddon Robinson, *Biblical Preaching*).** One central idea (subject + complement); the points develop, illustrate, prove, and apply that single idea rather than standing as independent topics. Scaffold: Big Idea → explanation → illustration → application.
- **Problem / Solution.** State a real problem (the felt tension) → develop the biblical solution → call to response.

**Communication-driven and narrative shapes:**
- **Me · We · God · You · We (Andy Stanley & Lane Jones, *Communicating for a Change*).** Built around the speaker's relationship to the audience, not content blocks: **Me** (introduce a dilemma I face / orientation) → **We** (build emotional common ground: we all face this) → **God** (engage the text: God's solution) → **You** (one point of application everyone can embrace) → **We** (collective vision / commitment). ([Stanley & Jones outline, Weidmann](https://joshweidmann.com/me-we-god-you-we/); [Me-We-God-You-We, RhetoricAndHomiletics](https://rhetoricandhomiletics.org/2017/10/26/me-we-god-you-we/))
- **Lowry Loop (Eugene Lowry, *The Homiletical Plot*).** A narrative arc built on a "sensed discrepancy," moving from itch to scratch: (1) **Upset the equilibrium** ("oops") → (2) **Analyze the discrepancy** ("ugh") → (3) **Disclose the clue to resolution** ("aha") → (4) **Experience the gospel** ("whee") → (5) **Anticipate the consequences** ("yeah"). Good for narrative texts. ([Lowry Loop, Concordia Theology](https://concordiatheology.org/sermon-structs/dynamic/narrative-structures/lowry-loop/); [The Homiletical Plot summary](https://rosedale.edu/docs/academics/preaching/28.The_Homiletical_Plot.pdf))
- **Four Pages (Paul Scott Wilson).** Four movements: **Trouble in the text → Trouble in our world → Grace in the text → Grace in our world.** A law-then-gospel narrative balance.

(These are starter scaffolds. The point of the option is that each preacher sets a default that fits how they actually preach.)

**Sources:** [Three Preaching Methods (Abshire)](https://www.jacobabshire.com/teaching/commentary/three-preaching-methods-expository-textual-topical/) · [Sermon Structure and Outlining (Akin)](https://www.danielakin.com/wp-content/uploads/old%5CResource_438%5CClass%20Notes%20Biblical%20Preaching%204020%20Book%202%20Sec.%2019%20Sermon%20Structure%20and%20Outlining.pdf) · [Types of Sermons (SermonInfo)](https://www.sermoninfo.com/what-are-the-different-types-of-sermons.html) · [Determining the Form (Homiletic)](https://homiletic.net/index.php/homiletic/article/view/3335/1562) · [Me·We·God·You·We (Weidmann)](https://joshweidmann.com/me-we-god-you-we/) · [Lowry Loop (Concordia)](https://concordiatheology.org/sermon-structs/dynamic/narrative-structures/lowry-loop/)

## 7. Next steps / future (not v1 of the module)

- **AI auto-outline from the Drafting Notes.** A user-triggered action ("Draft an outline from my notes") that sends the Drafting-Notes pile to the Claude API and returns a starting outline (sticky-statement candidate + points/subpoints) the user can then drag, edit, and prune. A way to get going from a pile of study material.
  - **Principle 3 fit:** this is fine because it is **deliberate and human-in-the-loop** (a button the user presses, output staged as a draft they edit), not an automatic background job. Ledgr's own crons stay model-free. Use the latest Claude model via the Claude API; gate it behind the module so instances without it just don't show the button.
- **Audio → transcript** for Tab 3, reusing the transcription seam (ADR-088/089) the meeting-recording module already built.
- **Preaching view / Save Offline.** A clean, large-type, collapsible-points reading layout for the pulpit, and an offline/PDF fallback (the Sunday-proof path, Principle 4).
- **Series support.** Group sermons into a series (a relation or a `series` item), with a series view.

## 8. Open questions

- **Sticky statement: property or body section?** A property is easy to surface/filter and put on a dashboard; a body section round-trips more naturally from a hand-authored `.md`. (Leaning: recognized markdown section that also mirrors to a property for filtering.)
- **Collapse state: persist or ephemeral?** Probably ephemeral first; persist per-item only if it earns it.
- **Transition-statement markdown encoding:** callout (`> [!transition]`) vs HTML-comment region. Pick whichever survives the docx/PDF export cleanly.
- **Does the outline reuse the Papers `outline.ts` parser or get its own?** Likely a sermon-specific parser (different zones: sticky/intro/transitions), but borrow heavily.
- **Shape library as seeded templates (ADR-093) vs a module-local list?** Leaning templates, to reuse the default+chooser UX.

## 9. Build precedent / pointers

- **Papers module** is the closest existing thing: `src/lib/papers/` (`outline.ts`, `outline-html.ts`, `types.ts`, `msm-docx.ts`) + `src/components/paper-editor/` (`OutlineTab.tsx`, `QuoteBank.tsx`, `ShapeTab.tsx`, `PaperCanvasClient.tsx`). Copy the tabbed-canvas-over-one-markdown-body shape.
- **Module seam:** `src/lib/modules.ts` / `module-wiring.tsx` (register the manifest + canvas), `scripts/seed.mjs` (seed the `sermon` type row).
- **Templates:** ADR-093 (TPL1–TPL5) for the sermon-shape library and the per-type default+chooser.
- **Relations:** ADR-060 (`passage`) and ADR-067 (typed relation fields) for linking sermons to scripture, songs, people.
- **Canvas DnD:** the mobile-kanban touch-drag work (`src/lib/board-touch-drag.ts`, `useBoardTouchDrag.ts`) and `canvas-drag-and-drop.md` are reference for the no-dependency DnD stance.
