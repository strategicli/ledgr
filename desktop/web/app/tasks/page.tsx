"use client";

// Desktop Tasks screen: fetches tasks via the seam and renders the shared
// <ItemRows>, with a quick-add that creates through the seam (ADR-139).
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import ItemRows, { type ItemRow } from "@/components/ItemRows";
import QuickAddItem from "@/components/QuickAddItem";

export default function TasksPage() {
  const [items, setItems] = useState<ItemRow[] | null>(null);

  const load = useCallback(() => {
    apiRequest<{ items?: ItemRow[] }>("/api/items?type=task&limit=200")
      .then((d) => {
        const list = d.items ?? [];
        setItems(list);
        console.log(`[page] tasks: ${list.length}`);
      })
      .catch((e) => {
        setItems([]);
        console.log("[page] tasks error: " + (e?.message ?? String(e)));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(
    (id: string) => {
      apiRequest(`/api/items/${id}/complete`, { method: "POST" }).then(load).catch(() => {});
    },
    [load]
  );
  const remove = useCallback(
    (id: string) => {
      apiRequest(`/api/items/${id}`, { method: "DELETE" }).then(load).catch(() => {});
    },
    [load]
  );

  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">Tasks</h1>
      <QuickAddItem type="task" placeholder="Add a task…" onCreated={load} />
      {items === null ? (
        <p className="mt-3 text-sm text-neutral-500">loading…</p>
      ) : (
        <ItemRows items={items} empty="No tasks yet." onToggle={toggle} onDelete={remove} />
      )}
    </section>
  );
}
