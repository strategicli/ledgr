// Pure edit helpers for the chord editor (S3). The editor holds the ChordChart
// AST in state and mutates it immutably through these; everything here is
// framework-free and unit-tested (verify-chordpro), so the React components
// stay thin. A lyric line is edited as { text, chords[] } — text is the bare
// lyric, each chord carries the character offset it sits at — which converts
// losslessly to/from the AST's ChordPair[] (a chord at offset === text.length
// is a trailing chord, the {chord,""} pair the renderer marks cc-trail).
import type {
  ChartLine,
  ChordChart,
  ChordPair,
  Section,
  SectionKind,
} from "@/lib/chordpro/types";
import { classifySection } from "@/lib/chordpro/types";

export type EditChord = { at: number; chord: string };
export type EditLine = { text: string; chords: EditChord[] };

// Common worship chords offered in the picker (the "no typing brackets" path);
// free text is always allowed too.
export const COMMON_CHORDS = [
  "G", "C", "D", "Em", "Am", "A", "E", "F", "Bm", "B",
  "G/B", "D/F#", "C2", "Em7", "Dsus", "Gsus", "Cmaj7", "Asus", "Esus", "Fmaj7",
];

// ChordPair[] -> { text, chords }. A pair with a chord contributes a chord at
// the running text offset; its empty-text trailing form lands a chord at the
// line's end.
export function pairsToEditLine(pairs: ChordPair[]): EditLine {
  let text = "";
  const chords: EditChord[] = [];
  for (const p of pairs) {
    if (p.chord) {
      // A chord with no text at the very start is a LEADING chord (before the
      // lyrics): offset -1. Empty-text chord after some text is TRAILING (at end).
      const leading = p.text === "" && text === "";
      chords.push({ at: leading ? -1 : text.length, chord: p.chord });
    }
    text += p.text;
  }
  return { text, chords };
}

// { text, chords } -> ChordPair[]. Chords sorted by offset segment the text; a
// chord at text.length yields a final {chord,""} pair (trailing).
export function editLineToPairs(line: EditLine): ChordPair[] {
  // Leading chords (offset < 0) become standalone {chord,""} pairs before the
  // lyrics; positioned chords (>= 0) segment the text as before.
  const leading = line.chords.filter((c) => c.at < 0).sort((a, b) => a.at - b.at);
  const positioned = line.chords.filter((c) => c.at >= 0).sort((a, b) => a.at - b.at);
  const pairs: ChordPair[] = leading.map((c) => ({ chord: c.chord, text: "" }));
  let cursor = 0;
  let pending: string | null = null;
  for (const c of positioned) {
    const at = Math.min(c.at, line.text.length);
    pairs.push({ chord: pending, text: line.text.slice(cursor, at) });
    cursor = at;
    pending = c.chord;
  }
  pairs.push({ chord: pending, text: line.text.slice(cursor) });
  // drop empty, chord-less segments (artifacts of a chord at offset 0)
  const out = pairs.filter((p) => !(p.chord === null && p.text === ""));
  return out.length ? out : [{ chord: null, text: "" }];
}

// Set/replace/remove the chord nearest an offset (within the same word run).
// chord === null removes any chord anchored at exactly `at`.
export function setChordAt(line: EditLine, at: number, chord: string | null): EditLine {
  const chords = line.chords.filter((c) => c.at !== at);
  if (chord) chords.push({ at, chord });
  return { text: line.text, chords };
}

// Replace a line's lyric text, keeping chords whose offset still lands in the
// new text (clamped). Best-effort: edits after a chord keep it; edits before it
// may shift it — the editor warns, and re-placing a chord is one click.
export function setLineText(line: EditLine, text: string): EditLine {
  const chords = line.chords
    .filter((c) => c.at <= text.length)
    .map((c) => ({ ...c, at: Math.min(c.at, text.length) }));
  return { text, chords };
}

// --- immutable chart/section/line updates the editor calls -------------------

function lyricPairs(l: ChartLine): ChordPair[] {
  return l.kind === "lyric" ? l.pairs : [];
}

export function updateMeta(chart: ChordChart, patch: Partial<ChordChart["meta"]>): ChordChart {
  return { ...chart, meta: { ...chart.meta, ...patch } };
}

export function updateSection(chart: ChordChart, i: number, patch: Partial<Section>): ChordChart {
  const sections = chart.sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
  return { ...chart, sections };
}

export function moveSection(chart: ChordChart, i: number, dir: -1 | 1): ChordChart {
  const j = i + dir;
  if (j < 0 || j >= chart.sections.length) return chart;
  const sections = [...chart.sections];
  [sections[i], sections[j]] = [sections[j], sections[i]];
  return { ...chart, sections };
}

export function removeSection(chart: ChordChart, i: number): ChordChart {
  return { ...chart, sections: chart.sections.filter((_, idx) => idx !== i) };
}

export function addSection(chart: ChordChart, label: string): ChordChart {
  const section: Section = {
    label,
    kind: classifySection(label) as SectionKind,
    ref: false,
    lines: [{ kind: "lyric", pairs: [{ chord: null, text: "" }] }],
  };
  return { ...chart, sections: [...chart.sections, section] };
}

export function addRepeat(chart: ChordChart, label: string): ChordChart {
  const section: Section = { label, kind: classifySection(label), ref: true, lines: [] };
  return { ...chart, sections: [...chart.sections, section] };
}

export function setSectionLabel(chart: ChordChart, i: number, label: string): ChordChart {
  return updateSection(chart, i, { label, kind: classifySection(label) });
}

// Replace the lyric line at (sectionIdx, lineIdx) from an EditLine.
export function setLine(chart: ChordChart, si: number, li: number, line: EditLine): ChordChart {
  const section = chart.sections[si];
  if (!section) return chart;
  const lines = section.lines.map((l, idx): ChartLine =>
    idx === li ? { kind: "lyric", pairs: editLineToPairs(line) } : l
  );
  return updateSection(chart, si, { lines });
}

export function addLine(chart: ChordChart, si: number): ChordChart {
  const section = chart.sections[si];
  if (!section) return chart;
  const lines: ChartLine[] = [...section.lines, { kind: "lyric", pairs: [{ chord: null, text: "" }] }];
  return updateSection(chart, si, { lines });
}

export function removeLine(chart: ChordChart, si: number, li: number): ChordChart {
  const section = chart.sections[si];
  if (!section) return chart;
  return updateSection(chart, si, { lines: section.lines.filter((_, idx) => idx !== li) });
}

// Replace any line in place (used by the key-change row's controls).
export function updateLine(chart: ChordChart, si: number, li: number, line: ChartLine): ChordChart {
  const section = chart.sections[si];
  if (!section) return chart;
  return updateSection(chart, si, { lines: section.lines.map((l, idx) => (idx === li ? line : l)) });
}

// Append a mid-song key change (default: transpose up a whole step).
export function addKeyChange(chart: ChordChart, si: number): ChordChart {
  const section = chart.sections[si];
  if (!section) return chart;
  const lines: ChartLine[] = [
    ...section.lines,
    { kind: "keychange", mode: "transpose", semitones: 2 },
  ];
  return updateSection(chart, si, { lines });
}

export { lyricPairs };
