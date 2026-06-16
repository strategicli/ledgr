// Dashboard focus picker (edit mode). A focus is any item — a project, person,
// or entity — that scopes every view/stat widget on the dashboard to things
// related to it. Shows a clearable pill when set, or a "Set focus" button; the
// popover searches items by title via /api/items?q=. Picking persists the
// focusItemId and refetches all widgets (handled by the parent).
"use client";

import { useEffect, useRef, useState } from "react";

type ItemHit = { id: string; title: string; type: string };

export default function FocusPicker({
  focusTitle,
  onChange,
}: {
  focusTitle: string | null; // current focus item's title, or null
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ItemHit[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const url = q.trim()
        ? `/api/items?q=${encodeURIComponent(q.trim())}&limit=8`
        : `/api/items?limit=8`;
      void fetch(url, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d: { items: ItemHit[] }) => setHits(d.items ?? []))
        .catch(() => {});
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q, open]);

  if (focusTitle) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] px-2 py-0.5 text-xs text-[var(--accent)]">
        Focus: {focusTitle}
        <button
          onClick={() => onChange(null)}
          className="hover:opacity-70"
          aria-label="Clear focus"
          title="Clear focus"
        >
          ✕
        </button>
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:border-neutral-600"
      >
        Set focus
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items…"
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
          />
          <ul className="mt-1 max-h-64 overflow-y-auto">
            {hits.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-neutral-500">No matches.</li>
            ) : (
              hits.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => {
                      onChange(h.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-800/60"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                      {h.title || "Untitled"}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-600">{h.type}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
