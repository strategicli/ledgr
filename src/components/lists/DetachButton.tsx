// The detach ✕ on a related-but-not-contained row (ADR-232).
//
// It is the only visible difference between a resource that LIVES in this
// record and one that is merely relevant to it (Brandon, 2026-08-28): a row
// with an ✕ is a visitor, a row without one lives here. That is why it is an
// always-rendered per-row control rather than a RowMenu entry, which is the
// standing pattern for row actions (ADR-142) — the affordance is carrying
// information, not just offering an action, and a menu you have to open cannot
// tell you anything at a glance.
//
// It removes the association only, never the item: one `related` edge, scoped
// by role so it cannot touch a home or `contains` edge even if one also
// exists. Undo re-relates.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/ui/ActionToast";

export default function DetachButton({
  recordId,
  itemId,
  label,
}: {
  // The record to detach FROM (the page you are on).
  recordId: string;
  itemId: string;
  // The row's title, for the toast and the accessible name.
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const name = label.trim() || "Untitled";

  const url = `/api/items/${recordId}/relations?targetId=${itemId}&role=related`;

  async function detach() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        showToast("Couldn't detach that");
        return;
      }
      router.refresh();
      showToast(`${name} detached`, () => {
        void fetch(`/api/items/${recordId}/relations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetId: itemId, role: "related" }),
        }).then(() => router.refresh());
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void detach()}
      disabled={busy}
      aria-label={`Detach ${name} from this record`}
      title="Related to this record, not filed in it. Click to detach."
      className="shrink-0 rounded px-1 text-xs leading-none text-ink-faint hover:text-red-400 disabled:opacity-50"
    >
      ✕
    </button>
  );
}
