// Chord transposition + capo math (Song module, S1). Pure functions over chord
// tokens; the interactive key/capo control (S4) rides on these, and the verify
// script pins them. A "chord" here is a shape token like G, Em7, C2/E,
// Cmaj7(no3), D(4) — only the root note (and the slash bass note) move; the
// quality/suffix is preserved verbatim.

import type { ChordChart } from "./types";

const SHARP_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NOTES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// note name -> pitch class 0..11 (accepts sharps and flats)
const PITCH_CLASS: Record<string, number> = {};
SHARP_NOTES.forEach((n, i) => (PITCH_CLASS[n] = i));
FLAT_NOTES.forEach((n, i) => (PITCH_CLASS[n] = i));

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

// Transpose a bare note name ("Bb", "C#", "G") by a number of semitones.
// Returns the spelled note; non-notes pass through unchanged.
export function transposeNote(
  note: string,
  semitones: number,
  preferFlats = false
): string {
  const pc = PITCH_CLASS[note];
  if (pc === undefined) return note;
  const next = mod12(pc + semitones);
  return (preferFlats ? FLAT_NOTES : SHARP_NOTES)[next];
}

const NOTE_RE = /^([A-G][#b]?)(.*)$/;

// Transpose one segment "root + suffix" (no slash). "Em7" -> root E, suffix m7.
function transposeSegment(seg: string, semitones: number, preferFlats: boolean): string {
  const m = NOTE_RE.exec(seg);
  if (!m) return seg; // not a chord (e.g. "N.C.") — leave alone
  return transposeNote(m[1], semitones, preferFlats) + m[2];
}

// Transpose a full chord token, including a slash bass ("C2/E" -> "D2/F#").
// A pure strum slash "/" or a bar pipe "|" passes through untouched.
export function transposeChord(
  chord: string,
  semitones: number,
  preferFlats = false
): string {
  if (semitones % 12 === 0) return chord;
  if (chord === "/" || chord === "|" || chord.trim() === "") return chord;
  const slash = chord.indexOf("/");
  if (slash === -1) return transposeSegment(chord, semitones, preferFlats);
  const main = chord.slice(0, slash);
  const bass = chord.slice(slash + 1);
  return (
    transposeSegment(main, semitones, preferFlats) +
    "/" +
    transposeSegment(bass, semitones, preferFlats)
  );
}

// Semitone distance from one key/note to another (e.g. for "transpose to D").
export function semitonesBetween(fromKey: string, toKey: string): number {
  const a = NOTE_RE.exec(fromKey);
  const b = NOTE_RE.exec(toKey);
  if (!a || !b) return 0;
  return mod12((PITCH_CLASS[b[1]] ?? 0) - (PITCH_CLASS[a[1]] ?? 0));
}

// The chord SHAPE key a capo produces: a song that SOUNDS in `soundingKey`
// played with a capo on fret `capo` uses shapes a `capo`-semitones-lower key.
// keyOfCapo("Bb", 3) === "G".  (Capo raises pitch, so shapes are lower.)
export function keyOfCapo(soundingKey: string, capo: number, preferFlats = false): string {
  return transposeNote(soundingKey, -capo, preferFlats);
}

// Shift every chord token in a chart (lyric chords + bar tokens) by `semitones`.
// Pure (type-only import); the transpose/capo control composes this with a meta
// update — transposing changes the sounding key, a capo change shifts the
// shapes inversely so the sounding key holds.
export function transposeChartChords(
  chart: ChordChart,
  semitones: number,
  preferFlats = false
): ChordChart {
  if (semitones % 12 === 0) return chart;
  const tx = (c: string) => transposeChord(c, semitones, preferFlats);
  return {
    ...chart,
    sections: chart.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => {
        if (l.kind === "lyric") {
          return { ...l, pairs: l.pairs.map((p) => ({ ...p, chord: p.chord ? tx(p.chord) : null })) };
        }
        if (l.kind === "bars") {
          return { ...l, bars: l.bars.map((bar) => bar.map(tx)) };
        }
        return l;
      }),
    })),
  };
}
