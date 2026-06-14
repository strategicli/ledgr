// The Outline tab (Papers module; v5). Defaults to Preview — the read-only
// drafting reference (notes + filed quotes, quotes text-only with click-to-roll
// footnotes, plus an auto bibliography; the same page the clean-page button
// opens). Edit lets the writer add per-paragraph notes, restructure sections /
// paragraphs (reorder arrows now; drag-and-drop to follow), and add/remove quotes
// in place — remove here just unfiles a quote back to the Quote Bank's Unsorted.
"use client";

import { useState } from "react";
import { quotesForParagraph, sectionLevelQuotes } from "@/lib/papers/outline";
import type { OutlineSection, QuoteEntry } from "@/lib/papers/types";
import { QuoteCard, QuoteEditForm, QuotePasteBox, inputClass } from "@/components/paper-editor/quote-ui";
import OutlinePreview from "@/components/paper-editor/OutlinePreview";

type Props = {
  title: string;
  subtitle?: string;
  sections: OutlineSection[];
  quotes: QuoteEntry[];
  onSections: (s: OutlineSection[]) => void;
  onQuotes: (q: QuoteEntry[]) => void;
};

const uuid = () => crypto.randomUUID();
const ghost =
  "rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100";
const arrow = "rounded px-1 text-neutral-500 hover:text-neutral-200 disabled:opacity-30";

export default function OutlineTab({ title, subtitle, sections, quotes, onSections, onQuotes }: Props) {
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pasteAt, setPasteAt] = useState<string | null>(null); // paragraph id

  // structure
  const patchSection = (id: string, patch: Partial<OutlineSection>) =>
    onSections(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const moveSection = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= sections.length) return;
    const c = [...sections];
    [c[i], c[j]] = [c[j], c[i]];
    onSections(c);
  };
  const addSection = () => onSections([...sections, { id: uuid(), title: "", paragraphs: [{ id: uuid() }] }]);
  const removeSection = (id: string) => onSections(sections.filter((s) => s.id !== id));
  const setParas = (sid: string, paragraphs: OutlineSection["paragraphs"]) => patchSection(sid, { paragraphs });
  const movePara = (sid: string, i: number, d: -1 | 1) => {
    const s = sections.find((x) => x.id === sid)!;
    const j = i + d;
    if (j < 0 || j >= s.paragraphs.length) return;
    const c = [...s.paragraphs];
    [c[i], c[j]] = [c[j], c[i]];
    setParas(sid, c);
  };

  // quotes
  const add = (paragraphId: string, e: QuoteEntry) => onQuotes([...quotes, { ...e, paragraphId }]);
  const update = (e: QuoteEntry) => onQuotes(quotes.map((q) => (q.id === e.id ? e : q)));
  const unfile = (id: string) =>
    onQuotes(quotes.map((q) => (q.id === id ? { ...q, sectionId: undefined, paragraphId: undefined } : q)));

  const quoteRow = (q: QuoteEntry) =>
    editingId === q.id ? (
      <QuoteEditForm key={q.id} entry={q} onSave={(e) => { update(e); setEditingId(null); }} onCancel={() => setEditingId(null)} onDelete={() => { onQuotes(quotes.filter((x) => x.id !== q.id)); setEditingId(null); }} />
    ) : (
      <QuoteCard
        key={q.id}
        entry={q}
        onEdit={() => setEditingId(q.id)}
        footer={<button onClick={() => unfile(q.id)} className="text-neutral-500 hover:text-red-400" title="Remove from the outline (moves it to the Quote Bank's Unsorted)">Remove</button>}
      />
    );

  const addQuoteButton = (pid: string) =>
    pasteAt === pid ? (
      <div className="mt-2">
        <QuotePasteBox compact onSave={(e) => { add(pid, e); setPasteAt(null); }} />
        <button onClick={() => setPasteAt(null)} className="mt-1 text-xs text-neutral-500 hover:text-neutral-300">Cancel</button>
      </div>
    ) : (
      <button onClick={() => setPasteAt(pid)} className={`${ghost} mt-2`}>+ Add quote</button>
    );

  const modeToggle = (
    <div className="mb-3 inline-flex overflow-hidden rounded-md border border-neutral-700 text-xs">
      {(["preview", "edit"] as const).map((m) => (
        <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 capitalize ${mode === m ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>
          {m}
        </button>
      ))}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-4">
      <p className="mb-3 text-sm text-neutral-500">
        Your working outline. Preview is the page you draft from (notes + quotes + bibliography). Edit to add your
        thoughts, restructure, or pull a quote out.
      </p>
      {modeToggle}

      {mode === "preview" ? (
        <OutlinePreview title={title} subtitle={subtitle} sections={sections} quotes={quotes} />
      ) : sections.length === 0 ? (
        <p className="text-sm text-neutral-600">No sections yet. Add them here or in the Shape tab.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {sections.map((s, si) => (
            <section key={s.id} className="rounded-lg border border-neutral-800 p-3">
              <div className="flex items-center gap-2">
                <input value={s.title} onChange={(e) => patchSection(s.id, { title: e.target.value })} placeholder="Section title" className={`${inputClass} flex-1 font-semibold`} />
                <button onClick={() => moveSection(si, -1)} disabled={si === 0} aria-label="Move section up" className={arrow}>↑</button>
                <button onClick={() => moveSection(si, 1)} disabled={si === sections.length - 1} aria-label="Move section down" className={arrow}>↓</button>
                <button onClick={() => removeSection(s.id)} aria-label="Remove section" className="rounded px-1 text-neutral-500 hover:text-red-400">✕</button>
              </div>

              {sectionLevelQuotes(quotes, s.id).length > 0 && (
                <ul className="mt-2 flex flex-col gap-2">{sectionLevelQuotes(quotes, s.id).map(quoteRow)}</ul>
              )}

              <div className="mt-3 flex flex-col gap-4">
                {s.paragraphs.map((p, pi) => (
                  <div key={p.id} className="border-l border-neutral-800 pl-3">
                    <div className="flex items-center gap-2">
                      <input value={p.title ?? ""} onChange={(e) => setParas(s.id, s.paragraphs.map((q) => (q.id === p.id ? { ...q, title: e.target.value || undefined } : q)))} placeholder="Paragraph title (optional)" className={`${inputClass} flex-1 text-neutral-300`} />
                      <button onClick={() => movePara(s.id, pi, -1)} disabled={pi === 0} aria-label="Move paragraph up" className={arrow}>↑</button>
                      <button onClick={() => movePara(s.id, pi, 1)} disabled={pi === s.paragraphs.length - 1} aria-label="Move paragraph down" className={arrow}>↓</button>
                      {s.paragraphs.length > 1 && (
                        <button onClick={() => setParas(s.id, s.paragraphs.filter((q) => q.id !== p.id))} aria-label="Remove paragraph" className="rounded px-1 text-neutral-600 hover:text-red-400">✕</button>
                      )}
                    </div>
                    <textarea value={p.note ?? ""} onChange={(e) => setParas(s.id, s.paragraphs.map((q) => (q.id === p.id ? { ...q, note: e.target.value || undefined } : q)))} placeholder="Your thoughts for this paragraph (markdown ok)" className={`${inputClass} mt-1 min-h-[3rem] w-full resize-y text-neutral-300`} />
                    {quotesForParagraph(quotes, p.id).length > 0 && (
                      <ul className="mt-2 flex flex-col gap-2">{quotesForParagraph(quotes, p.id).map(quoteRow)}</ul>
                    )}
                    {addQuoteButton(p.id)}
                  </div>
                ))}
              </div>

              <button onClick={() => setParas(s.id, [...s.paragraphs, { id: uuid() }])} className={`${ghost} mt-3`}>+ Add paragraph</button>
            </section>
          ))}
          <button onClick={addSection} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 hover:text-neutral-100">+ Add section</button>
        </div>
      )}
    </div>
  );
}
