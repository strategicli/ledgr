// Shared reparent typeahead: search the owner's items and pick one, with an
// optional "top level" escape. Same q= search as AddRelation. Used two ways —
// the bulk bar's Move… (pick a new parent for the whole selection) and the
// single-item "Make subtask of…" / "Add existing task" affordances. The caller
// owns positioning via `className` and decides what a pick means via `onPick`.
"use client";

import { useEffect, useState } from "react";

export type MoveHit = { id: string; type: string; title: string };

const DEFAULT_CLASS =
  "absolute bottom-full left-0 mb-2 w-72 max-w-[90vw] rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl shadow-black/50";

export default function MoveUnderMenu({
  busy = false,
  onPick,
  className,
  placeholder = "Search items to move under…",
  topLevelLabel = "Move to top level",
  showTopLevel = true,
}: {
  busy?: boolean;
  // Called with the picked item's id, or null for the "top level" escape.
  onPick: (id: string | null) => void;
  className?: string;
  placeholder?: string;
  topLevelLabel?: string;
  showTopLevel?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MoveHit[]>([]);
  const trimmed = q.trim();

  // Empty queries clear hits in the onChange handler, not here, so the effect
  // only ever talks to the network (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!trimmed) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items?q=${encodeURIComponent(trimmed)}&limit=8`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: MoveHit[] };
        setHits(data.items);
      } catch {
        // aborted/offline; next keystroke retries
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [trimmed]);

  return (
    <div role="menu" className={className ?? DEFAULT_CLASS}>
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value.trim()) setHits([]);
        }}
        disabled={busy}
        placeholder={placeholder}
        className="w-full rounded border border-neutral-700 bg-transparent px-2 py-1 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      />
      <ul className="mt-1 max-h-56 overflow-y-auto">
        {hits.map((hit) => (
          <li key={hit.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(hit.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate">{hit.title || "Untitled"}</span>
              <span className="shrink-0 text-xs text-neutral-500">{hit.type}</span>
            </button>
          </li>
        ))}
      </ul>
      {showTopLevel && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onPick(null)}
          className="mt-1 block w-full rounded px-2 py-1 text-left text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-50"
        >
          {topLevelLabel}
        </button>
      )}
    </div>
  );
}
