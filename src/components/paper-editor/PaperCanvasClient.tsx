// Client half of the paper canvas (Papers module; v5 feedback). Three surfaces —
// Quote Bank · Outline · Draft — and the single writer of the paper's
// items.properties (so nothing races a generic properties panel). The Quote Bank
// is where quotes are pasted and filed to a section; the Outline (sections →
// paragraphs → filed quotes, modeled on ty-docs/1peter_outline_viewer.html) is
// the drafting reference (with a Preview + HTML output); the Draft is the
// canonical markdown body the writer composes themselves.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bodyMarkdown, makeMarkdownBody } from "@/lib/body";
import { useItemAutosave } from "@/components/chord-editor/useItemAutosave";
import { buildOutlineHtml } from "@/lib/papers/outline-html";
import type { OutlineSection, PaperMeta as Meta, QuoteEntry } from "@/lib/papers/types";
import OutlineTab from "@/components/paper-editor/OutlineTab";
import PaperMarkdownArea from "@/components/paper-editor/PaperMarkdownArea";
import PaperMeta from "@/components/paper-editor/PaperMeta";
import QuoteBank from "@/components/paper-editor/QuoteBank";
import ShapeTab from "@/components/paper-editor/ShapeTab";

// Four surfaces in order: Shape (set up sections) → Quote Bank (gather + file all
// quotes) → Outline (notes + filed quotes + Preview/clean page) → Draft (write).
type Tab = "shape" | "quotes" | "outline" | "draft";

type Props = {
  itemId: string;
  initialTitle: string;
  initialBody: unknown;
  initialProperties: unknown;
  createdAt: string; // ISO; seeds the title-page date when unset (P1, v5)
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// MSM title-page date, "Month Day, Year". Empty string for an unparseable value.
function formatPaperDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const STATUS: Record<string, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed, retrying",
};

const uuid = () => crypto.randomUUID();

// Migrate-on-read for papers saved under earlier scaffold shapes (so a paper
// shaped before the Outline rebuild doesn't lose its sections or quote
// assignments). Old `shape: {title,pages}[]` → `sections` (each gets one
// paragraph); a quote's old `section` (a title) → that section's id as a
// section-level filing. Runs once; `changed` tells the caller to persist the
// upgraded shape. Old freeform `outline` string is preserved as the first
// section's note so nothing is silently dropped.
function migrateScaffold(props: Record<string, unknown>): {
  sections: OutlineSection[];
  quotes: QuoteEntry[];
  changed: boolean;
} {
  let changed = false;
  let sections: OutlineSection[];
  if (Array.isArray(props.sections)) {
    sections = props.sections as OutlineSection[];
  } else if (Array.isArray(props.shape)) {
    sections = (props.shape as { title?: string }[]).map((sp) => ({
      id: uuid(),
      title: sp.title ?? "",
      paragraphs: [{ id: uuid() }],
    }));
    changed = true;
    // The old freeform `outline` string was auto-generated scaffold (headers +
    // "~N paragraphs"), not the writer's prose — dropping it, not carrying it
    // into a note (that just showed as noise).
  } else {
    sections = [];
  }

  const sectionIdByTitle = new Map(sections.map((s) => [s.title, s.id]));
  const rawQuotes = Array.isArray(props.quoteBank) ? (props.quoteBank as Array<Record<string, unknown>>) : [];
  const quotes: QuoteEntry[] = rawQuotes.map((q) => {
    if (q.paragraphId || q.sectionId) return q as unknown as QuoteEntry;
    const { section, ...rest } = q as { section?: string } & Record<string, unknown>;
    if (section) {
      changed = true;
      const sid = sectionIdByTitle.get(section);
      return { ...(rest as unknown as QuoteEntry), ...(sid ? { sectionId: sid } : {}) };
    }
    return rest as unknown as QuoteEntry;
  });

  return { sections, quotes, changed };
}

// Keys PaperCanvasClient manages inside properties; everything else in the
// initial object is preserved untouched on every write.
const META_KEYS: (keyof Meta)[] = ["school", "paper_type", "course", "author", "location", "paper_date", "stage"];

export default function PaperCanvasClient({ itemId, initialTitle, initialBody, initialProperties, createdAt }: Props) {
  const initialProps = (initialProperties as Record<string, unknown> | null) ?? {};

  // Workflow order: Shape (set up sections) → Quote Bank (gather + file) → Draft.
  const [tab, setTab] = useState<Tab>("shape");
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(() => bodyMarkdown(initialBody));
  // Migrate older scaffolds once on load (recovers pre-rebuild sections + quote
  // assignments) — computed once via a ref so section/paragraph ids are stable.
  const migratedRef = useRef<ReturnType<typeof migrateScaffold>>(undefined);
  if (!migratedRef.current) migratedRef.current = migrateScaffold(initialProps);
  const [sections, setSections] = useState<OutlineSection[]>(migratedRef.current.sections);
  const [quotes, setQuotes] = useState<QuoteEntry[]>(migratedRef.current.quotes);
  // True when this paper had no stored date and we seeded it from createdAt (P1,
  // v5) — used to persist that seed once on mount so it sticks.
  const seededDateRef = useRef(false);
  const [meta, setMeta] = useState<Meta>(() => {
    const m: Meta = {};
    for (const k of META_KEYS) {
      const v = initialProps[k];
      if (typeof v === "string") m[k] = v;
    }
    if (!m.paper_date) {
      const seeded = formatPaperDate(createdAt);
      if (seeded) {
        m.paper_date = seeded;
        seededDateRef.current = true;
      }
    }
    return m;
  });

  const basePropsRef = useRef(initialProps);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const { patch, saveState } = useItemAutosave(itemId);

  // Rebuild the full properties object: preserve unknown/system keys, overwrite
  // the keys this canvas owns.
  const buildProps = (over?: { meta?: Meta; sections?: OutlineSection[]; quotes?: QuoteEntry[] }) => ({
    ...basePropsRef.current,
    ...(over?.meta ?? meta),
    sections: over?.sections ?? sections,
    quoteBank: over?.quotes ?? quotes,
  });

  // Persist once on mount when we seeded the date and/or upgraded an older
  // scaffold, so the recovered sections + assignments (and the auto-date) stick.
  useEffect(() => {
    if (seededDateRef.current || migratedRef.current?.changed) {
      patch({ properties: buildProps() });
      seededDateRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitDraft = (text: string) => {
    setDraft(text);
    patch({ body: makeMarkdownBody(text) });
  };
  const commitSections = (next: OutlineSection[]) => {
    setSections(next);
    patch({ properties: buildProps({ sections: next }) });
  };
  const commitQuotes = (next: QuoteEntry[]) => {
    setQuotes(next);
    patch({ properties: buildProps({ quotes: next }) });
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

  // Subtitle for the outline viewer, built from the title-page meta.
  const subtitle = [meta.course, meta.school].map((x) => x?.trim()).filter(Boolean).join(" · ");

  // The outline's output: download the standalone viewer (the distraction-free
  // page to set alongside the draft). Same generator as the in-app Preview.
  // Open the outline as a clean, read-only page in a new tab — a distraction-free
  // reference to keep beside the draft (same content as the Outline Preview).
  const openOutlinePage = () => {
    const html = buildOutlineHtml({ title, subtitle, sections, quotes });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank");
    // Revoke a little later so the new tab has time to load it.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const exportDocx = async () => {
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
    ["shape", "Shape"],
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
              className={`px-3 py-1 ${tab === t ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={openOutlinePage}
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
          title="Open the outline as a clean read-only page in a new tab to draft alongside"
        >
          Open outline page
        </button>
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
        {tab === "shape" && <ShapeTab sections={sections} onSections={commitSections} />}
        {tab === "quotes" && (
          <QuoteBank sections={sections} quotes={quotes} onSections={commitSections} onQuotes={commitQuotes} />
        )}
        {tab === "outline" && (
          <OutlineTab
            title={title}
            subtitle={subtitle}
            sections={sections}
            quotes={quotes}
            onSections={commitSections}
            onQuotes={commitQuotes}
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
              placeholder={"Write the paper in markdown. Copy citations from the Outline as you go."}
            />
          </div>
        )}
      </div>
    </div>
  );
}
