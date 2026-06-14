// ChordPro -> chart HTML (Song module, S1). One pure string renderer used by
// every surface: the client editor's Preview, the print/share document, and
// PDF export — so what the writer previews is byte-for-byte what prints. Chords
// render in stacked inline cells (chord over its syllable) that wrap naturally;
// the two-column flow + page CSS live in the consuming shell's stylesheet
// (DOC_CSS in print-html.ts, the editor css), keyed off these class names.
import { parseChordPro } from "./parse";
import { keyOfCapo, transposeChord, transposeNote } from "./transpose";
import type { ChordChart, Section } from "./types";

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
      // lyric line: each pair is a stacked cell (chord over its syllable)
      const cells = line.pairs
        .map((p) => {
          const chord = p.chord ? chordHtml(p.chord, opts) : `<span class="cc-chord"></span>`;
          return `<span class="cc-cell">${chord}<span class="cc-text">${esc(p.text)}</span></span>`;
        })
        .join("");
      return `<div class="cc-line cc-lyric">${cells}</div>`;
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
