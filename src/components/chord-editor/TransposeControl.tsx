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

// Line-art padlock (lucide-style), open or closed; inherits the button color.
function LockIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      {open ? <path d="M7 11V7a5 5 0 0 1 9.9-1" /> : <path d="M7 11V7a5 5 0 0 1 10 0v4" />}
    </svg>
  );
}

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
  const [lockShapes, setLockShapes] = useState(false);
  const key = chart.meta.key;
  const capo = chart.meta.capo ?? 0;

  // Shapes locked: move the capo and let the key follow (G shapes + capo 4 → B).
  // The chords never rewrite; only the capo and the derived sounding key change.
  const moveCapoLocked = (target: number) => {
    const clamped = Math.max(0, Math.min(11, target));
    const delta = clamped - capo;
    onChange(
      updateMeta(chart, {
        capo: clamped === 0 ? undefined : clamped,
        key: key ? transposeNote(key, delta, preferFlats) : undefined,
      })
    );
  };

  // Transpose: shapes locked → just slide the capo/key; otherwise rewrite every
  // shape and move the key with it (capo unchanged).
  const transpose = (n: number) => {
    if (lockShapes) return moveCapoLocked(capo + n);
    const next = transposeChartChords(chart, n, preferFlats);
    onChange(updateMeta(next, { key: key ? transposeNote(key, n, preferFlats) : undefined }));
  };

  // Capo: shapes locked → the key follows the capo (no shape rewrite); otherwise
  // shift shapes by the opposite delta so the sounding key holds.
  const setCapo = (c: number) => {
    if (lockShapes) return moveCapoLocked(c);
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
          shapes: <span className="font-semibold text-[var(--accent)]">{shapes}</span>
        </span>
      )}
      <button
        onClick={() => setLockShapes((l) => !l)}
        aria-pressed={lockShapes}
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${
          lockShapes
            ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
            : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
        }`}
        title="Lock shapes: keep the chord shapes and let the capo set the key"
      >
        <LockIcon open={!lockShapes} />
        shapes
      </button>
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
