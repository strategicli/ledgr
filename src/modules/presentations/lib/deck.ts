// A body → a slide deck (the presentations module, explorations/presentations.md).
//
// Two ways to write, one player:
//   - MANUSCRIPT mode, whenever the body carries a slide mark (ADR-176): each
//     marked span is a slide and the prose between two cues is the speaker's
//     notes for the first. Reuses boothExport so slide N here is the same slide
//     as the booth copy's [SLIDE N] cue.
//   - DECK mode otherwise: `---` (after a blank line) starts a slide; with no
//     breaks, each H1/H2 does. CriticMarkup comments (ADR-170) are the notes.
//
// Nothing here is new body syntax: `---` is CommonMark and comments are already
// in the dialect. Pure and dependency-light (server + verify-script safe).
import { boothExport } from "@/lib/editor/booth-export";
import { stripComments } from "@/lib/editor/comment-markdown";
import type { ChordChart, LyricLine, Section } from "@/lib/chordpro/types";

export type DeckSlide = { md: string; notes: string };
export type Deck = { mode: "manuscript" | "deck"; slides: DeckSlide[] };

const FENCE = /^ *(`{3,}|~{3,})/;
const RULE = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^ {0,3}#{1,2}\s/;
const NOTE = /\{>>([^\n]*?)<<\}/g;
const CUE = /\*\*\[SLIDE \d+\]\*\* ?/;

// Splits on lines `isBreak` accepts, never inside a code fence. `keep` puts the
// breaking line at the top of the next chunk (a heading) instead of dropping it
// (a rule).
function split(md: string, isBreak: (line: string, prev: string) => boolean, keep: boolean): string[] {
  const chunks: string[][] = [[]];
  let fence = "";
  let prev = "";
  for (const line of md.split("\n")) {
    const f = FENCE.exec(line);
    if (f) fence = fence ? (f[1][0] === fence ? "" : fence) : f[1][0];
    else if (!fence && isBreak(line, prev)) {
      chunks.push(keep ? [line] : []);
      prev = line;
      continue;
    }
    chunks[chunks.length - 1].push(line);
    prev = line;
  }
  return chunks.map((c) => c.join("\n").trim());
}

function deckSlide(chunk: string): DeckSlide {
  const notes = [...chunk.matchAll(NOTE)].map((m) => m[1].trim()).filter(Boolean);
  return { md: stripComments(chunk).trim(), notes: notes.join("\n\n") };
}

export function buildDeck(markdown: string, title = ""): Deck {
  const md = markdown ?? "";
  const { manuscript, slides } = boothExport(md);
  if (slides.length > 0) {
    // parts[0] is everything before the first cue: the intro, spoken over the
    // title slide. parts[n] is what follows cue n, up to the next one.
    const parts = manuscript.split(CUE).map((p) => p.trim());
    return {
      mode: "manuscript",
      slides: [
        { md: title ? `# ${title}` : "", notes: parts[0] ?? "" },
        ...slides.map((s, i) => ({ md: s.text, notes: parts[i + 1] ?? "" })),
      ],
    };
  }

  let chunks = split(md, (line, prev) => RULE.test(line) && prev.trim() === "", false);
  if (chunks.length === 1) chunks = split(md, (line) => HEADING.test(line), true);
  const out = chunks.map(deckSlide).filter((s) => s.md || s.notes);
  return { mode: "deck", slides: out.length ? out : [{ md: title ? `# ${title}` : "", notes: "" }] };
}

// A slide whose only content is one item link (`[@Title](ledgr://item/<id>)`)
// embeds that item (step 5). Returns the id, or null for any other slide.
const SOLE_MENTION = /^\[@?[^\]\n]*\]\(ledgr:\/\/item\/([0-9a-f-]{36})\)$/i;
export function soleMention(md: string): string | null {
  return SOLE_MENTION.exec(md.trim())?.[1] ?? null;
}

// A ref section (chordpro's "type once, recall by label" model) carries no
// lines of its own; resolve it to the original section's lines. Mirrors
// chartToLyricsMarkdown's ref-expansion (src/lib/chordpro/lyrics.ts).
function chordProSectionLines(chart: ChordChart, s: Section): Section["lines"] {
  if (!s.ref) return s.lines;
  return (
    chart.sections.find((o) => !o.ref && o.label.trim().toLowerCase() === s.label.trim().toLowerCase())
      ?.lines ?? []
  );
}

// A song embedded in a slide (step 5): one slide per section, lyrics only,
// chords stripped, empty sections skipped. Notes are empty — a chart section
// carries no speaker notes of its own.
export function chordProToSlides(chart: ChordChart): DeckSlide[] {
  return chart.sections
    .map((s) =>
      chordProSectionLines(chart, s)
        .filter((l): l is LyricLine => l.kind === "lyric")
        .map((l) => l.pairs.map((p) => p.text).join(""))
        .join("\n")
    )
    .filter(Boolean)
    .map((md) => ({ md, notes: "" }));
}
