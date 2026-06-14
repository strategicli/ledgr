// Export a chart as portable ChordPro for pasting into Planning Center's
// Lyrics & Chords editor (PCO imports ChordPro). Our internal dialect uses
// {section: …}/{repeat: …} and layout directives (column/page break,
// arrangement) that aren't standard ChordPro; this emits the widely-understood
// subset — standard metadata directives, section labels as {comment: …}, and
// inline [chord]lyrics — so the paste lands clean. Pure (type-only + lineToSource).
import { lineToSource } from "./parse";
import type { ChordChart } from "./types";

export function toPlanningCenterChordPro(chart: ChordChart): string {
  const out: string[] = [];
  const m = chart.meta;
  if (m.title) out.push(`{title: ${m.title}}`);
  if (m.artist) out.push(`{subtitle: ${m.artist}}`);
  if (m.key) out.push(`{key: ${m.key}}`);
  if (m.capo != null) out.push(`{capo: ${m.capo}}`);
  if (m.tempo != null) out.push(`{tempo: ${m.tempo}}`);
  if (m.time) out.push(`{time: ${m.time}}`);
  if (m.ccli) out.push(`{ccli: ${m.ccli}}`);

  for (const section of chart.sections) {
    out.push("");
    // Section label as a comment — PCO (and most ChordPro tools) show it as a
    // heading. A repeat reference is just the label, no lyrics.
    if (section.label) out.push(`{comment: ${section.label}}`);
    if (section.ref) continue;
    for (const line of section.lines) out.push(lineToSource(line));
  }

  return out.join("\n").trim() + "\n";
}
