"use client";

// Desktop Tasks screen: thin client loader that fetches tasks via the seam
// (window.__ledgrDesktop → IPC → @/lib → PGlite) and renders the shared
// <ItemRows>. Same shape as every Work screen (ADR-139).
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import ItemRows, { type ItemRow } from "@/components/ItemRows";

export default function TasksPage() {
  const [items, setItems] = useState<ItemRow[] | null>(null);

  useEffect(() => {
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

  return (
    <section style={{ padding: "1.5rem" }}>
      <h1 style={{ fontSize: "1.2rem", margin: 0 }}>Tasks</h1>
      {items === null ? (
        <p style={{ color: "#777" }}>loading…</p>
      ) : (
        <ItemRows items={items} empty="No tasks yet." />
      )}
    </section>
  );
}
