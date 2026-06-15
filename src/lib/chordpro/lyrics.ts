// Lyrics import (Song module; v5). Turn a pasted block of plain lyrics into chart
// sections so the writer can add chords in the editor. Section headers ("Verse 1",
// "Chorus", "[Bridge]", "Pre-Chorus:") start a new section; every other non-blank
// line becomes a chord-less lyric line (one `{chord:null}` pair). Deterministic,
// pure (no React/DB) so it's node-testable and runs the same in the client.
import type { ChartLine, ChordChart, LyricLine, Section, SectionKind } from "@/lib/chordpro/types";

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

// A section header: a short line that either is fully [bracketed] (always a
// header, any label) or starts with a known section word. Long unbracketed lines
// are lyrics. Labels normalize to uppercase for consistent styling ("[tag]" →
// "TAG", "Chorus" → "CHORUS", "VERSE 1" stays "VERSE 1").
function detectHeader(line: string): { label: string; kind: SectionKind } | null {
  const bracketed = /^\[.+\]$/.test(line.trim());
  const cleaned = line.replace(/^\[/, "").replace(/\]$/, "").replace(/:\s*$/, "").trim();
  if (!cleaned || cleaned.length > 24) return null;
  const kind = SECTION_KEYWORDS.find((k) => k.re.test(cleaned))?.kind;
  if (kind) return { label: cleaned.toUpperCase(), kind };
  if (bracketed) return { label: cleaned.toUpperCase(), kind: "other" }; // any [Label]
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

const lyricTextOf = (l: LyricLine) => l.pairs.map((p) => p.text).join("");

// The song's lyrics as editable plain text for the Lyrics tab — the same format
// the user pastes. Each section is a header line (a known kind stays bare, e.g.
// "CHORUS"; any other label is [bracketed] so it round-trips as a header) then
// its lyric lines, sections blank-separated. Refs expand to the recalled words.
export function chartToLyricsText(chart: ChordChart): string {
  const linesFor = (s: Section) =>
    s.ref
      ? chart.sections.find((o) => !o.ref && o.label.trim().toLowerCase() === s.label.trim().toLowerCase())?.lines ?? []
      : s.lines;
  return chart.sections
    .map((s) => {
      const header = detectHeader(s.label) ? s.label : `[${s.label}]`;
      const lyrics = linesFor(s)
        .filter((l): l is LyricLine => l.kind === "lyric")
        .map(lyricTextOf)
        .join("\n");
      return lyrics ? `${header}\n${lyrics}` : header;
    })
    .join("\n\n");
}

// Re-sync edited lyrics back into the chart WITHOUT losing chords: re-parse the
// lyrics to sections, then for each section (matched to the old one by label)
// restore each unchanged lyric line's chords (matched by exact text), leaving
// edited/new lines chord-less. Old non-lyric lines (bars/comments) are carried
// over. So lyrics and chords can be edited independently. For an empty chart this
// is just the parsed lyrics (nothing to preserve).
export function mergeLyricsIntoChart(chart: ChordChart, lyrics: string): ChordChart {
  const parsed = lyricsToSections(lyrics);
  const oldByLabel = new Map<string, Section[]>();
  for (const s of chart.sections) {
    const k = s.label.trim().toLowerCase();
    (oldByLabel.get(k) ?? oldByLabel.set(k, []).get(k)!).push(s);
  }
  const sections = parsed.map((ns) => {
    if (ns.ref) return ns;
    const old = oldByLabel.get(ns.label.trim().toLowerCase())?.shift();
    if (!old) return ns;
    const oldLyrics = old.lines.filter((l): l is LyricLine => l.kind === "lyric");
    const used = new Set<number>();
    const lines: ChartLine[] = ns.lines.map((nl) => {
      if (nl.kind !== "lyric") return nl;
      const text = lyricTextOf(nl);
      const i = oldLyrics.findIndex((ol, idx) => !used.has(idx) && lyricTextOf(ol) === text);
      if (i >= 0) {
        used.add(i);
        return oldLyrics[i]; // unchanged line → keep its chords
      }
      return nl; // edited/new line → chord-less
    });
    const extras = old.lines.filter((l) => l.kind !== "lyric"); // bars/comments/keychange
    return { ...ns, breakBefore: old.breakBefore, pageBreakBefore: old.pageBreakBefore, lines: [...lines, ...extras] };
  });
  return { meta: chart.meta, sections };
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
