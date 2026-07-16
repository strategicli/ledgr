"use client";

// Desktop Notes screen: fetches notes via the seam and renders the shared
// <ItemRows>, with a quick-add that creates through the seam (ADR-139).
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import ItemRows, { type ItemRow } from "@/components/ItemRows";
import QuickAddItem from "@/components/QuickAddItem";

export default function NotesPage() {
  const [items, setItems] = useState<ItemRow[] | null>(null);

  const load = useCallback(() => {
    apiRequest<{ items?: ItemRow[] }>("/api/items?type=note&limit=200")
      .then((d) => {
        const list = d.items ?? [];
        setItems(list);
        console.log(`[page] notes: ${list.length}`);
      })
      .catch((e) => {
        setItems([]);
        console.log("[page] notes error: " + (e?.message ?? String(e)));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">Notes</h1>
      <QuickAddItem type="note" placeholder="Add a note…" onCreated={load} />
      {items === null ? (
        <p className="mt-3 text-sm text-neutral-500">loading…</p>
      ) : (
        <ItemRows items={items} empty="No notes yet." />
      )}
    </section>
  );
}
