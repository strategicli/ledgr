// A compact, type-locked relate picker for inbox fast-processing (Slice 1).
// Distilled from AddRelation (src/components/relations/AddRelation.tsx): a tiny
// "+ label" chip that expands into a typeahead over one type's items and relates
// the pick to `itemId` with a fixed role. Used for "+ Project" (type=project,
// role=project) and "+ People" (type=person, default related edge). Add-only —
// it doesn't render existing relations (that stays in the canvas); the point
// here is to attach fast while triaging. Optimistic → router.refresh().
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Hit = { id: string; type: string; title: string };

export default function RelatePicker({
  itemId,
  type,
  role,
  label,
  icon,
}: {
  itemId: string;
  type: string;
  // Omit for a plain `related` edge (people); "project" for the project field.
  role?: string;
  label: string;
  icon: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Browse recent items of the type the moment the box opens; then filter by q.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ type, limit: "8" });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/items?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { items: Hit[] };
        setHits(data.items.filter((h) => h.id !== itemId));
        setActive(0);
      } catch {
        // aborted / offline — the next keystroke retries
      }
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [open, q, type, itemId]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function relate(hit: Hit) {
    if (state === "busy") return;
    setState("busy");
    try {
      const res = await fetch(`/api/items/${itemId}/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(role ? { targetId: hit.id, role } : { targetId: hit.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setQ("");
      setHits([]);
      setOpen(false);
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  const chip =
    "inline-flex items-center gap-1 rounded-card border border-line px-2 py-0.5 text-xs text-ink-muted hover:border-line-strong hover:text-ink";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={chip}>
        {icon} {label}
      </button>
    );
  }

  return (
    <div ref={wrapRef} className="relative inline-flex items-center">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (hits[active]) void relate(hits[active]);
          }
        }}
        disabled={state === "busy"}
        placeholder={`${label}…`}
        className="w-40 rounded-card border border-line bg-surface-1 px-2 py-0.5 text-xs text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none disabled:opacity-50"
      />
      {state === "error" && (
        <span className="ml-1 text-xs text-red-400">Failed</span>
      )}
      {hits.length > 0 && (
        <ul className="absolute left-0 top-full z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-card border border-line-strong bg-surface-3 py-1 shadow-xl shadow-black/50">
          {hits.map((hit, i) => (
            <li key={hit.id}>
              <button
                // mousedown, not click: a click blurs the input first and the
                // dropdown vanishes under the pointer.
                onMouseDown={(e) => {
                  e.preventDefault();
                  void relate(hit);
                }}
                onMouseEnter={() => setActive(i)}
                className={`block w-full truncate px-2 py-1 text-left text-sm ${
                  i === active ? "bg-surface-2 text-ink" : "text-ink-muted"
                }`}
              >
                {hit.title || "Untitled"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
