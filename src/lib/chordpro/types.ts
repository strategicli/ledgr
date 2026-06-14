// The ChordPro AST (Song module, S1). A `song` item's body is
// { format: "chordpro", text } where text is a ChordPro-family source string;
// this module is the one place that turns that text into a structured chart and
// back. Import-pure (no React, no markdown-it, no DB) so the same parser/
// renderer runs in the client editor preview, the server print/share path, and
// a plain-node verify script.

// One chord-over-text unit on a lyric line: the chord (if any) sits above the
// start of `text`. `chord: null` is leading text before the first chord.
export type ChordPair = { chord: string | null; text: string };

// A sung line: a run of chord/text pairs ("[G]Remember those [Em7]walls").
export type LyricLine = { kind: "lyric"; pairs: ChordPair[] };

// An instrumental/bar line ("| G / / / | Gsus / G / |"): each bar is a list of
// tokens (chords or the strum slash "/").
export type BarsLine = { kind: "bars"; bars: string[][] };

// A free comment line inside a section ({c: ...}).
export type CommentLine = { kind: "comment"; text: string };

export type ChartLine = LyricLine | BarsLine | CommentLine;

export type SectionKind =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "tag"
  | "instrumental"
  | "turn"
  | "end"
  | "other";

// A section block. `ref: true` is a repeat reference — the section is authored
// in full once and recalled by label later (the "type once, reference later"
// model); a ref carries no lines of its own.
export type Section = {
  label: string;
  kind: SectionKind;
  ref: boolean;
  lines: ChartLine[];
};

export type ChartMeta = {
  title?: string;
  artist?: string;
  key?: string;
  capo?: number;
  tempo?: number;
  time?: string;
  ccli?: string;
  copyright?: string;
};

export type ChordChart = { meta: ChartMeta; sections: Section[] };

// The format tag stored in items.body.format for song items.
export const CHORDPRO_FORMAT = "chordpro";

// Classify a section label into a kind by its leading word, so the renderer can
// style/colour by kind and the editor's section picker round-trips. Free-text
// labels ("Verse 1", "Chorus 2") map by prefix; anything else is "other".
export function classifySection(label: string): SectionKind {
  const l = label.trim().toLowerCase();
  if (l.startsWith("pre")) return "prechorus";
  if (l.startsWith("intro")) return "intro";
  if (l.startsWith("verse")) return "verse";
  if (l.startsWith("chorus")) return "chorus";
  if (l.startsWith("bridge")) return "bridge";
  if (l.startsWith("tag")) return "tag";
  if (l.startsWith("instrumental") || l.startsWith("inst")) return "instrumental";
  if (l.startsWith("turn")) return "turn";
  if (l.startsWith("end") || l.startsWith("outro")) return "end";
  return "other";
}
