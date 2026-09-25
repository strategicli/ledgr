// One under-connected item on the Loose Ends page (ADR-127 Phase 3): the item
// plus its top suggested links inline, each with a one-click + Link (the same
// relate POST). Linking removes that chip; clearing the last one drops the card
// and refreshes, since the item is now better connected.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Suggestion = {
  id: string;
  title: string;
  type: string;
  signals: { kind: string; label: string }[];
};

export default function LooseEndCard({
  id,
  title,
  type,
  degree,
  suggestions,
}: {
  id: string;
  title: string;
  type: string;
  degree: number;
  suggestions: Suggestion[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Suggestion[]>(suggestions);
  const [busy, setBusy] = useState<string | null>(null);

  async function link(s: Suggestion) {
    if (busy) return;
    setBusy(s.id);
    try {
      const res = await fetch(`/api/items/${id}/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: s.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const rest = open.filter((x) => x.id !== s.id);
      setOpen(rest);
      if (rest.length === 0) router.refresh(); // now more connected — recompute the list
    } catch {
      // keep the chip for a retry
    } finally {
      setBusy(null);
    }
  }

  if (open.length === 0) return null;

  return (
    <li className="rounded-lg border border-neutral-800 p-3">
      <div className="flex items-center gap-2">
        <Link
          href={`/items/${id}`}
          className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200 hover:underline"
        >
          {title || "Untitled"}
        </Link>
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 text-xs text-neutral-500">
          {type} · {degree === 0 ? "no links" : `${degree} link${degree === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-xs text-neutral-600">link to</span>
        {open.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-1.5 rounded border border-neutral-800 py-0.5 pl-2 pr-1"
          >
            <Link
              href={`/items/${s.id}`}
              className="max-w-[12rem] truncate text-xs text-neutral-300 hover:underline"
            >
              {s.title || "Untitled"}
            </Link>
            {s.signals[0] && (
              <span className="text-[10px] text-neutral-600">{s.signals[0].label}</span>
            )}
            <button
              onClick={() => link(s)}
              disabled={busy === s.id}
              className="rounded px-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
            >
              {busy === s.id ? "…" : "+ Link"}
            </button>
          </span>
        ))}
      </div>
    </li>
  );
}
