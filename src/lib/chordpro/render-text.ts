// ChordPro -> plain lyric text for the FTS index (Song module, S1). Lyrics are
// what you search a song by; chords, directives, bar lines, and repeat labels
// are not, so they're dropped. `extractBodyText` routes chordpro bodies here
// (markdown bodies keep going through markdownToText).
import { parseChordPro } from "./parse";
import type { ChordChart } from "./types";

export function chartToText(chart: ChordChart): string {
  const parts: string[] = [];
  for (const section of chart.sections) {
    if (section.ref) continue; // a repeat reference adds no new lyrics
    for (const line of section.lines) {
      if (line.kind === "lyric") {
        const text = line.pairs.map((p) => p.text).join("");
        if (text.trim()) parts.push(text.trim());
      }
      // bars and comments contribute no searchable lyric text
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function chordProToText(source: string): string {
  return chartToText(parseChordPro(source));
}
