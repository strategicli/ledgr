// Client half of the paper canvas (Papers module, P3). Owns the three working
// surfaces — Quote Bank · Outline · Draft — and is the single writer of the
// paper's items.properties (so nothing races a generic properties panel). The
// Draft is the canonical markdown body; the Outline and Quote Bank are the
// scaffold that sits beside it (stored in properties). Citing from the Quote
// Bank splices a footnote into the Draft at the caret, the markdown-canonical
// mechanism the MSM docx renderer consumes. Autosave reuses the shared
// useItemAutosave hook.
"use client";

import { useMemo, useRef, useState } from "react";
import { bodyMarkdown, makeMarkdownBody } from "@/lib/body";
import { useItemAutosave } from "@/components/chord-editor/useItemAutosave";
import { formsForEntry } from "@/lib/papers/citation";
import type { PaperMeta as Meta, QuoteEntry } from "@/lib/papers/types";
import PaperMarkdownArea from "@/components/paper-editor/PaperMarkdownArea";
import PaperMeta from "@/components/paper-editor/PaperMeta";
import QuoteBank from "@/components/paper-editor/QuoteBank";

type Tab = "quotes" | "outline" | "draft";
type CiteForm = "full" | "short" | "ibid";

type Props = {
  itemId: string;
  initialTitle: string;
  initialBody: unknown;
  initialProperties: unknown;
};

const STATUS: Record<string, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed, retrying",
};

// Keys PaperCanvasClient manages inside properties; everything else in the
// initial object is preserved untouched on every write.
const META_KEYS: (keyof Meta)[] = [
  "school",
  "paper_type",
  "course",
  "author",
  "location",
  "paper_date",
  "stage",
];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "src";
}

// Next free `[^base-N]` marker id given what's already in the draft, so a first
// reference and a later shortened one are distinct numbered footnotes.
function nextMarkerId(draft: string, base: string): string {
  let max = 0;
  const re = new RegExp(`\\[\\^${base}-(\\d+)\\]`, "g");
  for (const m of draft.matchAll(re)) max = Math.max(max, Number(m[1]));
  return `${base}-${max + 1}`;
}

export default function PaperCanvasClient({ itemId, initialTitle, initialBody, initialProperties }: Props) {
  const initialProps = (initialProperties as Record<string, unknown> | null) ?? {};

  const [tab, setTab] = useState<Tab>("draft");
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(() => bodyMarkdown(initialBody));
  const [outline, setOutline] = useState(() =>
    typeof initialProps.outline === "string" ? (initialProps.outline as string) : ""
  );
  const [quoteBank, setQuoteBank] = useState<QuoteEntry[]>(() =>
    Array.isArray(initialProps.quoteBank) ? (initialProps.quoteBank as QuoteEntry[]) : []
  );
  const [meta, setMeta] = useState<Meta>(() => {
    const m: Meta = {};
    for (const k of META_KEYS) {
      const v = initialProps[k];
      if (typeof v === "string") m[k] = v;
    }
    return m;
  });

  const basePropsRef = useRef(initialProps);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const { patch, saveState } = useItemAutosave(itemId);

  // Rebuild the full properties object: preserve unknown/system keys, overwrite
  // the keys this canvas owns.
  const buildProps = (over?: { outline?: string; quoteBank?: QuoteEntry[]; meta?: Meta }) => ({
    ...basePropsRef.current,
    ...(over?.meta ?? meta),
    outline: over?.outline ?? outline,
    quoteBank: over?.quoteBank ?? quoteBank,
  });

  const commitDraft = (text: string) => {
    setDraft(text);
    patch({ body: makeMarkdownBody(text) });
  };
  const commitOutline = (text: string) => {
    setOutline(text);
    patch({ properties: buildProps({ outline: text }) });
  };
  const commitQuoteBank = (entries: QuoteEntry[]) => {
    setQuoteBank(entries);
    patch({ properties: buildProps({ quoteBank: entries }) });
  };
  const commitMeta = (patchMeta: Partial<Meta>) => {
    const next = { ...meta, ...patchMeta };
    setMeta(next);
    patch({ properties: buildProps({ meta: next }) });
  };
  const commitTitle = (t: string) => {
    setTitle(t);
    patch({ title: t });
  };

  const citeInto = (entry: QuoteEntry, form: CiteForm) => {
    const id = nextMarkerId(draft, slug(entry.source.authorLast || entry.source.author));
    const marker = `[^${id}]`;
    const def = `[^${id}]: ${formsForEntry(entry)[form]}`;

    const ta = draftRef.current;
    const at = ta ? ta.selectionStart : draft.length;
    const withMarker = draft.slice(0, at) + marker + draft.slice(ta ? ta.selectionEnd : draft.length);
    const next = `${withMarker.trimEnd()}\n\n${def}\n`;

    commitDraft(next);
    setTab("draft");
    // restore the caret just after the inserted marker
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (!el) return;
      el.focus();
      const pos = at + marker.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const exportDocx = async () => {
    // Persist the latest draft + scaffold before the server renders from the DB.
    await fetch(`/api/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body: makeMarkdownBody(draft), properties: buildProps() }),
    }).catch(() => {});
    const a = document.createElement("a");
    a.href = `/api/items/${itemId}/render-docx`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const tabs: [Tab, string][] = [
    ["quotes", "Quote Bank"],
    ["outline", "Outline"],
    ["draft", "Draft"],
  ];
  const wordCount = useMemo(() => draft.trim().split(/\s+/).filter(Boolean).length, [draft]);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 pt-6">
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <input
          className="w-full bg-transparent text-2xl font-bold text-neutral-100 outline-none placeholder:text-neutral-600"
          placeholder="Untitled paper"
          value={title}
          onChange={(e) => commitTitle(e.target.value)}
        />
        <span className={`shrink-0 text-xs ${saveState === "error" ? "text-red-400" : "text-neutral-500"}`}>
          {STATUS[saveState]}
        </span>
      </div>

      <div className="flex items-center gap-2 border-b border-neutral-800 pb-2">
        <div className="inline-flex overflow-hidden rounded-md border border-neutral-700 text-xs">
          {tabs.map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 ${
                tab === t ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => void exportDocx()}
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
          title="Render the draft to a Midwestern Style Manual .docx"
        >
          Export MSM .docx
        </button>
        {tab === "draft" && <span className="ml-auto text-xs text-neutral-600">{wordCount} words</span>}
      </div>

      <div className="py-4">
        {tab === "quotes" && (
          <QuoteBank entries={quoteBank} onChange={commitQuoteBank} onCite={citeInto} />
        )}
        {tab === "outline" && (
          <PaperMarkdownArea
            value={outline}
            onChange={commitOutline}
            ariaLabel="Paper outline"
            placeholder={
              "Shape the paper here: sections, paragraphs, and your notes/ideas/hints for each.\n\n## Background\n- Authorship — who wrote it and how we know\n- Occasion — why it was written\n\n## Outline\n- Paragraph 1 (1:1–2:10) — the gospel foundation; note: tie to…"
            }
          />
        )}
        {tab === "draft" && (
          <div className="flex flex-col gap-3">
            <PaperMeta meta={meta} onChange={commitMeta} />
            <PaperMarkdownArea
              ref={draftRef}
              value={draft}
              onChange={commitDraft}
              ariaLabel="Paper draft"
              placeholder={"Write the paper in markdown. Cite from the Quote Bank to drop footnotes here."}
            />
          </div>
        )}
      </div>
    </div>
  );
}
