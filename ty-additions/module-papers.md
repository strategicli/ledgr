# Module: Papers (build first)

**Status:** Draft v0.1
**Builds on:** PRD §3.6/§3.7 (types, tiers), §4.13 (canvas), §5.5 (MCP)
**Canonical body format:** markdown
**Priority:** first module; built *after* the 3 current MBTS papers ship (those are the spec-gathering walk)

---

## What it's for

The seminary-paper workflow, which today is scattered across Logos (reading/highlighting), the MBTS digital library (articles), Claude (organizing, drafting), Google Docs / Apple Notes (storage), and a final Word doc on disk. The module gives that workflow one home, a memory, and a clean render path — **markdown canonical, .docx generated on demand for upload.**

The workflow is **MCP-first by design.** Most of the work happens in conversation with Claude: organize the quote bank, build the outline, draft sections — each saving into the paper's structure — then render the markdown to an MBTS-formatted Word doc for submission.

## The lifecycle (stage model)

A `stage` select property drives a board view. Stages observed in the real MBTS workflow:

`research → quote bank → outline → draft → submitted → graded`

- **`discussion post`** is an *optional* leading stage, toggled per-paper — not every class requires it. Modeled as a boolean `has_discussion_post` + an optional linked `discussion-post` item, rather than forced into every paper's pipeline.
- Stages are Tier-2 (a select property + board layout) — free from existing machinery, no bespoke code.

## Entities & shape

**`paper`** (system type, markdown-canonical body):
- `title`, `body` (markdown — the draft itself)
- properties: `stage` (select), `course`, `due_date`, `has_discussion_post` (bool), `word_target`, `citation_style` (default: Midwestern Style Manual 4th ed.)
- relations: → `quote` items (the bank), → `passage` entities (Scripture cited), → `topic` entities, → an `outline` (see below)

**`quote`** (system sub-type — the quote bank):
- Each quote is its **own small item**, not a blob inside the paper. This makes quotes reusable across papers and independently searchable.
- fields: `text` (the quote), `source` (book/article/author), `page`, `note` (why it matters / how I'll use it)
- relations: → the `paper`(s) it serves, → `passage` or `topic` entities
- **Capture gesture:** paste from Logos (highlight → copy → into Ledgr). The realistic friction point; the canvas sidebar and the MCP `capture_quote` tool both target it. Logos is the source for Scripture/book quotes; MBTS digital library for articles.

**Outline:** lightweight — either a markdown section within the paper's body or a small linked `outline` item. Decide during the manual walk (which feels right when you actually do it three times).

## The paper canvas (Tier-3 custom canvas)

Markdown editor (center) + **quote-bank sidebar** (right) + **stage tracker** (top strip, per §4.13 horizontal field zone). Drag a quote from the sidebar into the draft → inserts a formatted citation + a relation edge. The sidebar is filtered to quotes related to this paper but can search the whole bank ("I quoted Murray on this before").

*If custom canvas isn't accepted platform-wide (discussion doc decision #2), Papers falls back to the default BlockNote canvas with the quote bank as a Related panel — workable, just less fluid — or forks to Tyler's instance.*

## Exporter: markdown → MBTS .docx

Deterministic, no model (Principle 7). **pandoc + a reference .docx template** encoding Midwestern Style Manual 4th ed.: title page, heading hierarchy, footnote style, margins, spacing. The styling lives entirely in the template; the markdown stays clean. Re-render anytime — the .docx is disposable.

- Build the template + pipeline **once**, reuse across every paper and every class.
- This is also the most mechanical piece of the module, so it's the natural first thing to prototype — and it's useful *this week* for the current papers, independent of the rest of the module.
- Footnotes/citations: pandoc supports `--citeproc` with a CSL style; if no MBTS CSL exists, footnotes can be authored inline in markdown and styled by the template. Settle during the manual walk.

## MCP tools (this module's reason to pull MCP forward)

- `create_paper(course, title, due_date)` / `set_stage`
- `capture_quote(text, source, page, note, paper?)` — bank a quote from anywhere, mid-conversation
- `list_quotes(paper | topic | passage)` — pull the bank into a drafting conversation
- `get_paper(id)` — full paper + bank + outline + linked passages in one call (the polymorphic-relations payoff)
- `render_docx(paper_id)` — kick the pandoc export, return the file

The drafting loop becomes: *talk to Claude about the paper → quotes and outline save into the structure → draft saves as markdown → `render_docx` produces the upload-ready file.*

## Policy guardrail (carry into every Papers interaction)

Per standing instruction: for Masters Folder material, Claude provides **policy-safe academic assistance only** — feedback, clarity, organization, structure, the mechanical render pipeline. **It does not generate paper content.** The module's MCP tools are organizational (bank, outline, stage, render), not authorial. This guardrail is part of the module's spec, not an afterthought.

## Open questions

1. Outline as markdown-section vs separate linked item — resolve during the manual walk.
2. MBTS citation: existing CSL style vs template-styled inline footnotes — resolve during the manual walk.
3. Does the discussion-post sub-type need its own light render (forum-paste format) or just live as a note? — low stakes, defer.
