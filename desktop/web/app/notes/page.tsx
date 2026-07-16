"use client";

// Desktop Notes screen: thin client loader (seam → @/lib → PGlite) rendering the
// shared <ItemRows>. Same pattern as Tasks (ADR-139).
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import ItemRows, { type ItemRow } from "@/components/ItemRows";

export default function NotesPage() {
  const [items, setItems] = useState<ItemRow[] | null>(null);

  useEffect(() => {
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

  return (
    <section style={{ padding: "1.5rem" }}>
      <h1 style={{ fontSize: "1.2rem", margin: 0 }}>Notes</h1>
      {items === null ? (
        <p style={{ color: "#777" }}>loading…</p>
      ) : (
        <ItemRows items={items} empty="No notes yet." />
      )}
    </section>
  );
}
