"use client";

// Tasks widget body (Project Type, ADR-111/PJ5): the record's contained tasks as
// a first-class editor — add, check off, pin as Next Action. Source of truth (no
// sync, no read-only mode). Add creates a task contained by the record (home
// edge, role "project"); completing the pinned task auto-advances Next Action
// server-side (items.ts). Subtasks-minimized/expand is a follow-up.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Row = { id: string; title: string; statusCategory: string };

export default function TasksWidget({
  recordId,
  items,
  nextActionTaskId,
}: {
  recordId: string;
  items: Row[];
  nextActionTaskId: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/records/${recordId}/contain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "task", title: t }),
      });
      if (res.ok) {
        setTitle("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function complete(id: string) {
    const res = await fetch(`/api/items/${id}/complete`, { method: "POST" });
    if (res.ok) router.refresh();
  }

  async function pin(id: string) {
    const next = nextActionTaskId === id ? null : id;
    const res = await fetch(`/api/items/${recordId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nextActionTaskId: next }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.length === 0 && <p className="text-sm text-neutral-500">No tasks yet.</p>}
      <ul className="flex flex-col gap-1">
        {items.map((t) => {
          const done = t.statusCategory === "done";
          const pinned = t.id === nextActionTaskId;
          return (
            <li key={t.id} className="group flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={done}
                onChange={() => complete(t.id)}
                className="shrink-0"
                aria-label={done ? "Mark not done" : "Mark done"}
              />
              <Link
                href={`/items/${t.id}`}
                className={`min-w-0 flex-1 truncate hover:text-neutral-200 ${done ? "text-neutral-500 line-through" : "text-neutral-200"}`}
              >
                {t.title || "Untitled"}
              </Link>
              <button
                type="button"
                onClick={() => pin(t.id)}
                title={pinned ? "Unpin Next Action" : "Pin as Next Action"}
                className={`shrink-0 px-1 ${pinned ? "text-amber-400" : "text-neutral-600 opacity-0 group-hover:opacity-100"}`}
              >
                ★
              </button>
            </li>
          );
        })}
      </ul>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void add();
          }
        }}
        placeholder="+ Add task"
        disabled={busy}
        className="mt-1 w-full rounded border border-neutral-800 bg-transparent px-2 py-1 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
      />
    </div>
  );
}
