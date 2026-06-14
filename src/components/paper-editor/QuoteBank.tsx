// The quote bank (Papers module, P3) — the structured source list the writer
// gathers before drafting (Paper_Outline_Viewer_Build_Spec "Quote Bank" tab).
// Each entry is a source + page + the quote text; the card shows the three MSM
// footnote forms (Full / Short / Ibid., from the deterministic citation engine)
// and a Cite button per form that drops the footnote into the Draft. Stored in
// items.properties.quoteBank; the parent owns persistence, this owns the form.
"use client";

import { useState } from "react";
import { formsForEntry } from "@/lib/papers/citation";
import type { BookSource, QuoteEntry, Source, VideoSource } from "@/lib/papers/types";

type CiteForm = "full" | "short" | "ibid";

type Props = {
  entries: QuoteEntry[];
  onChange: (entries: QuoteEntry[]) => void;
  onCite: (entry: QuoteEntry, form: CiteForm) => void;
};

const input =
  "rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600";

function emptyEntry(): QuoteEntry {
  return {
    id: crypto.randomUUID(),
    source: {
      kind: "book",
      author: "",
      authorLast: "",
      title: "",
      shortTitle: "",
      city: "",
      publisher: "",
      year: "",
    },
    page: "",
    text: "",
  };
}

export default function QuoteBank({ entries, onChange, onCite }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const upsert = (next: QuoteEntry) => {
    const exists = entries.some((e) => e.id === next.id);
    onChange(exists ? entries.map((e) => (e.id === next.id ? next : e)) : [...entries, next]);
  };
  const remove = (id: string) => {
    onChange(entries.filter((e) => e.id !== id));
    if (editingId === id) setEditingId(null);
  };
  const addNew = () => {
    const e = emptyEntry();
    upsert(e);
    setEditingId(e.id);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Quote Bank
        </h2>
        <button
          onClick={addNew}
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
        >
          + Add quote
        </button>
      </div>

      {entries.length === 0 && (
        <p className="text-sm text-neutral-600">
          No sources yet. Gather your quotes here before drafting; each one gives you a
          one-click footnote.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {entries.map((entry) =>
          editingId === entry.id ? (
            <EntryForm
              key={entry.id}
              entry={entry}
              onSave={(e) => {
                upsert(e);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
              onDelete={() => remove(entry.id)}
            />
          ) : (
            <EntryCard
              key={entry.id}
              entry={entry}
              onEdit={() => setEditingId(entry.id)}
              onCite={onCite}
            />
          )
        )}
      </ul>
    </div>
  );
}

function EntryCard({
  entry,
  onEdit,
  onCite,
}: {
  entry: QuoteEntry;
  onEdit: () => void;
  onCite: (entry: QuoteEntry, form: CiteForm) => void;
}) {
  const forms = formsForEntry(entry);
  const rows: [CiteForm, string][] = [
    ["full", forms.full],
    ["short", forms.short],
    ["ibid", forms.ibid],
  ];
  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm text-neutral-300">
          {entry.text ? `“${entry.text}”` : <span className="text-neutral-600">(no quote text)</span>}
        </p>
        <button
          onClick={onEdit}
          className="shrink-0 text-xs text-neutral-500 hover:text-neutral-300"
        >
          Edit
        </button>
      </div>
      <dl className="mt-2 flex flex-col gap-1">
        {rows.map(([form, text]) => (
          <div key={form} className="flex items-baseline gap-2 text-xs">
            <button
              onClick={() => onCite(entry, form)}
              title={`Insert ${form} footnote at the cursor`}
              className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 capitalize text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
            >
              {form}
            </button>
            <span className="min-w-0 break-words italic text-neutral-500">{text}</span>
          </div>
        ))}
      </dl>
    </li>
  );
}

function EntryForm({
  entry,
  onSave,
  onCancel,
  onDelete,
}: {
  entry: QuoteEntry;
  onSave: (e: QuoteEntry) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<QuoteEntry>(entry);
  const src = draft.source;

  const setSrc = (patch: Partial<BookSource> & Partial<VideoSource>) =>
    setDraft({ ...draft, source: { ...src, ...patch } as Source });

  const switchKind = (kind: Source["kind"]) => {
    if (kind === src.kind) return;
    const common = { author: src.author, authorLast: src.authorLast, title: src.title, shortTitle: src.shortTitle };
    setDraft({
      ...draft,
      source:
        kind === "book"
          ? { kind: "book", ...common, city: "", publisher: "", year: "" }
          : { kind: "video", ...common, url: "", accessed: "" },
    });
  };

  return (
    <li className="rounded-lg border border-neutral-700 bg-neutral-900 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Source</span>
        <select
          value={src.kind}
          onChange={(e) => switchKind(e.target.value as Source["kind"])}
          className={input}
        >
          <option value="book">Book</option>
          <option value="video">Video</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Author (full)" value={src.author} onChange={(v) => setSrc({ author: v })} />
        <Field label="Author (last)" value={src.authorLast} onChange={(v) => setSrc({ authorLast: v })} />
        <Field label="Title (full)" value={src.title} onChange={(v) => setSrc({ title: v })} />
        <Field label="Short title" value={src.shortTitle} onChange={(v) => setSrc({ shortTitle: v })} />

        {src.kind === "book" ? (
          <>
            <Field label="Editor (optional)" value={src.editor ?? ""} onChange={(v) => setSrc({ editor: v || undefined })} />
            <Field label="Page" value={draft.page ?? ""} onChange={(v) => setDraft({ ...draft, page: v })} />
            <Field label="City" value={src.city} onChange={(v) => setSrc({ city: v })} />
            <Field label="Publisher" value={src.publisher} onChange={(v) => setSrc({ publisher: v })} />
            <Field label="Year" value={src.year} onChange={(v) => setSrc({ year: v })} />
          </>
        ) : (
          <>
            <Field label="URL" value={src.url} onChange={(v) => setSrc({ url: v })} />
            <Field label="Accessed (Month Day, Year)" value={src.accessed} onChange={(v) => setSrc({ accessed: v })} />
          </>
        )}
      </div>

      <label className="mt-2 block">
        <span className="mb-1 block text-xs text-neutral-500">Quote text</span>
        <textarea
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          className={`${input} min-h-[4rem] w-full resize-y`}
        />
      </label>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onSave(draft)}
          className="rounded bg-neutral-200 px-3 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
        >
          Save
        </button>
        <button onClick={onCancel} className="text-xs text-neutral-400 hover:text-neutral-200">
          Cancel
        </button>
        <button onClick={onDelete} className="ml-auto text-xs text-red-400 hover:text-red-300">
          Delete
        </button>
      </div>
    </li>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-500">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={`${input} w-full`} />
    </label>
  );
}
