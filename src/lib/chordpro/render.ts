// ChordPro -> chart HTML (Song module, S1). One pure string renderer used by
// every surface: the client editor's Preview, the print/share document, and
// PDF export — so what the writer previews is byte-for-byte what prints. Chords
// render in stacked inline cells (chord over its syllable) that wrap naturally;
// the two-column flow + page CSS live in the consuming shell's stylesheet
// (DOC_CSS in print-html.ts, the editor css), keyed off these class names.
import { parseChordPro } from "./parse";
import { keyOfCapo, transposeChord, transposeNote } from "./transpose";
import type { ChordChart, ChordPair, Section } from "./types";

export type RenderOptions = {
  transpose?: number; // semitones to shift every chord (and the key label)
  preferFlats?: boolean;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chordHtml(chord: string, opts: RenderOptions): string {
  const shifted = opts.transpose
    ? transposeChord(chord, opts.transpose, opts.preferFlats)
    : chord;
  return `<span class="cc-chord">${esc(shifted)}</span>`;
}

function headerHtml(chart: ChordChart, opts: RenderOptions): string {
  const { meta } = chart;
  const t = opts.transpose ?? 0;
  const parts: string[] = [];
  // Only re-spell the key when actually transposing — at 0 semitones the stored
  // spelling must survive (transposeNote would turn "Bb" into "A#").
  const key = meta.key
    ? t
      ? transposeNote(meta.key, t, opts.preferFlats)
      : meta.key
    : undefined;
  if (key) parts.push(`Key: ${esc(key)}`);
  if (meta.capo != null) {
    const shape = key ? keyOfCapo(key, meta.capo, opts.preferFlats) : null;
    parts.push(`Capo: ${meta.capo}${shape ? ` (${esc(shape)})` : ""}`);
  }
  if (meta.tempo != null) parts.push(`Tempo: ${meta.tempo}`);
  if (meta.time) parts.push(`Time: ${esc(meta.time)}`);

  const rows: string[] = [];
  if (meta.title) rows.push(`<div class="cc-title">${esc(meta.title)}</div>`);
  if (meta.artist) rows.push(`<div class="cc-artist">${esc(meta.artist)}</div>`);
  if (parts.length) rows.push(`<div class="cc-meta">${parts.join(" · ")}</div>`);
  if (meta.arrangement)
    rows.push(`<div class="cc-arrangement">${esc(meta.arrangement)}</div>`);
  return rows.length ? `<header class="cc-head">${rows.join("")}</header>` : "";
}

type Cell = { chord: string | null; text: string };
type LineUnit = { word: Cell[] } | { space: string };

// Group a lyric line's chord/text pairs into non-breaking WORD units separated
// by breakable spaces. This keeps a word that a chord splits ("si[C]ght") whole
// across a line wrap, and supports both placements the author controls by
// bracket position: a chord BEFORE a syllable ([G]me) stacks above it; a chord
// with no following text (me [G]) is a TRAILING chord, hugging the end of the
// preceding word at chord height.
function lyricLineHtml(pairs: ChordPair[], opts: RenderOptions): string {
  const units: LineUnit[] = [];
  let cur: Cell[] = [];
  const flush = () => {
    if (cur.length) {
      units.push({ word: cur });
      cur = [];
    }
  };
  const trailing = (chord: string) => {
    // attach to the current word, else the most recent word, so it hugs it
    if (cur.length) return void cur.push({ chord, text: "" });
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if ("word" in u) return void u.word.push({ chord, text: "" });
    }
    cur.push({ chord, text: "" });
  };

  for (const p of pairs) {
    let pending = p.chord;
    for (const seg of p.text.split(/(\s+)/)) {
      if (seg === "") continue;
      if (/^\s+$/.test(seg)) {
        flush();
        units.push({ space: seg });
        continue;
      }
      cur.push({ chord: pending, text: seg });
      pending = null;
    }
    if (pending != null) trailing(pending); // chord with no following text
  }
  flush();

  const cellHtml = (c: Cell) => {
    const chord = c.chord
      ? chordHtml(c.chord, opts)
      : `<span class="cc-chord"></span>`;
    const cls = c.text === "" ? "cc-cell cc-trail" : "cc-cell";
    return `<span class="${cls}">${chord}<span class="cc-text">${esc(c.text)}</span></span>`;
  };
  const html = units
    .map((u) =>
      "space" in u
        ? `<span class="cc-space">${esc(u.space)}</span>`
        : `<span class="cc-word">${u.word.map(cellHtml).join("")}</span>`
    )
    .join("");
  return `<div class="cc-line cc-lyric">${html}</div>`;
}

function sectionHtml(section: Section, opts: RenderOptions): string {
  const kindClass = `cc-${section.kind}`;
  const breakClass = section.breakBefore ? " cc-break" : "";
  const label = section.label
    ? `<div class="cc-label">${esc(section.label)}</div>`
    : "";
  if (section.ref) {
    return `<section class="cc-section cc-ref ${kindClass}${breakClass}">${label}</section>`;
  }

  const linesHtml = section.lines
    .map((line) => {
      if (line.kind === "comment") {
        return `<div class="cc-comment">${esc(line.text)}</div>`;
      }
      if (line.kind === "bars") {
        const bars = line.bars
          .map(
            (bar) =>
              `<span class="cc-bar">${bar
                .map((tok) =>
                  tok === "/"
                    ? `<span class="cc-beat">/</span>`
                    : chordHtml(tok, opts)
                )
                .join(" ")}</span>`
          )
          .join('<span class="cc-pipe">|</span>');
        return `<div class="cc-line cc-bars"><span class="cc-pipe">|</span>${bars}<span class="cc-pipe">|</span></div>`;
      }
      // lyric line: chords stacked over syllables, grouped into non-breaking words
      return lyricLineHtml(line.pairs, opts);
    })
    .join("");

  return `<section class="cc-section ${kindClass}${breakClass}">${label}${linesHtml}</section>`;
}

function footerHtml(chart: ChordChart): string {
  const { meta } = chart;
  const bits: string[] = [];
  if (meta.copyright) bits.push(esc(meta.copyright));
  if (meta.ccli) bits.push(`CCLI Song No. ${esc(meta.ccli)}`);
  return bits.length ? `<footer class="cc-foot">${bits.join(" · ")}</footer>` : "";
}

export function chartToHtml(chart: ChordChart, opts: RenderOptions = {}): string {
  const body = chart.sections.map((s) => sectionHtml(s, opts)).join("");
  return (
    `<div class="cc-chart">` +
    headerHtml(chart, opts) +
    `<div class="cc-body">${body}</div>` +
    footerHtml(chart) +
    `</div>`
  );
}

export function chordProToHtml(source: string, opts: RenderOptions = {}): string {
  return chartToHtml(parseChordPro(source), opts);
}
