// Command-palette search (v5): a floating modal you type into; Enter opens the
// highlighted result (or, with nothing highlighted, the full /search page for
// the query). Replaces navigating to the search page. Triggered by the Search
// nav slot and Ctrl/Cmd+K.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Hit = { id: string; title: string; type: string };

export default function SearchModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}&limit=8`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: Hit[] };
        setHits(data.items ?? []);
        setActive(0);
      } catch {
        /* aborted/offline; next keystroke retries */
      }
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q]);

  const open = (hit: Hit) => {
    onClose();
    router.push(`/items/${hit.id}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (hits[active]) open(hits[active]);
      else if (q.trim()) {
        onClose();
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[18vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search everything…"
          aria-label="Search query"
          className="w-full bg-neutral-950 px-4 py-3 text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
        />
        {hits.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-1">
            {hits.map((h, i) => (
              <li key={h.id}>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    open(h);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                    i === active ? "bg-neutral-800 text-neutral-100" : "text-neutral-300"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{h.title || "Untitled"}</span>
                  <span className="shrink-0 text-xs text-neutral-500">{h.type}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim() && hits.length === 0 && (
          <p className="px-4 py-3 text-sm text-neutral-600">No matches yet. Enter to search everything.</p>
        )}
        <div className="border-t border-neutral-800 px-4 py-1.5 text-xs text-neutral-600">
          ↑↓ to move · Enter to open · Esc to close
        </div>
      </div>
    </div>
  );
}
