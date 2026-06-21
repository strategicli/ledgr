# MSM Renderer — Markdown → Midwestern Style Manual (4th ed.) `.docx`

Write your paper in Markdown (the canonical source), run one command, get a fully
MSM-formatted Word document for upload. The `.docx` is a disposable render — when
you revise, you edit the `.md` and re-run. The styling lives in the script, never
in a file you hand-fix.

This is **formatting infrastructure only**. It lays out *your* prose; it does not
write or alter content.

## Setup (once)

Requires Node.js. In this folder:

```bash
npm install docx
```

## Use (per paper)

```bash
node msm-render.js my-paper.md            # -> my-paper.docx
node msm-render.js my-paper.md -o final.docx
```

`sample-paper.md` → `sample-paper.docx` is a working example of every feature.

## Writing the Markdown

**Frontmatter** (top of file, between `---` lines) fills the title page:

```yaml
---
school: Midwestern Baptist Theological Seminary
title: A Teaching Overview of First Peter
paper_type: A Teaching Overview
course: NT 5183 New Testament Survey II
author: Tyler Collins
location: Kansas City, Missouri
date: June 14, 2026
---
```

**Body:**

| You write | You get (MSM) |
|---|---|
| a normal paragraph | 12pt TNR, double-spaced, 0.5" first-line indent, ragged right |
| `## Heading` | first-level subheading — centered, **bold**, triple-space above / double below |
| `### Heading` | second-level subheading — centered, plain |
| `> quoted line(s)` | block quote — single-spaced, indented 0.5", no quote marks |
| `*word*` / `**word**` | *italic* / **bold** (use `*…*` for italics, not `_…_`) |
| `## Bibliography` | starts a new page titled **BIBLIOGRAPHY**; entries below get hanging indents |

**Footnotes** use pandoc-style markers and definitions:

```markdown
...as Schreiner argues.[^1]
A later point follows.[^2]

[^1]: Patrick Schreiner, *The Visual Word* (Chicago: Moody, 2021), 112.
[^2]: Schreiner, *The Visual Word*, 118.
```

- Each marker is its **own sequentially-numbered footnote** in document order.
  A repeat citation is a *new* footnote with shortened text — exactly MSM practice —
  not a reused number. (This makes the old duplicate-footnote-ID error impossible:
  the library assigns unique IDs and the numbers are positional.)
- Definitions can wrap onto indented continuation lines.
- Put them anywhere; they're collected before rendering. Keeping them at the bottom
  is cleanest.

Footnotes render at 10pt TNR, single-spaced, first line indented, blank line between —
the MSM footnote block.

## The one thing to calibrate

The **title-page vertical spacing** (how many blank lines between school / title /
type / course / by / name / location / date) is implemented as the literal MSM
reading, held in the `TP` constants at the top of `msm-render.js`. This is the only
area where the manual's "eight lines below" could differ by a line from what your
graders expect. Open `sample-paper.docx`, compare the title page against your
**2 Timothy 100/100 benchmark**, and nudge the `TP` numbers if needed — they're
plain integers, one per gap. (Happy to calibrate these exactly against the benchmark
file if you point me at it.)

## What it deliberately does NOT do

- **Write or change content.** Mechanical formatting only.
- **Manage `Ibid.` placement.** It renders whatever footnote text you write. The
  "never use `Ibid.` as the first footnote on a page" rule stays your manual final-pass
  check, as it already is — page breaks aren't known until layout.
- **Insert the translation footnote.** Place that footnote yourself on your first
  Scripture quotation (the manual's wording, e.g. NASB).
- **Auto-apply headline capitalization** to subheadings. It preserves your casing so
  small words ("of", "the") aren't wrongly capitalized — type headings as you want them.

## Files

- `msm-render.js` — the renderer
- `sample-paper.md` / `sample-paper.docx` — feature demonstration (generic placeholder text)
- `README.md` — this file
