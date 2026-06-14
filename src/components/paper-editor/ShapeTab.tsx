// The Shape tab (Papers module). The first surface: set up the paper's structure
// — sections and the paragraphs under them (titles only here; notes + quotes live
// in the Outline tab, quotes are filed in the Quote Bank). Section titles become
// the document's headers; paragraph titles are optional (Tyler's papers use
// sections only). The parent owns the sections array; this edits its structure.
"use client";

import type { OutlineParagraph, OutlineSection } from "@/lib/papers/types";
import { inputClass } from "@/components/paper-editor/quote-ui";

const uuid = () => crypto.randomUUID();
const ghost =
  "rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100";

export default function ShapeTab({
  sections,
  onSections,
}: {
  sections: OutlineSection[];
  onSections: (s: OutlineSection[]) => void;
}) {
  const patchSection = (id: string, patch: Partial<OutlineSection>) =>
    onSections(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  // New sections come with a few starter paragraphs (helpful default; add/remove freely).
  const addSection = () =>
    onSections([...sections, { id: uuid(), title: "", paragraphs: [{ id: uuid() }, { id: uuid() }, { id: uuid() }] }]);
  const removeSection = (id: string) => onSections(sections.filter((s) => s.id !== id));
  const moveSection = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const copy = [...sections];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onSections(copy);
  };
  const setParagraphs = (sid: string, paragraphs: OutlineParagraph[]) => patchSection(sid, { paragraphs });

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-4">
      <p className="mb-3 text-sm text-neutral-500">
        Set up your paper&apos;s structure: the sections (and optional paragraphs). Section titles become your headers
        and the buckets you file quotes into.
      </p>
      {sections.length === 0 && (
        <p className="mb-3 text-sm text-neutral-600">
          No sections yet. Add the sections of your paper here; you&apos;ll gather quotes into them in the Quote Bank
          and flesh them out in the Outline.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {sections.map((s, i) => (
          <section key={s.id} className="rounded-lg border border-neutral-800 p-3">
            <div className="flex items-center gap-2">
              <input
                value={s.title}
                onChange={(e) => patchSection(s.id, { title: e.target.value })}
                placeholder="Section title"
                className={`${inputClass} flex-1 font-semibold`}
              />
              <button onClick={() => moveSection(i, -1)} disabled={i === 0} aria-label="Move section up" className="rounded px-1 text-neutral-500 hover:text-neutral-200 disabled:opacity-30">↑</button>
              <button onClick={() => moveSection(i, 1)} disabled={i === sections.length - 1} aria-label="Move section down" className="rounded px-1 text-neutral-500 hover:text-neutral-200 disabled:opacity-30">↓</button>
              <button onClick={() => removeSection(s.id)} aria-label="Remove section" className="rounded px-1 text-neutral-500 hover:text-red-400">✕</button>
            </div>

            <div className="mt-2 flex flex-col gap-1 pl-3">
              {s.paragraphs.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="text-neutral-700">•</span>
                  <input
                    value={p.title ?? ""}
                    onChange={(e) => setParagraphs(s.id, s.paragraphs.map((q) => (q.id === p.id ? { ...q, title: e.target.value || undefined } : q)))}
                    placeholder="Paragraph title (optional)"
                    className={`${inputClass} flex-1 text-neutral-300`}
                  />
                  {s.paragraphs.length > 1 && (
                    <button onClick={() => setParagraphs(s.id, s.paragraphs.filter((q) => q.id !== p.id))} aria-label="Remove paragraph" className="rounded px-1 text-neutral-600 hover:text-red-400">✕</button>
                  )}
                </div>
              ))}
              <button onClick={() => setParagraphs(s.id, [...s.paragraphs, { id: uuid() }])} className={`${ghost} mt-1 self-start`}>
                + Add paragraph
              </button>
            </div>
          </section>
        ))}
      </div>

      <button onClick={addSection} className="mt-4 rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 hover:text-neutral-100">
        + Add section
      </button>
    </div>
  );
}
