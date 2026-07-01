// The per-card "remove section" control (Tyler, 2026-07-01): a small × in each
// project card's header. Removing drops the widget instance from the record's
// composition and PATCHes it, so the card disappears and returns to the "+ Add
// section" menu. Only the surfacing is removed — the backing items (tasks,
// notes, milestones, meetings) live on in items/relations, untouched, so
// re-adding the section brings them all back.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Composition } from "@/lib/composition";

export default function RemoveSection({
  itemId,
  composition,
  instanceId,
  label,
}: {
  itemId: string;
  composition: Composition;
  instanceId: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    const next: Composition = {
      ...composition,
      widgets: composition.widgets.filter((w) => w.instanceId !== instanceId),
    };
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ composition: next }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void remove()}
      disabled={busy}
      aria-label={`Remove ${label} section`}
      title={`Remove ${label}`}
      className="shrink-0 rounded p-0.5 text-neutral-600 opacity-0 transition-opacity hover:text-neutral-300 group-hover/card:opacity-100 disabled:opacity-40"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
