# MSM Renderer — Claude Code Handoff

**What this is:** a working, tested Node tool that converts a Markdown paper into a
Midwestern Style Manual (4th ed.) compliant `.docx`. Built and verified against the
MSM spec — title page, 12pt TNR double-spaced body, 0.5" first-line indents,
centered bold/plain subheadings, real 10pt single-spaced Word footnotes, block
quotes, hanging-indent bibliography, centered-bottom page numbers starting at 1 on
the first text page (title page unnumbered). Four-page sample render was visually
confirmed page by page.

**Files in this folder**
- `msm-render.js` — the renderer (no build step; plain Node + the `docx` package)
- `README.md` — full usage and input conventions (read this)
- `sample-paper.md` / `sample-paper.docx` — feature demo (generic placeholder text)

## Run it

```bash
npm install docx
node msm-render.js paper.md -o paper.docx
```

Markdown conventions (full detail in README): YAML frontmatter drives the title
page; `##` = first-level subheading, `###` = second-level; `>` = block quote; a
heading named `Bibliography` switches on hanging-indent bib formatting; `[^id]`
markers + `[^id]: ...` definitions become real Word footnotes (each marker is its
own sequentially numbered note — repeats are shortened citations, not reused
numbers; this makes the old duplicate-footnote-ID error structurally impossible).
`*italic*` / `**bold**` inline.

## Two likely tasks

1. **Use as-is, per paper.** Write the paper in Markdown, run the command, upload
   the `.docx`. The renderer is content-agnostic — it formats, it does not write.

2. **Integrate into Ledgr as the Papers export step.** The Papers module spec
   (`module-papers.md` in the Ledgr planning docs) calls for a `render_docx`
   export. Port `msm-render.js` from a CLI into a route handler
   (`app/api/items/[id]/render-docx`) that takes `(markdown, meta)` and returns the
   docx buffer — `meta` (school/title/course/etc.) comes from the item title +
   `properties`; the markdown is the paper's canonical body. The rendering logic
   transfers directly; only the I/O wrapper changes.

## Calibration note (one thing to verify)

Title-page vertical spacing is the literal MSM reading, held in the `TP` constants
at the top of `msm-render.js` (plain integers, one per gap). This is the only spot
that might differ by a line from grader expectations. Compare the sample title page
against Tyler's 2 Timothy 100/100 benchmark and adjust the `TP` numbers if needed.

## Boundaries (keep these)

- Formatting only — never generate or alter paper content.
- The tool does not manage `Ibid.` placement (never use `Ibid.` as the first
  footnote on a page) — that stays a manual final-pass check, since page breaks
  aren't known until layout.
- The first-Scripture-quote translation footnote is authored by the writer, not
  auto-inserted.
