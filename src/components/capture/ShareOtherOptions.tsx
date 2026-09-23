// The non-meeting choices on the share screen (/capture/transcript/[id]): keep
// what was shared as a note, or leave it in the Inbox to sort later. The shared
// text is already saved as an inbox transcript before this screen renders, so
// both choices only re-file it; neither can lose anything. Pure client glue over
// PATCH /api/items/[id].
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { openItem } from "@/lib/item-nav";

export default function ShareOtherOptions({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveAsNote() {
    setBusy(true);
    setError(null);
    try {
      // A plain PATCH, not the move-type dialog's route: that one copies the
      // transcript's "minutes" field into the note's body as a YAML block, and
      // a note has no use for it. Filing it (inbox: false) is the point of
      // choosing a home.
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "note", properties: null, inbox: false }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? `couldn't save (${res.status})`);
      }
      openItem(router, itemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't save");
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={saveAsNote}
          disabled={busy}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500 hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save as a note"}
        </button>
        <Link
          href="/inbox"
          className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
        >
          Leave in Inbox
        </Link>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
