// ChordPro parse + serialize (Song module, S1). A pragmatic ChordPro-family
// dialect — standard metadata directives ({title}/{key}/{capo}/{tempo}/{time}/
// {ccli}), inline chords ([G]word), bar lines (| G / / / |), labelled sections
// ({section: Verse 1}), and a repeat reference ({repeat: Chorus}) for the
// "author once, recall later" model. parse and serialize are inverse: for any
// chart, parse(serialize(chart)) deep-equals it (the verify script pins this).
import {
  classifySection,
  type ChartLine,
  type ChartMeta,
  type ChordChart,
  type ChordPair,
  type Section,
} from "./types";

const DIRECTIVE_RE = /^\{\s*([a-zA-Z_]+)\s*(?::\s*([\s\S]*?))?\s*\}$/;
const INLINE_CHORD_RE = /\[([^\]]*)\]/g;

// Standard ChordPro environment-open aliases mapped to a section label.
const ENV_OPEN: Record<string, string> = {
  soc: "Chorus",
  start_of_chorus: "Chorus",
  sov: "Verse",
  start_of_verse: "Verse",
  sob: "Bridge",
  start_of_bridge: "Bridge",
};
const ENV_CLOSE = new Set([
  "eoc",
  "end_of_chorus",
  "eov",
  "end_of_verse",
  "eob",
  "end_of_bridge",
]);

function parseLyric(line: string): ChordPair[] {
  const matches: { chord: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  INLINE_CHORD_RE.lastIndex = 0;
  while ((m = INLINE_CHORD_RE.exec(line))) {
    matches.push({ chord: m[1], start: m.index, end: m.index + m[0].length });
  }
  if (matches.length === 0) return [{ chord: null, text: line }];
  const pairs: ChordPair[] = [];
  if (matches[0].start > 0) {
    pairs.push({ chord: null, text: line.slice(0, matches[0].start) });
  }
  for (let i = 0; i < matches.length; i++) {
    const textEnd = i + 1 < matches.length ? matches[i + 1].start : line.length;
    pairs.push({ chord: matches[i].chord, text: line.slice(matches[i].end, textEnd) });
  }
  return pairs;
}

// A bar line is recognised by containing a pipe; tokens split on whitespace.
function parseBars(line: string): string[][] {
  return line
    .split("|")
    .map((bar) => bar.trim())
    .filter((bar) => bar.length > 0)
    .map((bar) => bar.split(/\s+/));
}

export function parseChordPro(text: string): ChordChart {
  const meta: ChartMeta = {};
  const sections: Section[] = [];
  let current: Section | null = null;
  let pendingBreak = false;

  const openSection = (label: string, ref = false) => {
    if (current) sections.push(current);
    current = { label, kind: classifySection(label), ref, lines: [] };
    if (pendingBreak) {
      current.breakBefore = true;
      pendingBreak = false;
    }
    if (ref) {
      sections.push(current);
      current = null;
    }
  };
  const ensureSection = () => {
    if (!current) current = { label: "", kind: "other", ref: false, lines: [] };
  };
  const pushLine = (line: ChartLine) => {
    ensureSection();
    current!.lines.push(line);
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;

    // Planning Center emits a bare COLUMN_BREAK token; treat it the same as a
    // {column_break} directive — the next section starts the next column.
    if (line.toUpperCase() === "COLUMN_BREAK") {
      pendingBreak = true;
      continue;
    }

    const dir = DIRECTIVE_RE.exec(line);
    if (dir) {
      const name = dir[1].toLowerCase();
      const value = (dir[2] ?? "").trim();
      switch (name) {
        case "title":
        case "t":
          meta.title = value;
          break;
        case "subtitle":
        case "artist":
        case "st":
          meta.artist = value;
          break;
        case "key":
          meta.key = value;
          break;
        case "capo": {
          const n = parseInt(value, 10);
          if (!Number.isNaN(n)) meta.capo = n;
          break;
        }
        case "tempo": {
          const n = parseInt(value, 10);
          if (!Number.isNaN(n)) meta.tempo = n;
          break;
        }
        case "time":
          meta.time = value;
          break;
        case "arrangement":
        case "sequence":
          meta.arrangement = value;
          break;
        case "column_break":
        case "colb":
          pendingBreak = true;
          break;
        case "ccli":
          meta.ccli = value;
          break;
        case "copyright":
        case "footer":
          meta.copyright = value;
          break;
        case "section":
          openSection(value);
          break;
        case "repeat":
          openSection(value, true);
          break;
        case "comment":
        case "c":
          pushLine({ kind: "comment", text: value });
          break;
        default:
          if (name in ENV_OPEN) openSection(value || ENV_OPEN[name]);
          else if (ENV_CLOSE.has(name)) {
            /* close is implicit at next open / EOF */
          }
          // unknown directive: ignore (forward-compatible)
          break;
      }
      continue;
    }

    if (line.includes("|")) pushLine({ kind: "bars", bars: parseBars(line) });
    else pushLine({ kind: "lyric", pairs: parseLyric(line) });
  }
  if (current) sections.push(current);

  return { meta, sections };
}

function lyricToText(pairs: ChordPair[]): string {
  return pairs.map((p) => (p.chord ? `[${p.chord}]` : "") + p.text).join("");
}

function barsToText(bars: string[][]): string {
  return "| " + bars.map((bar) => bar.join(" ")).join(" | ") + " |";
}

const META_ORDER: [keyof ChartMeta, string][] = [
  ["title", "title"],
  ["artist", "artist"],
  ["key", "key"],
  ["capo", "capo"],
  ["tempo", "tempo"],
  ["time", "time"],
  ["arrangement", "arrangement"],
  ["ccli", "ccli"],
  ["copyright", "copyright"],
];

export function serializeChordChart(chart: ChordChart): string {
  const out: string[] = [];
  for (const [field, name] of META_ORDER) {
    const v = chart.meta[field];
    if (v !== undefined && v !== "") out.push(`{${name}: ${v}}`);
  }
  for (const section of chart.sections) {
    if (out.length > 0) out.push("");
    if (section.breakBefore) out.push("{column_break}");
    if (section.ref) {
      out.push(`{repeat: ${section.label}}`);
      continue;
    }
    out.push(`{section: ${section.label}}`);
    for (const line of section.lines) {
      if (line.kind === "lyric") out.push(lyricToText(line.pairs));
      else if (line.kind === "bars") out.push(barsToText(line.bars));
      else out.push(`{c: ${line.text}}`);
    }
  }
  return out.join("\n");
}
