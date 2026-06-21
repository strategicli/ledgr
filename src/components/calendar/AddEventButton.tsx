"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// One-click "Add" for a calendar-feed event (ADR-094 E3): promotes the cached
// event to a real `event` item, then refreshes so the row leaves the feed and
// appears in the events list. Stays disabled on success (the row is about to
// disappear); only re-enables on error.
export default function AddEventButton({ cacheId }: { cacheId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function add() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/calendar/events/${cacheId}/add`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={busy}
      className="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
      title={failed ? "Add failed — try again" : "Add this event to Ledgr"}
    >
      {busy ? "Adding…" : failed ? "Retry" : "Add"}
    </button>
  );
}
