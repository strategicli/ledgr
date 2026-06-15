// The Edit-mode WYSIWYG chord editor (S3). Operates on the ChordChart AST in
// state (lifted to ChordCanvasClient, which autosaves). The headline: click a
// word to drop a chord above it — no [G] typing. Each line can also flip to a
// raw ChordPro input (✎) for power edits. Metadata and sections are plain
// controls. Preview (the finished 2-column chart) is the other half of the
// canvas toggle.
"use client";

import { useState, type ReactNode } from "react";
import { lineToSource, parseLineSource } from "@/lib/chordpro/parse";
import type { ChordChart } from "@/lib/chordpro/types";
import ChordPicker from "./ChordPicker";
import {
  addKeyChange,
  addLine,
  addRepeat,
  addSection,
  type EditChord,
  moveSection,
  pairsToEditLine,
  removeLine,
  removeSection,
  setChordAt,
  setLine,
  setSectionLabel,
  updateLine,
  updateMeta,
} from "./chordpro-edit";

type Props = {
  chart: ChordChart;
  onChange: (next: ChordChart) => void;
  title: string;
  onTitleChange: (title: string) => void;
};

type PickerTarget = { si: number; li: number; at: number; value: string | null; x: number; y: number };

const META_FIELDS: { key: keyof ChordChart["meta"]; label: string; width: string }[] = [
  { key: "key", label: "Key", width: "w-16" },
  { key: "capo", label: "Capo", width: "w-14" },
  { key: "tempo", label: "Tempo", width: "w-16" },
  { key: "time", label: "Time", width: "w-14" },
];

export default function ChordEditor({ chart, onChange, title, onTitleChange }: Props) {
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [rawEditing, setRawEditing] = useState<Set<string>>(new Set());

  const toggleRaw = (k: string) =>
    setRawEditing((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const openPicker = (si: number, li: number, at: number, value: string | null, e: React.MouseEvent) =>
    setPicker({ si, li, at, value, x: e.clientX, y: e.clientY });

  const applyChord = (chord: string | null) => {
    if (!picker) return;
    const { si, li, at } = picker;
    const line = chart.sections[si]?.lines[li];
    if (line && line.kind === "lyric") {
      const edit = setChordAt(pairsToEditLine(line.pairs), at, chord);
      onChange(setLine(chart, si, li, edit));
    }
    setPicker(null);
  };

  // Render a lyric line character by character so a chord can sit above the
  // exact letter you click (mid-syllable, S5). Non-space runs group into
  // non-breaking words; spaces stay breakable wrap points; a trailing slot sits
  // after the last word. Each character's chord row + the character itself open
  // the picker at that precise offset.
  const lyricCells = (text: string, chords: EditChord[], si: number, li: number): ReactNode => {
    const chordAt = new Map<number, string>();
    chords.forEach((c) => chordAt.set(c.at, c.chord));
    const leading = chords.filter((c) => c.at < 0); // chord before the lyrics
    const cell = (ch: string, i: number): ReactNode => (
      <span key={i} className="group/ch inline-flex cursor-pointer flex-col items-center rounded hover:bg-neutral-800/50">
        <button
          className="flex h-4 items-end leading-none"
          onClick={(e) => openPicker(si, li, i, chordAt.get(i) ?? null, e)}
          title="Add / edit chord here"
        >
          {chordAt.has(i) ? (
            <span className="px-0.5 text-[0.72rem] font-bold text-[var(--accent)]">{chordAt.get(i)}</span>
          ) : (
            <span className="text-[0.72rem] text-neutral-600 opacity-0 group-hover/ch:opacity-100">+</span>
          )}
        </button>
        <button className="leading-snug" onClick={(e) => openPicker(si, li, i, chordAt.get(i) ?? null, e)}>
          {ch}
        </button>
      </span>
    );
    const units: ReactNode[] = [];
    // leading chord slot — a chord that sounds before the lyrics begin
    units.push(
      <span key="lead" className="inline-flex flex-col items-center">
        <button
          className="flex h-4 items-end leading-none"
          onClick={(e) => openPicker(si, li, -1, leading[0]?.chord ?? null, e)}
          title="Chord before the line"
        >
          {leading.length ? (
            <span className="px-0.5 text-[0.72rem] font-bold text-[var(--accent)]">{leading[0].chord}</span>
          ) : (
            <span className="text-[0.72rem] text-neutral-700">＋</span>
          )}
        </button>
        <span className="h-4 w-2" />
      </span>
    );
    let word: ReactNode[] = [];
    const flush = (key: string) => {
      if (word.length) {
        units.push(<span key={key} className="inline-flex items-end">{word}</span>);
        word = [];
      }
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/\s/.test(ch)) {
        flush(`w${i}`);
        units.push(cell(" ", i));
      } else {
        word.push(cell(ch, i));
      }
    }
    flush("wend");
    const end = text.length;
    units.push(
      <span key="trail" className="inline-flex flex-col items-center">
        <button
          className="flex h-4 items-end leading-none"
          onClick={(e) => openPicker(si, li, end, chordAt.get(end) ?? null, e)}
          title="Trailing chord"
        >
          {chordAt.has(end) ? (
            <span className="px-0.5 text-[0.72rem] font-bold text-[var(--accent)]">{chordAt.get(end)}</span>
          ) : (
            <span className="text-[0.72rem] text-neutral-700">＋</span>
          )}
        </button>
        <span className="h-4 w-2" />
      </span>
    );
    return <div className="flex flex-wrap items-end">{units}</div>;
  };

  return (
    <div className="cc-editor mx-auto w-full max-w-3xl px-6 py-4 text-neutral-200">
      {/* Header: title + artist on the left, metadata to the right (v5). */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-neutral-800 pb-3">
        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Song title"
            className="w-full bg-transparent text-2xl font-bold text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          <input
            value={chart.meta.artist ?? ""}
            onChange={(e) => onChange(updateMeta(chart, { artist: e.target.value }))}
            placeholder="Artist / credits"
            className="mt-1 w-full bg-transparent text-sm text-neutral-400 outline-none placeholder:text-neutral-700"
          />
        </div>
        <div className="flex flex-wrap items-end justify-end gap-3">
          {META_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col text-[10px] uppercase tracking-wide text-neutral-500">
              {f.label}
              <input
                value={chart.meta[f.key] != null ? String(chart.meta[f.key]) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const num = f.key === "capo" || f.key === "tempo";
                  onChange(
                    updateMeta(chart, {
                      [f.key]: v === "" ? undefined : num ? Number(v) || undefined : v,
                    })
                  );
                }}
                className={`${f.width} rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-sm text-neutral-100 outline-none focus:border-[var(--accent)]`}
              />
            </label>
          ))}
          <label className="flex flex-col text-[10px] uppercase tracking-wide text-neutral-500">
            Arrangement
            <input
              value={chart.meta.arrangement ?? ""}
              onChange={(e) => onChange(updateMeta(chart, { arrangement: e.target.value || undefined }))}
              placeholder="Intro, V1, C1, …"
              className="w-44 rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-sm text-neutral-300 outline-none focus:border-[var(--accent)] placeholder:text-neutral-700"
            />
          </label>
        </div>
      </div>

      {/* Sections */}
      {chart.sections.map((section, si) => (
        <section key={si} className="mt-5">
          <div className="flex items-center gap-2">
            <input
              value={section.label}
              size={Math.max(section.label.length + 1, 6)}
              onChange={(e) => onChange(setSectionLabel(chart, si, e.target.value))}
              className="max-w-full rounded bg-transparent text-sm font-bold uppercase tracking-wide text-neutral-300 underline decoration-neutral-700 outline-none focus:decoration-[var(--accent)]"
            />
            {section.ref && <span className="text-[10px] uppercase text-neutral-600">repeat</span>}
            <span className="ml-auto flex items-center gap-0.5 text-neutral-600">
              <button onClick={() => onChange(moveSection(chart, si, -1))} title="Move up" className="px-1 hover:text-neutral-300">↑</button>
              <button onClick={() => onChange(moveSection(chart, si, 1))} title="Move down" className="px-1 hover:text-neutral-300">↓</button>
              <button onClick={() => onChange(removeSection(chart, si))} title="Delete section" className="px-1 hover:text-red-400">✕</button>
            </span>
          </div>

          {!section.ref && (
            <div className="mt-1">
              {section.lines.map((line, li) => {
                const k = `${si}:${li}`;
                if (line.kind === "keychange") {
                  const sign = line.semitones >= 0 ? `+${line.semitones}` : `${line.semitones}`;
                  return (
                    <div key={li} className="group flex items-center gap-2 py-0.5 text-xs">
                      <span className="font-semibold text-orange-300">▲ Key change</span>
                      <select
                        value={line.mode}
                        onChange={(e) =>
                          onChange(updateLine(chart, si, li, { ...line, mode: e.target.value as "transpose" | "redefine" }))
                        }
                        className="rounded border border-neutral-800 bg-neutral-950 px-1 py-0.5 text-neutral-200 outline-none"
                      >
                        <option value="transpose">Transpose</option>
                        <option value="redefine">Redefine</option>
                      </select>
                      <span className="inline-flex items-center gap-1 text-neutral-400">
                        <button onClick={() => onChange(updateLine(chart, si, li, { ...line, semitones: line.semitones - 1 }))} className="rounded bg-neutral-800 px-1.5 hover:bg-neutral-700">−</button>
                        <span className="w-6 text-center font-semibold text-neutral-200">{sign}</span>
                        <button onClick={() => onChange(updateLine(chart, si, li, { ...line, semitones: line.semitones + 1 }))} className="rounded bg-neutral-800 px-1.5 hover:bg-neutral-700">+</button>
                      </span>
                      <button onClick={() => onChange(removeLine(chart, si, li))} className="px-1 text-neutral-700 opacity-0 hover:text-red-400 group-hover:opacity-100" title="Delete">✕</button>
                    </div>
                  );
                }
                const raw = rawEditing.has(k);
                const isEmptyLyric = line.kind === "lyric" && line.pairs.every((p) => !p.text && !p.chord);
                if (raw || isEmptyLyric || line.kind !== "lyric") {
                  // raw ChordPro input (also the default for empty/new and non-lyric lines)
                  return (
                    <div key={li} className="group flex items-center gap-1">
                      <input
                        autoFocus={raw}
                        defaultValue={lineToSource(line)}
                        placeholder={line.kind === "bars" ? "| G | D |" : "Type a lyric line…"}
                        onBlur={(e) => {
                          const next = parseLineSource(e.target.value);
                          const lines = section.lines.map((l, idx) => (idx === li ? next : l));
                          onChange({ ...chart, sections: chart.sections.map((s, idx) => (idx === si ? { ...s, lines } : s)) });
                          if (raw) toggleRaw(k);
                        }}
                        className="w-full rounded bg-neutral-950/60 px-2 py-1 font-mono text-sm text-neutral-200 outline-none focus:bg-neutral-900"
                      />
                      <button onClick={() => onChange(removeLine(chart, si, li))} className="px-1 text-neutral-700 opacity-0 hover:text-red-400 group-hover:opacity-100" title="Delete line">✕</button>
                    </div>
                  );
                }
                // interactive lyric line: click a character to drop/edit a chord above it
                const edit = pairsToEditLine(line.pairs);
                return (
                  <div key={li} className="group flex items-start gap-1">
                    <div className="flex-1 py-0.5">{lyricCells(edit.text, edit.chords, si, li)}</div>
                    <button onClick={() => toggleRaw(k)} className="shrink-0 rounded px-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-[var(--accent)]" title="Edit lyrics text">✎</button>
                    <button onClick={() => onChange(removeLine(chart, si, li))} className="shrink-0 px-1 text-neutral-700 opacity-0 hover:text-red-400 group-hover:opacity-100" title="Delete line">✕</button>
                  </div>
                );
              })}
              <button onClick={() => onChange(addLine(chart, si))} className="mt-1 text-xs text-neutral-600 hover:text-[var(--accent)]">
                + line
              </button>
              <button onClick={() => onChange(addKeyChange(chart, si))} className="ml-3 mt-1 text-xs text-neutral-600 hover:text-orange-300">
                + key change
              </button>
            </div>
          )}
        </section>
      ))}

      {/* Add section / repeat */}
      <div className="mt-6 flex flex-wrap gap-2 border-t border-neutral-800 pt-4">
        {["Verse", "Pre-Chorus", "Chorus", "Bridge", "Intro", "Tag", "Ending"].map((label) => (
          <button key={label} onClick={() => onChange(addSection(chart, label))} className="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200">
            + {label}
          </button>
        ))}
        <button onClick={() => onChange(addRepeat(chart, "Chorus"))} className="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-600 hover:text-neutral-300">
          ↻ repeat reference
        </button>
      </div>

      {picker && (
        <ChordPicker
          x={picker.x}
          y={picker.y}
          value={picker.value}
          onPick={(c) => applyChord(c)}
          onRemove={() => applyChord(null)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
