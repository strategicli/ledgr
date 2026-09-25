// One row in the Related Explorer (ADR-127 Phase 2). Thin client leaf: the
// title opens the item, "Explore" re-anchors the map on it (carrying the trail),
// and "+ Link" relates it to the current anchor (the same POST as the Discover
// panel) then refreshes so the row flips to a "linked" badge.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ExploreRowItem = {
  id: string;
  type: string;
  title: string;
  score: number;
  signals: { kind: string; label: string }[];
  linked: boolean;
};

export default function ExploreRow({
  anchorId,
  nextTrail,
  row,
}: {
  anchorId: string;
  // The trail to carry when re-anchoring on this row (current trail + anchor).
  nextTrail: string;
  row: ExploreRowItem;
}) {
  const router = useRouter();
  const [linked, setLinked] = useState(row.linked);
  const [busy, setBusy] = useState(false);

  async function link() {
    if (busy || linked) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${anchorId}/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: row.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setLinked(true);
      router.refresh();
    } catch {
      // keep the button for a retry
    } finally {
      setBusy(false);
    }
  }

  const trailParam = encodeURIComponent(nextTrail);
  return (
    <li className="group flex items-center gap-3 py-2">
      <Link
        href={`/items/${row.id}`}
        className={`min-w-0 flex-1 truncate text-sm hover:underline ${
          row.title ? "text-neutral-200" : "text-neutral-500"
        }`}
      >
        {row.title || "Untitled"}
      </Link>
      {linked ? (
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 text-xs text-[var(--accent)]">
          linked
        </span>
      ) : (
        row.signals.slice(0, 2).map((s, i) => (
          <span
            key={i}
            className="shrink-0 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400"
          >
            {s.label}
          </span>
        ))
      )}
      {row.score > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-neutral-600">
          {row.score.toFixed(2)}
        </span>
      )}
      <span className="shrink-0 text-xs text-neutral-600">{row.type}</span>
      <Link
        href={`/items/${row.id}/explore?trail=${trailParam}`}
        className="shrink-0 rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
      >
        Explore →
      </Link>
      {!linked && (
        <button
          onClick={link}
          disabled={busy}
          className="shrink-0 rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
        >
          {busy ? "Linking…" : "+ Link"}
        </button>
      )}
    </li>
  );
}
