// Lyrics import (Song module; v5). Turn a pasted block of plain lyrics into chart
// sections so the writer can add chords in the editor. Section headers ("Verse 1",
// "Chorus", "[Bridge]", "Pre-Chorus:") start a new section; every other non-blank
// line becomes a chord-less lyric line (one `{chord:null}` pair). Deterministic,
// pure (no React/DB) so it's node-testable and runs the same in the client.
import type { ChordChart, Section, SectionKind } from "@/lib/chordpro/types";

const SECTION_KEYWORDS: { re: RegExp; kind: SectionKind }[] = [
  { re: /^pre[\s-]?chorus\b/i, kind: "prechorus" },
  { re: /^chorus\b/i, kind: "chorus" },
  { re: /^verse\b/i, kind: "verse" },
  { re: /^bridge\b/i, kind: "bridge" },
  { re: /^intro\b/i, kind: "intro" },
  { re: /^(outro|ending|end)\b/i, kind: "end" },
  { re: /^tag\b/i, kind: "tag" },
  { re: /^(instrumental|interlude)\b/i, kind: "instrumental" },
  { re: /^(turn(around)?|vamp)\b/i, kind: "turn" },
  { re: /^(refrain|hook)\b/i, kind: "chorus" },
];

// A section header: a short line (strip [ ] wrapping + a trailing colon) that
// starts with a known section word. Long lines are lyrics, never headers.
function detectHeader(line: string): { label: string; kind: SectionKind } | null {
  const cleaned = line.replace(/^\[/, "").replace(/\]$/, "").replace(/:\s*$/, "").trim();
  if (!cleaned || cleaned.length > 24) return null;
  for (const { re, kind } of SECTION_KEYWORDS) {
    // Normalize every label to uppercase so the styling is consistent (e.g.
    // "[tag]" → "TAG", "Chorus" → "CHORUS", "VERSE 1" stays "VERSE 1").
    if (re.test(cleaned)) return { label: cleaned.toUpperCase(), kind };
  }
  return null;
}

// Build sections from pasted lyrics. Blank lines are skipped (sections are named,
// not blank-separated). Content before the first header falls into a "Verse 1".
// A repeated section LABEL (e.g. a second "Chorus") is a reference, not a copy —
// the chart's "type once, recall by label" model (`ref: true`, no lines), and its
// pasted duplicate lines are dropped. A *distinct* label ("Chorus 2", "Verse 2")
// is its own section. So choruses don't repeat unless the writer numbers them.
export function lyricsToSections(lyrics: string): Section[] {
  const sections: Section[] = [];
  const seen = new Set<string>(); // labels already authored with content
  let current: Section | null = null;
  let skipping = false; // dropping a repeated section's duplicate lines
  const key = (label: string) => label.trim().toLowerCase();
  for (const raw of lyrics.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const header = detectHeader(line);
    if (header) {
      if (seen.has(key(header.label))) {
        sections.push({ label: header.label, kind: header.kind, ref: true, lines: [] });
        current = null;
        skipping = true;
      } else {
        seen.add(key(header.label));
        current = { label: header.label, kind: header.kind, ref: false, lines: [] };
        sections.push(current);
        skipping = false;
      }
      continue;
    }
    if (skipping) continue;
    if (!current) {
      current = { label: "VERSE 1", kind: "verse", ref: false, lines: [] };
      seen.add(key("VERSE 1"));
      sections.push(current);
    }
    current.lines.push({ kind: "lyric", pairs: [{ chord: null, text: line }] });
  }
  return sections;
}

// Append the pasted lyrics' sections to an existing chart (non-destructive), so
// pasting adds to the song rather than wiping chords already entered.
export function appendLyrics(chart: ChordChart, lyrics: string): ChordChart {
  return { meta: chart.meta, sections: [...chart.sections, ...lyricsToSections(lyrics)] };
}

// Lyrics-only markdown of the song (chords stripped) — a savable plain-text
// version: `# Title`, then `## SECTION` + the lyric lines. Bars/comments/key
// changes are dropped (this is the words, not the chart).
export function chartToLyricsMarkdown(chart: ChordChart): string {
  const head = chart.meta.title?.trim() ? `# ${chart.meta.title.trim()}\n\n` : "";
  // A ref section recalls an earlier same-label section's lines — expand it so
  // the sheet reads as a full set of lyrics (chorus repeated where it's sung).
  const linesFor = (s: ChordChart["sections"][number]) => {
    if (!s.ref) return s.lines;
    const orig = chart.sections.find((o) => !o.ref && o.label.trim().toLowerCase() === s.label.trim().toLowerCase());
    return orig ? orig.lines : s.lines;
  };
  const body = chart.sections
    .map((s) => {
      const lyrics = linesFor(s)
        .filter((l) => l.kind === "lyric")
        .map((l) => l.pairs.map((p) => p.text).join(""))
        .join("\n");
      const header = `## ${s.label.trim() || "Section"}`;
      return lyrics ? `${header}\n\n${lyrics}` : header;
    })
    .join("\n\n");
  return `${head}${body}\n`;
}
