// The click-to-add chord popover (S3): pick a common chord or type any chord,
// no brackets. Editing an existing chord pre-fills and offers Remove. Floats at
// the click point; Enter commits, Esc closes.
"use client";

import { useEffect, useRef, useState } from "react";
import { COMMON_CHORDS } from "./chordpro-edit";

export type PickerProps = {
  x: number;
  y: number;
  value: string | null; // existing chord at this spot, or null when adding
  onPick: (chord: string) => void;
  onRemove: () => void;
  onClose: () => void;
};

export default function ChordPicker({ x, y, value, onPick, onRemove, onClose }: PickerProps) {
  const [text, setText] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = (chord: string) => {
    const c = chord.trim();
    if (c) onPick(c);
    else onClose();
  };

  return (
    <>
      {/* click-away catcher */}
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <div
        className="fixed z-[61] w-56 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-2xl"
        style={{ left: Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 240), top: y + 8 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Chord (e.g. G/B)"
          className="mb-2 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-sky-600"
        />
        <div className="flex flex-wrap gap-1">
          {COMMON_CHORDS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => commit(c)}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs font-semibold text-sky-300 hover:bg-neutral-700"
            >
              {c}
            </button>
          ))}
        </div>
        {value && (
          <button
            type="button"
            onClick={onRemove}
            className="mt-2 w-full rounded border border-neutral-700 px-2 py-1 text-xs text-red-400 hover:bg-neutral-800"
          >
            Remove chord
          </button>
        )}
      </div>
    </>
  );
}
