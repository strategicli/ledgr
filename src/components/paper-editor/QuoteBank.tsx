// The Quote Bank tab (Papers module; v5). Home for ALL of the paper's quotes,
// laid out over the shaped sections. Under each section title: Add paragraph and
// Add quote (files at the section level); each paragraph has its own Add quote.
// Quotes you don't want to place go in the Unsorted area at the bottom. Add quote
// pops an inline paste box and files the quote exactly where you clicked. The
// parent owns the shared sections (Add paragraph writes there) and the quotes.
"use client";

import { useState } from "react";
import {
  applyToken,
  destinationsFor,
  quoteToken,
  quotesForParagraph,
  sectionLevelQuotes,
  unsortedQuotes,
} from "@/lib/papers/outline";
import type { OutlineSection, QuoteEntry } from "@/lib/papers/types";
import { DestinationSelect, QuoteCard, QuoteEditForm, QuotePasteBox } from "@/components/paper-editor/quote-ui";

type Props = {
  sections: OutlineSection[];
  quotes: QuoteEntry[];
  onSections: (s: OutlineSection[]) => void;
  onQuotes: (q: QuoteEntry[]) => void;
};

const uuid = () => crypto.randomUUID();
const ghost =
  "rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100";

export default function QuoteBank({ sections, quotes, onSections, onQuotes }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pasteAt, setPasteAt] = useState<string | null>(null); // a destination token
  const destinations = destinationsFor(sections);

  const addParagraph = (sectionId: string) =>
    onSections(sections.map((s) => (s.id === sectionId ? { ...s, paragraphs: [...s.paragraphs, { id: uuid() }] } : s)));

  const add = (assoc: { sectionId?: string; paragraphId?: string }, e: QuoteEntry) =>
    onQuotes([...quotes, { ...e, ...assoc }]);
  const update = (e: QuoteEntry) => onQuotes(quotes.map((q) => (q.id === e.id ? e : q)));
  const remove = (id: string) => onQuotes(quotes.filter((q) => q.id !== id));
  const refile = (id: string, token: string) =>
    onQuotes(
      quotes.map((q) =>
        q.id === id ? { ...q, sectionId: undefined, paragraphId: undefined, ...applyToken(token) } : q
      )
    );

  // A quote card with a "refile" picker + the inline editor when editing.
  const card = (q: QuoteEntry) =>
    editingId === q.id ? (
      <QuoteEditForm
        key={q.id}
        entry={q}
        onSave={(e) => { update(e); setEditingId(null); }}
        onCancel={() => setEditingId(null)}
        onDelete={() => { remove(q.id); setEditingId(null); }}
      />
    ) : (
      <QuoteCard
        key={q.id}
        entry={q}
        onEdit={() => setEditingId(q.id)}
        footer={
          <>
            <span className="text-neutral-600">Filed</span>
            <DestinationSelect destinations={destinations} value={quoteToken(q, sections)} onChange={(t) => refile(q.id, t)} />
          </>
        }
      />
    );

  // An "Add quote" button that toggles an inline paste box for a given token.
  const addQuoteButton = (token: string, assoc: { sectionId?: string; paragraphId?: string }) =>
    pasteAt === token ? (
      <div className="mt-2">
        <QuotePasteBox compact onSave={(e) => { add(assoc, e); setPasteAt(null); }} />
        <button onClick={() => setPasteAt(null)} className="mt-1 text-xs text-neutral-500 hover:text-neutral-300">Cancel</button>
      </div>
    ) : (
      <button onClick={() => setPasteAt(token)} className={`${ghost} mt-2`}>+ Add quote</button>
    );

  const unsorted = unsortedQuotes(quotes, sections);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-4">
      <p className="mb-4 text-sm text-neutral-500">
        Every quote for the paper lives here. File a quote under a section or a specific paragraph, or drop it in
        Unsorted at the bottom for later. Set up sections in the Shape tab.
      </p>

      {sections.length === 0 && unsorted.length === 0 && (
        <p className="mb-4 text-sm text-neutral-600">No sections yet — add them in the Shape tab, then gather quotes here.</p>
      )}

      <div className="flex flex-col gap-5">
        {sections.map((s) => (
          <section key={s.id} className="rounded-lg border border-neutral-800 p-3">
            <h3 className="text-sm font-semibold text-neutral-100">{s.title.trim() || "Untitled section"}</h3>

            {/* section-level quotes */}
            <ul className="mt-2 flex flex-col gap-2">{sectionLevelQuotes(quotes, s.id).map(card)}</ul>
            {addQuoteButton(`s:${s.id}`, { sectionId: s.id })}

            {/* paragraphs */}
            <div className="mt-3 flex flex-col gap-3">
              {s.paragraphs.map((p, i) => (
                <div key={p.id} className="border-l border-neutral-800 pl-3">
                  <div className="text-xs text-neutral-500">{p.title?.trim() || `Paragraph ${i + 1}`}</div>
                  <ul className="mt-1 flex flex-col gap-2">{quotesForParagraph(quotes, p.id).map(card)}</ul>
                  {addQuoteButton(`p:${p.id}`, { paragraphId: p.id })}
                </div>
              ))}
            </div>

            <button onClick={() => addParagraph(s.id)} className={`${ghost} mt-3`}>+ Add paragraph</button>
          </section>
        ))}

        {/* Unsorted */}
        <section className="rounded-lg border border-dashed border-neutral-800 p-3">
          <h3 className="text-sm font-semibold text-neutral-400">Unsorted</h3>
          <ul className="mt-2 flex flex-col gap-2">{unsorted.map(card)}</ul>
          {addQuoteButton("unsorted", {})}
        </section>
      </div>
    </div>
  );
}
