// Export a chart in Planning Center's Lyrics & Chords format, for pasting into
// PCO's editor. Per PCO's spec the body uses:
//   - SECTION HEADINGS as plain ALL-CAPS lines (no {comment:}, no chords on them)
//   - [chord] inline ChordPro (placed above the lyric, chord-chart only)
//   - { note } single-curly notes (shown on chord + lyric PDFs)
//   - {{ note }} double-curly notes (chord-chart PDFs only)
//   - bare COLUMN_BREAK / PAGE_BREAK tokens for layout
// PCO does NOT read ChordPro {title}/{key}/{capo}/{tempo} directives in the
// editor (those are arrangement fields), so song metadata goes in a single
// chord-chart-only {{ … }} note at the top rather than as directives.
import { lineToSource } from "./parse";
import type { ChordChart } from "./types";

// Instrumental/bar line → plain bar notation ("| G | G | Em | Em |"); PCO shows
// the chord names as typed on the chart, no brackets.
function barsToPco(bars: string[][]): string {
  return `| ${bars.map((bar) => bar.join(" ")).join(" | ")} |`;
}

export function toPlanningCenterChordPro(chart: ChordChart): string {
  const out: string[] = [];
  const m = chart.meta;

  // Key / capo / tempo / time as a chord-chart-only note (PCO sets these in the
  // arrangement; this keeps them visible on the pasted chart without polluting
  // lyric PDFs).
  const info: string[] = [];
  if (m.key) info.push(`Key: ${m.key}`);
  if (m.capo != null) info.push(`Capo: ${m.capo}`);
  if (m.tempo != null) info.push(`${m.tempo} bpm`);
  if (m.time) info.push(m.time);
  if (info.length) out.push(`{{ ${info.join(" · ")} }}`);

  for (const section of chart.sections) {
    out.push("");
    if (section.pageBreakBefore) out.push("PAGE_BREAK");
    if (section.breakBefore) out.push("COLUMN_BREAK");
    if (section.label) out.push(section.label.toUpperCase());
    if (section.ref) continue; // a repeat is just the heading, no lyrics
    for (const line of section.lines) {
      if (line.kind === "lyric") out.push(lineToSource(line)); // [G]lyric
      else if (line.kind === "bars") out.push(barsToPco(line.bars));
      else if (line.kind === "keychange") {
        const sign = line.semitones >= 0 ? `+${line.semitones}` : `${line.semitones}`;
        out.push(`${line.mode === "redefine" ? "REDEFINE" : "TRANSPOSE"} KEY ${sign}`);
      } else out.push(`{${line.text}}`); // single-curly note
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
