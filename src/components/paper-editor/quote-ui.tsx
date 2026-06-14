// Shared quote UI (Papers module; v5). The paste box, a read-only quote card
// (text + an optional footer for filing/unfiling controls), the edit form, and
// the destination picker (token-based: "p:"/"s:"/"unsorted"). Copy-to-clipboard
// of the footnote forms lives only in the Outline Preview/HTML (click a quote to
// roll it down), so the editing cards here stay simple: just the quote text.
"use client";

import { useState, type ReactNode } from "react";
import { parsePastedQuote } from "@/lib/papers/parse-citation";
import type { BookSource, QuoteEntry, Source, VideoSource } from "@/lib/papers/types";

export const inputClass =
  "rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600";

export function emptyEntry(): QuoteEntry {
  return {
    id: crypto.randomUUID(),
    source: { kind: "book", author: "", authorLast: "", title: "", shortTitle: "", city: "", publisher: "", year: "" },
    page: "",
    text: "",
  };
}

// A fresh entry from a pasted blob (parser splits quote from citation; on no match
// the raw text becomes the quote for manual fill).
export function entryFromPaste(raw: string): QuoteEntry {
  const e = emptyEntry();
  const parsed = parsePastedQuote(raw.trim());
  if (parsed) {
    e.text = parsed.text;
    e.page = parsed.page ?? "";
    e.source = { ...(e.source as BookSource), ...parsed.source };
  } else {
    e.text = raw.trim();
  }
  return e;
}

// A paste-and-save box. `compact` shrinks it for in-context use (Outline edit).
export function QuotePasteBox({ onSave, compact }: { onSave: (e: QuoteEntry) => void; compact?: boolean }) {
  const [text, setText] = useState("");
  const save = () => {
    if (!text.trim()) return;
    onSave(entryFromPaste(text));
    setText("");
  };
  return (
    <div className={`rounded-lg border border-neutral-800 bg-neutral-900/40 ${compact ? "p-2" : "p-3"}`}>
      {!compact && (
        <label className="mb-1 block text-xs text-neutral-500">
          Paste a quote with its citation, then Save — it splits the quote from the source for you.
        </label>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'“Assurance is the fruit…” Patrick Schreiner, The Visual Word… (Chicago, IL: Moody, 2021), 160.'}
        className={`${inputClass} ${compact ? "min-h-[2.5rem]" : "min-h-[3.5rem]"} w-full resize-y`}
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={save}
          disabled={!text.trim()}
          className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          Save quote
        </button>
      </div>
    </div>
  );
}

export function QuoteCard({
  entry,
  onEdit,
  footer,
}: {
  entry: QuoteEntry;
  onEdit: () => void;
  footer?: ReactNode;
}) {
  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm text-neutral-300">
          {entry.text ? `“${entry.text}”` : <span className="text-neutral-600">(no quote text)</span>}
        </p>
        <button onClick={onEdit} className="shrink-0 text-xs text-neutral-500 hover:text-neutral-300">
          Edit
        </button>
      </div>
      {entry.source.authorLast && (
        <p className="mt-1 text-xs text-neutral-600">{entry.source.authorLast}{entry.page ? `, ${entry.page}` : ""}</p>
      )}
      {footer && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">{footer}</div>}
    </li>
  );
}

export function DestinationSelect({
  destinations,
  value,
  onChange,
}: {
  destinations: { token: string; label: string }[];
  value: string; // current token
  onChange: (token: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="unsorted">Unsorted</option>
      {destinations.map((d) => (
        <option key={d.token} value={d.token}>
          {d.label}
        </option>
      ))}
    </select>
  );
}

export function QuoteEditForm({
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
      <label className="block">
        <span className="mb-1 block text-xs text-neutral-500">Quote text</span>
        <textarea
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          className={`${inputClass} min-h-[4rem] w-full resize-y`}
        />
      </label>

      <div className="mb-2 mt-3 flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Source</span>
        <select value={src.kind} onChange={(e) => switchKind(e.target.value as Source["kind"])} className={inputClass}>
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

      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => onSave(draft)} className="rounded bg-neutral-200 px-3 py-1 text-xs font-medium text-neutral-900 hover:bg-white">
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

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-500">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} w-full`} />
    </label>
  );
}
