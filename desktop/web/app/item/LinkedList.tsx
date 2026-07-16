"use client";

// A small labeled list panel for the item detail (Subtasks, Linked here). Fetches
// a seam path returning { items } and renders the shared <ItemRows>; hides itself
// when empty. ADR-139.
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import ItemRows, { type ItemRow } from "@/components/ItemRows";

export default function LinkedList({
  heading,
  path,
  onOpen,
}: {
  heading: string;
  path: string;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<ItemRow[] | null>(null);

  useEffect(() => {
    apiRequest<{ items?: ItemRow[] }>(path)
      .then((d) => {
        setItems(d.items ?? []);
        console.log(`[panel] ${heading}: ${(d.items ?? []).length}`);
      })
      .catch(() => setItems([]));
  }, [path]);

  if (!items || items.length === 0) return null;
  return (
    <div className="mt-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {heading}
      </h2>
      <ItemRows items={items} onOpen={onOpen} />
    </div>
  );
}
