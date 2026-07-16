"use client";

// Desktop Inbox: items flagged inbox=true (quick-captured / unfiled). Fetches via
// the seam (GET /api/items?inbox=true), opens/deletes through it. ADR-139.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import ItemRows, { type ItemRow } from "@/components/ItemRows";

export default function InboxPage() {
  const router = useRouter();
  const [items, setItems] = useState<ItemRow[] | null>(null);

  const load = useCallback(() => {
    apiRequest<{ items?: ItemRow[] }>("/api/items?inbox=true&limit=200")
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = useCallback((id: string) => router.push(`/item?id=${id}`), [router]);
  const remove = useCallback(
    (id: string) => {
      apiRequest(`/api/items/${id}`, { method: "DELETE" }).then(load).catch(() => {});
    },
    [load]
  );

  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">Inbox</h1>
      {items === null ? (
        <p className="mt-3 text-sm text-neutral-500">loading…</p>
      ) : (
        <ItemRows items={items} empty="Inbox is empty." onOpen={open} onDelete={remove} />
      )}
    </section>
  );
}
