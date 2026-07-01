// "+ Add section" (Tyler, 2026-07-01): the replacement for the old Customize
// gear. A large button below the project's card grid; clicking it lists the
// sections not already on the page (Overview, Recent Activity, Timeline, plus
// any default card that was removed) and adds the chosen one as a new card.
// Adding appends a visible widget to the record's composition and PATCHes it —
// the same hide-not-delete substrate the gear used, just additive and in place.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Composition } from "@/lib/composition";

export default function AddSectionButton({
  itemId,
  composition,
  addable,
}: {
  itemId: string;
  composition: Composition;
  // Sections not currently present, in menu order.
  addable: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function add(defId: string) {
    if (busy) return;
    setBusy(true);
    const next: Composition = {
      ...composition,
      widgets: [...composition.widgets, { instanceId: defId, defId }],
    };
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ composition: next }),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (addable.length === 0) return null;

  return (
    <div className="mt-3">
      {open ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
          <p className="px-1 pb-1.5 text-xs uppercase tracking-wide text-neutral-500">Add a section</p>
          <div className="flex flex-wrap gap-1.5">
            {addable.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={busy}
                onClick={() => void add(a.id)}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500 hover:bg-neutral-800/60 disabled:opacity-50"
              >
                + {a.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-800 py-3 text-sm text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
        >
          <span className="text-lg leading-none text-[var(--accent)]">+</span> Add section
        </button>
      )}
    </div>
  );
}
