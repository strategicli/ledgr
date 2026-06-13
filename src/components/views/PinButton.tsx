// Pin-to-dashboard toggle (slice 29) for a view's detail page. Optimistic; a
// failed call reverts. The dashboard reads server-side, so no refresh is
// needed here beyond the local label flip.
"use client";

import { useState } from "react";

export default function PinButton({
  viewId,
  pinned: initialPinned,
}: {
  viewId: string;
  pinned: boolean;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !pinned;
    setPinned(next);
    const res = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewId, pinned: next }),
    }).catch(() => null);
    if (!res || !res.ok) setPinned(!next); // revert
    setBusy(false);
  }

  return (
    <button
      onClick={() => void toggle()}
      disabled={busy}
      className={`text-sm disabled:opacity-50 ${
        pinned
          ? "text-neutral-300 hover:text-neutral-100"
          : "text-neutral-500 hover:text-neutral-300"
      }`}
      title={pinned ? "Remove from dashboard" : "Pin to dashboard"}
    >
      {pinned ? "★ Pinned" : "☆ Pin to dashboard"}
    </button>
  );
}
