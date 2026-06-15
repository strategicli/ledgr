// Restore a soft-deleted type (and the items trashed alongside it) from Trash
// (ADR-058). Hits POST /api/types/[key]/restore, then refreshes the list.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TypeRestoreButton({ typeKey }: { typeKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/types/${typeKey}/restore`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={restore}
      disabled={busy}
      className="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 disabled:opacity-50"
    >
      {busy ? "Restoring…" : "Restore"}
    </button>
  );
}
