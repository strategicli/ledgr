// Transpose + capo control (S4). Transpose shifts the sounding key and every
// chord shape together; capo shifts the shapes inversely so the song still
// sounds in the same key (Bb sounding, capo 2 → G shapes). Both rewrite the
// chart's chords via the S1-verified transposeChartChords; the header shows
// "Key: A · Capo: 2 (G)" derived live. ♯/♭ toggles enharmonic spelling.
"use client";

import { useState } from "react";
import {
  keyOfCapo,
  transposeChartChords,
  transposeNote,
} from "@/lib/chordpro/transpose";
import type { ChordChart } from "@/lib/chordpro/types";
import { updateMeta } from "./chordpro-edit";

type Props = { chart: ChordChart; onChange: (next: ChordChart) => void };

function Stepper({
  label,
  value,
  onDown,
  onUp,
}: {
  label: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
      <span className="uppercase tracking-wide text-neutral-500">{label}</span>
      <button onClick={onDown} className="rounded bg-neutral-800 px-1.5 leading-5 hover:bg-neutral-700">−</button>
      <span className="min-w-[2.5rem] text-center font-semibold text-neutral-200">{value}</span>
      <button onClick={onUp} className="rounded bg-neutral-800 px-1.5 leading-5 hover:bg-neutral-700">+</button>
    </span>
  );
}

export default function TransposeControl({ chart, onChange }: Props) {
  const [preferFlats, setPreferFlats] = useState(false);
  const key = chart.meta.key;
  const capo = chart.meta.capo ?? 0;

  // Transpose the whole song by n semitones: shapes + sounding key move together.
  const transpose = (n: number) => {
    const next = transposeChartChords(chart, n, preferFlats);
    onChange(updateMeta(next, { key: key ? transposeNote(key, n, preferFlats) : undefined }));
  };

  // Change the capo: shift shapes by the opposite delta so the sounding key holds.
  const setCapo = (c: number) => {
    const clamped = Math.max(0, Math.min(11, c));
    const next = transposeChartChords(chart, capo - clamped, preferFlats);
    onChange(updateMeta(next, { capo: clamped === 0 ? undefined : clamped }));
  };

  const shapes = key ? keyOfCapo(key, capo, preferFlats) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Stepper
        label="Key"
        value={key ?? "—"}
        onDown={() => transpose(-1)}
        onUp={() => transpose(1)}
      />
      <Stepper label="Capo" value={String(capo)} onDown={() => setCapo(capo - 1)} onUp={() => setCapo(capo + 1)} />
      {shapes && capo > 0 && (
        <span className="text-xs text-neutral-500">
          shapes: <span className="font-semibold text-sky-400">{shapes}</span>
        </span>
      )}
      <button
        onClick={() => setPreferFlats((f) => !f)}
        className="rounded border border-neutral-800 px-1.5 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
        title="Toggle sharp / flat spelling for transposes"
      >
        {preferFlats ? "♭" : "♯"}
      </button>
    </div>
  );
}
