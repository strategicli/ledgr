# Song import: PDF / chord chart → ChordPro (build spec)

**Status:** scoped, not built (decided 2026-06-14; build is the next Songs-lane slice).
**Lane:** Tyler / Songs module (module-internal → solo, no ADR unless the module
contract is widened — see "Core note" below).

## Why

The Songs module can author and render chord charts, but every song has to be typed
in by hand. Tyler has a large existing library of chord charts as PDFs
(PraiseCharts / Planning Center exports) and wants to bulk-add them to the worship
archive for future service planning. An importer turns "a folder of PDFs" into
`song` items with our ChordPro body, ready to transpose, print, and export to PCO.

## Decision: deterministic text-parse, human-reviewed (no AI)

Per Principle 3 (deterministic by default, AI on purpose) and Principle 5 (boring
stack, few deps), v1 parses the PDF's **text layer** positionally — no model in the
loop, no API cost (keeps the ~$0 target). The parse output is always **reviewed and
fixed in the chord canvas before saving**, so a misparse is corrected, never silently
stored. AI-assisted conversion (for scanned/image charts) is a deferred future option,
not v1.

## Pipeline

1. **Upload** a PDF (or paste raw chart text). Bulk: accept several PDFs and queue them.
2. **Extract text per page**, preserving line breaks and each token's approximate
   **column index** (x-position). Column index is what lets a chord be paired with the
   syllable beneath it. New dependency (see below).
3. **Classify each line** into one of:
   - **metadata** — `Key:`, `Tempo:`, `Time:`, `CCLI`, `Capo`, title/artist header lines → `ChartMeta`.
   - **section header** — "Verse 1", "Chorus", "Bridge", "Intro", "Tag"… → start a `Section`
     (reuse `classifySection` for the kind).
   - **bars line** — runs of `| Chord / / / |` → `BarsLine`.
   - **chord line** — a line whose non-space tokens are *mostly valid chord symbols*
     (use the chord-validation already in `src/lib/chordpro/transpose.ts` / `parse.ts`).
   - **lyric line** — anything else.
4. **Pair chords to lyrics:** when a chord line sits directly above a lyric line, place
   each chord at the column index of the syllable beneath it → `ChordPair[]` → a
   `LyricLine`. A chord line with no lyric line beneath becomes a leading/standalone
   `LyricLine` (chords with empty text) or a `BarsLine`.
5. **Assemble** the `ChordChart` AST (`{ meta, sections }`).
6. **Validate** by `serializeChordChart(chart)` → `parseChordPro(...)` round-trip; the
   serializer is the contract gate (same discipline as the Songs verify script).
7. **Review** the parsed chart in the existing **chord canvas** (Edit ⇄ Preview), fix
   anything the parser got wrong, then **save** as a `song` item
   (`{ format: "chordpro", text }`).

## Reuse (already built — the importer writes almost no new chart code)

- `src/lib/chordpro/parse.ts` — `parseChordPro`, `serializeChordChart`.
- `src/lib/chordpro/types.ts` — `ChordChart`, `Section`, `LyricLine`, `ChordPair`,
  `BarsLine`, `classifySection`. The chord-over-syllable model maps directly to step 4.
- `src/lib/chordpro/transpose.ts` — chord-symbol validation for step 3's classifier.
- `src/lib/chordpro/render.ts` + `chart-css.ts` — preview the parsed chart.
- `src/components/chord-editor/ChordEditor.tsx` + `ChordCanvasClient` — the review surface.
- Item create — a normal `POST /api/items` with `type: "song"`.

## New pieces to build

- `src/lib/songs/import-chart.ts` (pure) — `textToChart(pages): ChordChart`. The
  classifier + pairer + assembler. Node-pure so a `verify-song-import.mts` can test it
  against fixture text from real PraiseCharts/PCO exports (the two already used to design
  the Songs module — "Light on the Hill", "Sharpen My Sword").
- A PDF→text step behind a thin function (`extractPdfText(file): Page[]`) so the parser
  stays pure and the PDF dep is isolated (provider-seam discipline).
- An import surface in the Songs lane — upload/paste, parsed preview in the chord canvas,
  per-file review, save; a queue for bulk.

## New dependency (add when building, not now)

A serverless-friendly PDF **text** extractor that exposes per-token positions:
**`unpdf`** (preferred — pure JS, Vercel-friendly, wraps pdf.js) or `pdfjs-dist`. Must
return token x-positions (not just a flat string) for column-based chord pairing.
Justify against Principle 5 at build time; isolate behind `extractPdfText`.

## Out of scope / risks

- **Scanned / image-only PDFs** (no text layer) — out of scope for the deterministic
  path. This is where an AI-assisted fallback (Claude → our ChordPro dialect, validated
  by `parseChordPro`, reviewed in the canvas) would slot in later (deferred 2026-06-14).
- **Exotic multi-column page layouts** — column detection may misorder sections; the
  canvas review step is the safety net. Log/flag low-confidence parses; never save
  silently.
- **Chord-vs-lyric ambiguity** (e.g. a lyric line that is mostly single capital letters)
  — the classifier will occasionally guess wrong; review catches it.

## Done means

A `verify-song-import.mts` green against real export fixtures, and Tyler can drop a PDF,
glance at the parsed chart, fix a line or two, and save — repeatably, for a stack of songs.
