"use client";

// Desktop Trash: soft-deleted items, newest first, with one-click Restore
// (brings the item and the children deleted with it back). Reads via the seam
// (/api/items?trash=true); restore hits /api/items/:id/restore. Items are
// purged after the retention window by the same job the cloud runs. ADR-139.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";

type TrashRow = { id: string; title: string | null; type?: string; deletedAt?: string | null };

export default function TrashPage() {
  const [items, setItems] = useState<TrashRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    apiRequest<{ items?: TrashRow[] }>("/api/items?trash=true&limit=200")
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => load(), [load]);

  async function restore(id: string) {
    setBusy(id);
    try {
      await apiRequest(`/api/items/${id}/restore`, { method: "POST" });
      setItems((cur) => (cur ? cur.filter((i) => i.id !== id) : cur));
    } catch {
      /* leave the row; user can retry */
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight text-neutral-100">Trash</h1>
        <Link href="/build" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Build
        </Link>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Deleted items are kept for a retention window, then purged. Restore puts
        an item (and its children) back.
      </p>

      {items === null ? (
        <p className="mt-6 text-sm text-neutral-500">loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-600">Trash is empty.</p>
      ) : (
        <ul className="mt-6 flex list-none flex-col gap-2 p-0">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 px-3 py-2"
            >
              <div className="min-w-0">
                <span className="block truncate text-sm text-neutral-200">
                  {it.title || "(untitled)"}
                </span>
                <span className="text-xs text-neutral-600">
                  {it.type}
                  {it.deletedAt ? ` · deleted ${String(it.deletedAt).slice(0, 10)}` : ""}
                </span>
              </div>
              <button
                onClick={() => restore(it.id)}
                disabled={busy === it.id}
                className="shrink-0 rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
              >
                {busy === it.id ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
