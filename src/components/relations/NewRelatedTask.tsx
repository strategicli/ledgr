// "+ Task" on the Related panel (ADR-055): create a task already related to
// this item, the create-inherits gesture that used to live on the entity
// EmbeddedView (e.g. add a task for a person right from their page). Creating a
// generic related item is the @-mention/+Relate job; this is the common
// "new related task" shortcut. router.refresh() pulls the new row into the
// server-rendered panel.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewRelatedTask({ hostId }: { hostId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function add() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(false);
    try {
      const created = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task", title: t }),
      });
      if (!created.ok) throw new Error(String(created.status));
      const { item } = (await created.json()) as { item: { id: string } };
      const rel = await fetch(`/api/items/${hostId}/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: item.id }),
      });
      if (!rel.ok) throw new Error(String(rel.status));
      setTitle("");
      setOpen(false);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300"
      >
        + Task
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 px-2 py-1">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void add();
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!title.trim() && !busy) setOpen(false);
        }}
        disabled={busy}
        placeholder="New related task…"
        className="w-full max-w-sm rounded border border-neutral-700 bg-transparent px-2 py-0.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      />
      {error && <span className="text-xs text-red-400">Failed, Enter to retry</span>}
    </span>
  );
}
